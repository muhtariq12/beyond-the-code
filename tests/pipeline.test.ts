import { describe, expect, it } from "vitest";
import { makeCtx, NOW } from "./helpers";
import { dailySummary, generateForQualified, ingestAlertEmail, ingestAll, ingestPastedJob, runDue, screenAll, syncSource } from "./../lib/agent/ops/pipeline";
import { notify } from "@/lib/agent/ops/notify";
import { redactSecrets } from "@/lib/agent/llm/safety";
import { GREENHOUSE_BOARD, mockFetch } from "./fixtures/jobs";
import type { Source } from "@/lib/agent/types";
import { extractText, getDocumentProxy } from "unpdf";

const SRC: Source = { id: "src_acme", type: "greenhouse", name: "Acme AI", token: "acmeai", enabled: true, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastJobCount: null, retryAfter: null, createdAt: NOW.toISOString() };

async function ctxWithBoard(board: unknown = GREENHOUSE_BOARD, env: Record<string, string> = {}) {
  const f = mockFetch({ "https://boards-api.greenhouse.io/v1/boards/acmeai/jobs": board });
  const ctx = await makeCtx({ fetch: f as never, env });
  await ctx.store.put("sources", SRC);
  return { ctx, f };
}

describe("ingestion", () => {
  it("syncs a source, tracks status and creates one application per new job", async () => {
    const { ctx } = await ctxWithBoard();
    const r = await syncSource(ctx, SRC.id, { force: true });
    expect(r).toMatchObject({ ok: true, added: 4 });
    const src = (await ctx.store.get("sources", SRC.id))!;
    expect(src).toMatchObject({ lastError: null, lastJobCount: 4 });
    expect(src.lastSuccessAt).toBeTruthy();
    expect((await ctx.store.list("applications")).every((a) => a.status === "DISCOVERED")).toBe(true);
    const again = await syncSource(ctx, SRC.id, { force: true });
    expect(again).toMatchObject({ added: 0, updated: 4 });
    expect((await ctx.store.list("jobs")).length).toBe(4);
  });

  it("closes postings that disappear from a successful sync", async () => {
    const { ctx } = await ctxWithBoard();
    await syncSource(ctx, SRC.id, { force: true });
    const f2 = mockFetch({ "https://boards-api.greenhouse.io": { jobs: GREENHOUSE_BOARD.jobs.slice(0, 2) } });
    ctx.fetch = f2 as never;
    const r = await syncSource(ctx, SRC.id, { force: true });
    expect(r.closed).toBe(2);
    const jobs = await ctx.store.list("jobs");
    expect(jobs.filter((j) => j.availability === "CLOSED")).toHaveLength(2);
  });

  it("records errors, backs off on 429 and rate-limits repeat syncs", async () => {
    const { ctx } = await ctxWithBoard();
    ctx.fetch = mockFetch({ "https://boards-api.greenhouse.io": { status: 429, headers: { "retry-after": "600" } } }) as never;
    const r = await syncSource(ctx, SRC.id, { force: true });
    expect(r.ok).toBe(false);
    const src = (await ctx.store.get("sources", SRC.id))!;
    expect(src.lastError).toMatch(/Rate limited/);
    expect(new Date(src.retryAfter!).getTime()).toBe(NOW.getTime() + 600_000);
    const f = mockFetch({});
    ctx.fetch = f as never;
    expect((await syncSource(ctx, SRC.id, { force: true })).error).toMatch(/Backing off/);
    expect(f.calls).toHaveLength(0);
    expect((await ctx.store.list("notifications")).some((n) => n.type === "SOURCE_ERROR")).toBe(true);
  });

  it("imports pasted jobs and alert emails without fetching arbitrary URLs", async () => {
    const f = mockFetch({ "https://boards-api.greenhouse.io/v1/boards/acmeai/jobs": GREENHOUSE_BOARD });
    const ctx = await makeCtx({ fetch: f as never });
    const r = await ingestAlertEmail(ctx, `<a href="https://boards.greenhouse.io/acmeai/jobs/4001?utm_source=li">Applied AI Engineer</a>\nhttps://careers.unknown-site.example/jobs/ai-lead?ref=x`);
    expect(r).toMatchObject({ links: 2, resolved: 1, stubs: 1 });
    expect(f.calls.every((u) => u.startsWith("https://boards-api.greenhouse.io/"))).toBe(true);
    const stub = (await ctx.store.list("jobs")).find((j) => j.sourceType === "email")!;
    expect(stub.descriptionMissing).toBe(true);
    await screenAll(ctx);
    const m = (await ctx.store.list("matches")).find((x) => x.jobId === stub.id)!;
    expect(m.checks.find((c) => c.id === "description")?.result).toBe("UNKNOWN");
    const pasted = await ingestPastedJob(ctx, { employer: "LinkedIn Co", title: "AI Engineer", url: "https://www.linkedin.com/jobs/view/123?trk=abc", description: "Requirements\n- Python\n- RAG\n- LLM integration\nFull-time. Dubai, UAE.", location: "Dubai" });
    expect(pasted.canonicalUrl).toBe("https://linkedin.com/jobs/view/123");
    expect(f.calls.some((u) => u.includes("linkedin"))).toBe(false);
  });
});

