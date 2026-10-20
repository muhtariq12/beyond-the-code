import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

async function as(user: string | null, fn: () => Promise<void>) {
  await db.exec(`set role ${user ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  try {
    await fn();
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite();
  // minimal stand-in for Supabase's auth schema and roles
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
    insert into auth.users values ('${A}'), ('${B}');
  `);
  await db.exec(fs.readFileSync("supabase/migrations/0001_job_agent.sql", "utf8"));
});

const insertJob = (id: string, owner: string, url = `https://x.example/${id}`) =>
  db.query(`insert into jobs (id, owner_id, source_id, source_type, url, canonical_url, employer, title, remote, availability, retrieved_at, fingerprint)
            values ($1, $2, $3, 'manual', $4, $4, 'Acme', 'AI Engineer', 'UNKNOWN', 'OPEN', now(), $5)`, [id, owner, `src_${owner.slice(0, 1)}`, url, `fp_${id}`]);

describe("Row Level Security (real Postgres via PGlite)", () => {
  it("applies the migration and enables forced RLS on every table", async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(18);
    for (const t of r.rows) {
      expect(t.relrowsecurity, t.relname).toBe(true);
      expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
  });

  it("isolates users: each sees and changes only their own rows", async () => {
    await as(A, async () => {
      await db.query(`insert into job_sources (id, owner_id, type, name) values ('src_1', $1, 'manual', 'Mine')`, [A]);
      await insertJob("job_a", A);
    });
    await as(B, async () => {
      await db.query(`insert into job_sources (id, owner_id, type, name) values ('src_2', $1, 'manual', 'Theirs')`, [B]);
      await insertJob("job_b", B);
      expect((await db.query(`select id from jobs`)).rows).toEqual([{ id: "job_b" }]);
      expect((await db.query(`update jobs set title = 'hijack' where id = 'job_a'`)).affectedRows).toBe(0);
      expect((await db.query(`delete from jobs where id = 'job_a'`)).affectedRows).toBe(0);
      await expect(insertJob("job_x", A, "https://x.example/spoof")).rejects.toThrow(/row-level security/);
    });
    await as(A, async () => {
      expect((await db.query(`select id from jobs`)).rows).toEqual([{ id: "job_a" }]);
      expect((await db.query<{ title: string }>(`select title from jobs where id = 'job_a'`)).rows[0].title).toBe("AI Engineer");
    });
  });

  it("denies anonymous access entirely", async () => {
    await as(null, async () => {
      await expect(db.query(`select * from jobs`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into job_sources (id, owner_id, type, name) values ('s', '${A}', 'manual', 'x')`)).rejects.toThrow(/permission denied/);
    });
  });

  it("audit logs and events are append-only even for their owner", async () => {
    await as(A, async () => {
      await db.query(`insert into audit_logs (id, owner_id, action, actor) values ('aud_1', $1, 'x', 'SYSTEM')`, [A]);
      await expect(db.query(`update audit_logs set action = 'tampered' where id = 'aud_1'`)).rejects.toThrow(/permission denied|append-only/);
      await expect(db.query(`delete from audit_logs where id = 'aud_1'`)).rejects.toThrow(/permission denied|append-only/);
    });
    await as(B, async () => expect((await db.query(`select * from audit_logs`)).rows).toHaveLength(0));
  });

  it("freezes CV version content, forbids deleting versions and blocks approving unverified claims", async () => {
    await as(A, async () => {
      await db.query(`insert into cv_versions (id, owner_id, job_id, version, origin, generator, status, content_hash, doc, validation, ats)
        values ('cv_1', $1, 'job_a', 1, 'GENERATED', 'deterministic', 'DRAFT', 'h', '{"a":1}', '{"pass":true}', '[]')`, [A]);
      await expect(db.query(`update cv_versions set doc = '{"a":2}' where id = 'cv_1'`)).rejects.toThrow(/immutable/);
      await expect(db.query(`delete from cv_versions where id = 'cv_1'`)).rejects.toThrow(/cannot be deleted/);
      await db.query(`update cv_versions set status = 'APPROVED', reviewed_at = now() where id = 'cv_1'`);
      await expect(db.query(`update cv_versions set status = 'DRAFT' where id = 'cv_1'`)).rejects.toThrow(/silently return/);
      await db.query(`insert into cv_versions (id, owner_id, job_id, version, origin, generator, status, content_hash, doc, validation, ats)
        values ('cv_2', $1, 'job_a', 2, 'MANUAL_EDIT', 'user', 'DRAFT', 'h2', '{}', '{"pass":false}', '[]')`, [A]);
      await expect(db.query(`update cv_versions set status = 'APPROVED' where id = 'cv_2'`)).rejects.toThrow(/approved_requires_validation/);
      await expect(db.query(`insert into cv_versions (id, owner_id, job_id, version, origin, generator, status, content_hash, doc, validation, ats)
        values ('cv_3', $1, 'job_a', 1, 'GENERATED', 'd', 'DRAFT', 'h', '{}', '{"pass":true}', '[]')`, [A])).rejects.toThrow(/duplicate key/);
    });
  });

  it("prevents duplicate applications and double-confirmed submissions at the database level", async () => {
    await as(A, async () => {
      await insertJob("job_a2", A, "https://other.example/a2");
      const app = (id: string, job: string, status: string, conf: string | null) =>
        db.query(`insert into applications (id, owner_id, job_id, fingerprint, status, provider, confirmation) values ($1, $2, $3, 'fp_same', $4, 'sandbox', $5)`, [id, A, job, status, conf]);
      await app("app_1", "job_a", "SUBMITTED", '{"kind":"PROVIDER","reference":"R1"}');
      await expect(app("app_2", "job_a2", "SUBMITTED", '{"kind":"PROVIDER","reference":"R2"}')).rejects.toThrow(/applications_one_sent_per_posting/);
      await expect(app("app_3", "job_a2", "SUBMITTED", null)).rejects.toThrow(/submitted_has_confirmation|applications_one_sent/);
      await app("app_4", "job_a2", "READY_FOR_REVIEW", null); // drafts are fine

      const att = (id: string, no: number, outcome: string, ref: string | null) =>
        db.query(`insert into submission_attempts (id, owner_id, application_id, idempotency_key, attempt_no, provider, outcome, provider_reference, started_at) values ($1, $2, 'app_1', 'key1', $3, 'sandbox', $4, $5, now())`, [id, A, no, outcome, ref]);
      await att("att_1", 1, "SUCCEEDED", "R1");
      await expect(att("att_2", 2, "SUCCEEDED", "R1b")).rejects.toThrow(/submission_one_success/);
      await expect(att("att_3", 3, "SUCCEEDED", null)).rejects.toThrow(/succeeded_has_reference|submission_one_success/);
    });
  });

  it("makes notification dedupe keys unique per owner", async () => {
    await as(A, async () => {
      const n = (id: string) => db.query(`insert into notifications (id, owner_id, dedupe_key, type, title, body) values ($1, $2, 'HIGH_MATCH:job_a:', 'HIGH_MATCH', 't', 'b')`, [id, A]);
      await n("n1");
      await expect(n("n2")).rejects.toThrow(/duplicate key/);
    });
    await as(B, async () => {
      await db.query(`insert into notifications (id, owner_id, dedupe_key, type, title, body) values ('n3', $1, 'HIGH_MATCH:job_a:', 'HIGH_MATCH', 't', 'b')`, [B]);
    });
  });

  it("rejects unsafe filenames and oversized documents", async () => {
    await as(A, async () => {
      const doc = (id: string, name: string, bytes: number) =>
        db.query(`insert into generated_documents (id, owner_id, kind, filename, mime, bytes, sha256, storage_path) values ($1, $2, 'CV_PDF', $3, 'application/pdf', $4, 'h', 'p')`, [id, A, name, bytes]);
      await expect(doc("d1", "../etc/passwd", 100)).rejects.toThrow(/check constraint/);
      await expect(doc("d2", "ok.pdf", 6_000_000)).rejects.toThrow(/check constraint/);
      await doc("d3", "Acme_AI_Engineer_CV_2026-10-20.pdf", 1000);
      await expect(db.query(`update generated_documents set filename = 'x.pdf' where id = 'd3'`)).rejects.toThrow(/permission denied|write-once/);
    });
  });
});
