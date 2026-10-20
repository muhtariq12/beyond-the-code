import type { Ctx } from "../ctx";
import { answerQuestions, STANDARD_QUESTIONS } from "../apply/answers";
import { ensureApplication, transition } from "../apply/status";
import { alertLinkToStub, parseAlertEmail } from "../connectors/email";
import { connectorFor, CONNECTORS } from "../connectors/registry";
import { RateLimitedError, type ConnectorContext } from "../connectors/types";
import { generateCoverLetter } from "../cv/letter";
import { generateCvVersion } from "../cv/service";
import { findDuplicate, mergeJobs } from "../jobs/dedupe";
import { normalizeJob, type RawJob } from "../jobs/normalize";
import { buildMatch } from "../matching/score";
import { newId } from "../store/store";
import type { Job, Source } from "../types";
import { audit } from "./audit";
import { notify } from "./notify";
import { redactSecrets } from "../llm/safety";

export const MANUAL_SOURCE_ID = "src_manual";
export const EMAIL_SOURCE_ID = "src_email";

async function ensureBuiltinSource(ctx: Ctx, id: string, type: "manual" | "email", name: string): Promise<Source> {
  const ex = await ctx.store.get("sources", id);
  if (ex) return ex;
  const s: Source = { id, type, name, token: null, enabled: true, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastJobCount: null, retryAfter: null, createdAt: ctx.now().toISOString() };
  await ctx.store.put("sources", s);
  return s;
}

/** Normalise, dedupe and persist jobs. Returns counts. Creates the application tracking record for new jobs. */
export async function upsertRawJobs(ctx: Ctx, raws: RawJob[]): Promise<{ added: Job[]; updated: number; duplicates: number }> {
  const existing = await ctx.store.list("jobs");
  const added: Job[] = [];
  let updated = 0;
  let duplicates = 0;
  for (const raw of raws) {
    let job: Job;
    try {
      job = normalizeJob(raw);
    } catch {
      continue;
    }
    const dup = findDuplicate(job, existing);
    if (dup) {
      const merged = mergeJobs(dup.match, job);
      await ctx.store.put("jobs", merged);
      existing[existing.findIndex((e) => e.id === merged.id)] = merged;
      if (dup.reason !== "SOURCE_ID") duplicates++;
      else updated++;
      continue;
    }
    await ctx.store.put("jobs", job);
    existing.push(job);
    added.push(job);
    await ensureApplication(ctx, job.id);
    if (job.injectionSignals.length) await audit(ctx.store, ctx.now(), "job.injection_flagged", "SYSTEM", job.id, { signals: job.injectionSignals });
  }
  return { added, updated, duplicates };
}

export interface SyncResult {
  sourceId: string;
  ok: boolean;
  added: number;
  updated: number;
  duplicates: number;
  closed: number;
  error?: string;
}

export async function syncSource(ctx: Ctx, sourceId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const source = await ctx.store.get("sources", sourceId);
  if (!source) throw new Error("Source not found");
  const now = ctx.now();
  const res: SyncResult = { sourceId, ok: false, added: 0, updated: 0, duplicates: 0, closed: 0 };
  if (!source.enabled) return { ...res, error: "Source disabled" };
  if (source.retryAfter && new Date(source.retryAfter) > now) return { ...res, error: `Backing off until ${source.retryAfter}` };
  const prefs = await ctx.store.get("preferences", "prefs");
  const minGap = Math.max(5, (prefs?.schedule.ingestMinutes ?? 360) / 2) * 60_000;
  if (!opts.force && source.lastAttemptAt && now.getTime() - Date.parse(source.lastAttemptAt) < minGap) return { ...res, error: "Skipped: synced recently (rate-limit protection)" };

  const cctx: ConnectorContext = { fetch: ctx.fetch, now: ctx.now };
  try {
    const raws = await connectorFor(source).fetchJobs(source, cctx);
    const r = await upsertRawJobs(ctx, raws);
    // postings that vanished from a successful full-feed fetch are closed
    const seen = new Set(raws.map((x) => x.externalId));
    let closed = 0;
    for (const j of (await ctx.store.list("jobs")).filter((j) => j.sourceId === source.id && j.availability === "OPEN")) {
      if (j.externalId && !seen.has(j.externalId)) {
        await ctx.store.put("jobs", { ...j, availability: "CLOSED" });
        closed++;
      }
    }
    await ctx.store.put("sources", { ...source, lastAttemptAt: now.toISOString(), lastSuccessAt: now.toISOString(), lastError: null, lastJobCount: raws.length, retryAfter: null });
    await audit(ctx.store, now, "source.synced", "SYSTEM", source.id, { jobs: raws.length, added: r.added.length });
    return { ...res, ok: true, added: r.added.length, updated: r.updated, duplicates: r.duplicates, closed };
  } catch (e) {
    const retryAfter = e instanceof RateLimitedError ? new Date(now.getTime() + e.retryAfterSeconds * 1000).toISOString() : null;
    const msg = redactSecrets((e as Error).message).slice(0, 300);
    await ctx.store.put("sources", { ...source, lastAttemptAt: now.toISOString(), lastError: msg, retryAfter });
    await notify(ctx, { type: "SOURCE_ERROR", title: `Source error: ${source.name}`, body: msg, entityId: source.id, discriminator: now.toISOString().slice(0, 10) });
    return { ...res, error: msg };
  }
}