describe("end-to-end vertical slice: ingest, score, tailor, preview, download, persist", () => {
  it("runs the whole pipeline on a published-board payload", async () => {
    const { ctx } = await ctxWithBoard(GREENHOUSE_BOARD, { ANTHROPIC_API_KEY: "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX", SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJlMTIzNDU2" });
    await ingestAll(ctx);
    const s = await screenAll(ctx);
    expect(s).toMatchObject({ screened: 4 });
    const g = await generateForQualified(ctx);
    expect(g.generated).toBeGreaterThanOrEqual(1);

    const jobs = await ctx.store.list("jobs");
    const byTitle = (t: string) => jobs.find((j) => j.title === t)!;
    const matches = new Map((await ctx.store.list("matches")).map((m) => [m.jobId, m]));
    expect(matches.get(byTitle("Senior Staff Machine Learning Engineer").id)).toMatchObject({ eligibility: "INELIGIBLE", recommendation: "SKIP" });
    const target = byTitle("Applied AI Engineer");
    expect(matches.get(target.id)!.recommendation).toBe("APPLY");

    const apps = await ctx.store.list("applications");
    expect(apps.find((a) => a.jobId === target.id)!.status).toBe("READY_FOR_REVIEW");
    expect(apps.find((a) => a.jobId === byTitle("Senior Staff Machine Learning Engineer").id)!.status).toBe("SCREENED");

    // CV stored against this specific job; ineligible job has none
    const cvs = await ctx.store.list("cvVersions");
    expect(cvs.some((c) => c.jobId === byTitle("Senior Staff Machine Learning Engineer").id)).toBe(false);
    const cv = cvs.find((c) => c.jobId === target.id)!;
    expect(cv.validation.pass).toBe(true);
    const app = apps.find((a) => a.jobId === target.id)!;
    expect(app).toMatchObject({ cvVersionId: cv.id });
    expect(app.coverLetterId).toBeTruthy();
    expect((await ctx.store.list("answers")).filter((a) => a.applicationId === app.id).length).toBeGreaterThan(0);

    // the prompt-injection job never leaks into any generated document
    const injected = byTitle("AI Engineer");
    expect(injected.injectionSignals.length).toBeGreaterThan(0);
    for (const c of cvs) expect(JSON.stringify(c.doc)).not.toMatch(/10 years|Kubernetes|MIT|10\/10/);

    // no secrets anywhere in stored data, documents or audit logs
    const blobs = await Promise.all((await ctx.store.list("documents")).map(async (d) => {
      const b = (await ctx.blobs.get(d.id))!;
      return d.mime === "application/pdf" ? (await extractText(await getDocumentProxy(new Uint8Array(b)), { mergePages: true })).text : Buffer.from(b).toString("latin1");
    }));
    const haystack = JSON.stringify([await ctx.store.list("audit"), await ctx.store.list("notifications"), await ctx.store.list("events"), cvs, await ctx.store.list("sources")]) + blobs.join("\n");
    expect(haystack).not.toMatch(/sk-ant|ABCDEFGHIJKLMNOP|eyJhbGci|c2lnbmF0dXJl/);
  });

  it("is repeatable: re-running creates no duplicate jobs, CVs or notifications", async () => {
    const { ctx } = await ctxWithBoard();
    await ingestAll(ctx);
    await screenAll(ctx);
    await generateForQualified(ctx);
    const counts = async () => [(await ctx.store.list("jobs")).length, (await ctx.store.list("cvVersions")).length, (await ctx.store.list("notifications")).length];
    const before = await counts();
    await ingestAll(ctx);
    await screenAll(ctx);
    await generateForQualified(ctx);
    expect(await counts()).toEqual(before);
  });
});

describe("notifications and scheduling", () => {
  it("never repeats the same event, and posts to the webhook once", async () => {
    const hook = mockFetch({ "https://hooks.example.com/": {} });
    const ctx = await makeCtx({ fetch: hook as never, env: { NOTIFY_WEBHOOK_URL: "https://hooks.example.com/x" } });
    const n = { type: "HIGH_MATCH" as const, title: "t", body: "b", entityId: "job_1" };
    expect(await notify(ctx, n)).toBeTruthy();
    expect(await notify(ctx, n)).toBeNull();
    expect(await notify(ctx, { ...n, entityId: "job_2" })).toBeTruthy();
    expect(hook.calls).toHaveLength(2);
    expect(await dailySummary(ctx)).toBeTruthy();
    expect(await dailySummary(ctx)).toBeNull();
  });

  it("runs each scheduled step only when its interval has elapsed", async () => {
    const { ctx } = await ctxWithBoard();
    const first = await runDue(ctx);
    expect(first).toHaveProperty("ingest");
    expect(first).toHaveProperty("screen");
    const second = await runDue(ctx);
    expect(second).not.toHaveProperty("ingest");
    expect(second).not.toHaveProperty("screen");
    const later = Object.assign({}, ctx, { now: () => new Date(NOW.getTime() + 7 * 3600_000) });
    expect(await runDue(later)).toHaveProperty("ingest");
  });

  it("redacts credentials from free text", () => {
    expect(redactSecrets("failed with key sk-ant-abcdefghijklmnop1234 and Bearer abcdefghijklmnop123 token=abcdefghij12")).not.toMatch(/abcdefghij/);
  });
});