export async function ingestAll(ctx: Ctx): Promise<SyncResult[]> {
  const out: SyncResult[] = [];
  for (const s of await ctx.store.list("sources")) {
    if (!CONNECTORS[s.type].info.needsToken) continue;
    out.push(await syncSource(ctx, s.id));
  }
  return out;
}

export interface PastedJob {
  employer: string;
  title: string;
  url: string;
  description: string;
  location?: string;
  salaryText?: string;
}

/** User-directed import (e.g. a LinkedIn or UAE job-board posting you are viewing). Nothing is fetched. */
export async function ingestPastedJob(ctx: Ctx, p: PastedJob): Promise<Job> {
  const src = await ensureBuiltinSource(ctx, MANUAL_SOURCE_ID, "manual", "Pasted jobs");
  const text = p.salaryText ? `${p.description}\nSalary: ${p.salaryText}` : p.description;
  const r = await upsertRawJobs(ctx, [{ sourceId: src.id, sourceType: "manual", externalId: null, url: p.url, employer: p.employer, title: p.title, descriptionText: text, location: p.location ?? "", retrievedAt: ctx.now().toISOString(), availability: "OPEN" }]);
  const all = await ctx.store.list("jobs");
  const job = r.added[0] ?? all.find((j) => j.canonicalUrl && j.title === p.title.trim() && j.employer === p.employer.trim());
  if (!job) throw new Error("Could not import job");
  await audit(ctx.store, ctx.now(), "job.pasted", "USER", job.id, {});
  return job;
}

const ATS_URL = [
  { ats: "greenhouse" as const, re: /^https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i },
  { ats: "lever" as const, re: /^https?:\/\/jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{8,})/i },
  { ats: "ashby" as const, re: /^https?:\/\/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{8,})/i },
];

/**
 * Alert emails are parsed deterministically (no model reads them). Links to the supported ATS hosts are
 * resolved through that ATS's public feed; everything else becomes a stub that needs a pasted description.
 */
export async function ingestAlertEmail(ctx: Ctx, body: string): Promise<{ links: number; resolved: number; stubs: number }> {
  const src = await ensureBuiltinSource(ctx, EMAIL_SOURCE_ID, "email", "Job-alert emails");
  const links = parseAlertEmail(body);
  const raws: RawJob[] = [];
  let resolved = 0;
  for (const l of links) {
    const m = ATS_URL.map((a) => ({ a, m: a.re.exec(l.url) })).find((x) => x.m);
    if (m?.m) {
      const [, token, id] = m.m;
      try {
        const tmp: Source = { ...src, id: `src_${m.a.ats}_${token}`, type: m.a.ats, name: token.replace(/[-_]/g, " "), token };
        const feed = await CONNECTORS[m.a.ats].fetchJobs(tmp, { fetch: ctx.fetch, now: ctx.now });
        const hit = feed.find((j) => j.externalId === id);
        if (hit) {
          raws.push(hit);
          resolved++;
          continue;
        }
      } catch {
        /* fall through to stub */
      }
    }
    raws.push(alertLinkToStub(l, src.id, ctx.now().toISOString()));
  }
  // register resolved boards as sources so they appear in Sources (disabled for auto-sync until you enable them)
  const r = await upsertRawJobs(ctx, raws);
  await ctx.store.put("sources", { ...src, lastAttemptAt: ctx.now().toISOString(), lastSuccessAt: ctx.now().toISOString(), lastJobCount: links.length });
  return { links: links.length, resolved, stubs: r.added.length - resolved };
}

/** Stage A + B for every job. Hard failures override the score. Advances pre-submission statuses only. */
export async function screenAll(ctx: Ctx): Promise<{ screened: number; qualified: number }> {
  const profile = await ctx.store.get("profile", "profile");
  const prefs = await ctx.store.get("preferences", "prefs");
  if (!profile || !prefs) return { screened: 0, qualified: 0 };
  const jobs = await ctx.store.list("jobs");
  const apps = await ctx.store.list("applications");
  let qualified = 0;
  for (const job of jobs) {
    const m = buildMatch({ job, profile, prefs, applications: apps, now: ctx.now() });
    await ctx.store.put("matches", m);
    const app = apps.find((a) => a.jobId === job.id) ?? (await ensureApplication(ctx, job.id));
    const wantQualified = m.eligibility !== "INELIGIBLE" && m.recommendation !== "SKIP";
    if (wantQualified) qualified++;
    const target = wantQualified ? "QUALIFIED" : "SCREENED";
    if (["DISCOVERED", "SCREENED", "QUALIFIED"].includes(app.status) && app.status !== target) await transition(ctx, app.id, target, "SYSTEM", m.explanation.slice(0, 200));
    if (wantQualified && m.eligibility === "ELIGIBLE" && (m.score ?? 0) >= prefs.notifyMinScore) {
      await notify(ctx, { type: "HIGH_MATCH", title: `${m.score}% match: ${job.title} at ${job.employer}`, body: m.explanation, entityId: job.id });
    }
  }
  return { screened: jobs.length, qualified };
}

/** Generate a tailored CV, cover letter and prepared answers for qualified jobs that have none yet. */
export async function generateForQualified(ctx: Ctx, opts: { limit?: number } = {}): Promise<{ generated: number; failed: number }> {
  const prefs = await ctx.store.get("preferences", "prefs");
  const profile = await ctx.store.get("profile", "profile");
  if (!prefs || !profile) return { generated: 0, failed: 0 };
  const matches = (await ctx.store.list("matches")).filter((m) => m.eligibility !== "INELIGIBLE" && m.recommendation !== "SKIP" && (m.score ?? 0) >= prefs.autoGenerateCvMinScore).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const existing = new Set((await ctx.store.list("cvVersions")).map((v) => v.jobId));
  let generated = 0;
  let failed = 0;
  for (const m of matches) {
    if (generated >= (opts.limit ?? 20)) break;
    if (existing.has(m.jobId)) continue;
    const app = await ensureApplication(ctx, m.jobId);
    if (app.status !== "QUALIFIED") continue;
    try {
      const job = (await ctx.store.get("jobs", m.jobId))!;
      if (job.descriptionMissing) continue;
      const cv = await generateCvVersion(ctx, m.jobId);
      const letter = await generateCoverLetter(ctx, m.jobId);
      await answerQuestions(ctx, app.id, STANDARD_QUESTIONS.map((text) => ({ text })));
      await transition(ctx, app.id, "CV_GENERATED", "SYSTEM", `CV v${cv.version} generated`);
      const cur = (await ctx.store.get("applications", app.id))!;
      await ctx.store.put("applications", { ...cur, cvVersionId: cv.id, coverLetterId: letter.id });
      if (cv.validation.pass) {
        await transition(ctx, app.id, "READY_FOR_REVIEW", "SYSTEM", "Awaiting your review");
        await notify(ctx, { type: "APPROVAL_REQUIRED", title: `CV ready for review: ${job.title} at ${job.employer}`, body: `Match ${m.score}%. Review and approve in CV Studio.`, entityId: cv.id });
      } else {
        await transition(ctx, app.id, "NEEDS_ATTENTION", "SYSTEM", "Generated CV failed claim validation");
      }
      generated++;
    } catch (e) {
      failed++;
      await audit(ctx.store, ctx.now(), "cv.generation_failed", "SYSTEM", m.jobId, { error: (e as Error).message });
    }
  }
  return { generated, failed };
}

/** Where permitted: close stale listings via the feed sync, and surface follow-ups. No provider status APIs are polled. */
export async function reconcile(ctx: Ctx): Promise<{ followUps: number }> {
  const now = ctx.now();
  let followUps = 0;
  for (const app of await ctx.store.list("applications")) {
    if (app.status === "SUBMITTED" && app.confirmation) {
      const due = app.followUpAt ? new Date(app.followUpAt) : new Date(Date.parse(app.confirmation.at) + 7 * 86400_000);
      if (due <= now) {
        const job = await ctx.store.get("jobs", app.jobId);
        const n = await notify(ctx, { type: "FOLLOW_UP_DUE", title: `Follow up: ${job?.title ?? "application"} at ${job?.employer ?? ""}`, body: "No outcome recorded yet.", entityId: app.id });
        if (n) followUps++;
      }
    }
    if (app.status === "SUBMISSION_FAILED" || app.status === "NEEDS_ATTENTION") {
      const job = await ctx.store.get("jobs", app.jobId);
      await notify(ctx, { type: app.status === "SUBMISSION_FAILED" ? "SUBMISSION_FAILED" : "NEEDS_ATTENTION", title: `${app.status === "SUBMISSION_FAILED" ? "Submission failed" : "Needs attention"}: ${job?.title ?? ""} at ${job?.employer ?? ""}`, body: "Open Applications to resolve.", entityId: app.id, discriminator: app.updatedAt });
    }
  }
  return { followUps };
}

export async function dailySummary(ctx: Ctx) {
  const now = ctx.now();
  const since = now.getTime() - 86400_000;
  const jobs = (await ctx.store.list("jobs")).filter((j) => Date.parse(j.retrievedAt) >= since);
  const matches = await ctx.store.list("matches");
  const cvs = (await ctx.store.list("cvVersions")).filter((c) => Date.parse(c.createdAt) >= since);
  const apps = await ctx.store.list("applications");
  const review = apps.filter((a) => a.status === "READY_FOR_REVIEW").length;
  const attention = apps.filter((a) => ["NEEDS_ATTENTION", "SUBMISSION_FAILED"].includes(a.status)).length;
  const body = `${jobs.length} jobs seen, ${matches.filter((m) => m.recommendation !== "SKIP" && m.eligibility !== "INELIGIBLE").length} qualified in total, ${cvs.length} CVs generated, ${review} awaiting your review, ${attention} need attention.`;
  return notify(ctx, { type: "DAILY_SUMMARY", title: `Daily summary ${now.toISOString().slice(0, 10)}`, body, entityId: null, discriminator: now.toISOString().slice(0, 10) });
}

export type StepName = "ingest" | "process" | "reconcile" | "summary";

async function due(ctx: Ctx, step: StepName, minutes: number): Promise<boolean> {
  const rec = await ctx.store.get("meta", `lastRun:${step}`);
  return !rec || ctx.now().getTime() - Date.parse(rec.value as string) >= minutes * 60_000;
}
async function mark(ctx: Ctx, step: StepName) {
  await ctx.store.put("meta", { id: `lastRun:${step}`, value: ctx.now().toISOString() });
}

/** One scheduler tick: runs each step only when its configured interval has elapsed. Safe to call as often as you like. */
export async function runDue(ctx: Ctx, opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  const prefs = await ctx.store.get("preferences", "prefs");
  if (!prefs) return { skipped: "no preferences" };
  const out: Record<string, unknown> = {};
  if (opts.force || (await due(ctx, "ingest", prefs.schedule.ingestMinutes))) {
    out.ingest = await ingestAll(ctx);
    await mark(ctx, "ingest");
  }
  if (opts.force || (await due(ctx, "process", prefs.schedule.processMinutes))) {
    out.screen = await screenAll(ctx);
    out.generate = await generateForQualified(ctx);
    await mark(ctx, "process");
  }
  if (opts.force || (await due(ctx, "reconcile", prefs.schedule.reconcileMinutes))) {
    out.reconcile = await reconcile(ctx);
    await mark(ctx, "reconcile");
  }
  if (now(ctx).getUTCHours() === prefs.schedule.dailySummaryHourUtc || opts.force) {
    await dailySummary(ctx);
    out.summary = true;
  }
  void newId;
  return out;
}
const now = (ctx: Ctx) => ctx.now();
