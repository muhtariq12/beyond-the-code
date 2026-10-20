import type { Ctx } from "../ctx";
import { evaluateEligibility } from "../matching/eligibility";
import { audit } from "../ops/audit";
import { newId, sha256 } from "../store/store";
import type { Application, SubmissionAttempt } from "../types";
import { missingMandatory } from "./answers";
import type { SubmissionResult } from "./adapters";
import { adapterFor, resolveCapability } from "./capabilities";
import { recordEvent, transition } from "./status";

export class SubmissionBlocked extends Error {
  constructor(public code: string, message: string, public details: string[] = []) {
    super(message);
  }
}

const MAX_ATTEMPTS = 3;
const LOCK_MS = 10 * 60 * 1000;

export interface Preflight {
  ok: boolean;
  checks: { id: string; ok: boolean; detail: string }[];
}

/** Everything that must hold before an authorised submission may be attempted. Pure reads. */
export async function preflight(ctx: Ctx, appId: string): Promise<Preflight> {
  const checks: Preflight["checks"] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const app = await ctx.store.get("applications", appId);
  const job = app && (await ctx.store.get("jobs", app.jobId));
  const profile = await ctx.store.get("profile", "profile");
  const prefs = await ctx.store.get("preferences", "prefs");
  if (!app || !job || !profile || !prefs) return { ok: false, checks: [{ id: "load", ok: false, detail: "Application, job, profile or preferences missing." }] };

  const cap = resolveCapability(app.provider, prefs, ctx.env, ctx.adapters);
  add("capability", cap.state === "AUTHORIZED_API_SUBMISSION", `${cap.state}: ${cap.reason}`);
  add("approved", app.status === "APPROVED" || app.status === "SUBMISSION_FAILED", `Status is ${app.status}; submission needs your approval first.`);

  const source = (await ctx.store.list("sources")).find((s) => s.id === job.sourceId);
  const adapter = await adapterFor(ctx, app.provider, source?.token ?? null);
  const availability = adapter ? await adapter.checkAvailability(job) : "UNKNOWN";
  add("available", availability === "OPEN", availability === "OPEN" ? "Role confirmed still open." : `Role availability is ${availability}.`);

  const others = (await ctx.store.list("applications")).filter((a) => a.id !== app.id && (a.jobId === job.id || a.fingerprint === job.fingerprint) && ["SUBMISSION_PENDING", "SUBMITTED", "INTERVIEW", "OFFER"].includes(a.status));
  add("not-duplicate", others.length === 0, others.length ? `Already applied via ${others[0].id}.` : "No existing application for this posting.");

  const cv = app.cvVersionId ? await ctx.store.get("cvVersions", app.cvVersionId) : null;
  add("cv-approved", !!cv && cv.status === "APPROVED" && cv.validation.pass, cv ? `CV v${cv.version} is ${cv.status}, claims ${cv.validation.pass ? "verified" : "NOT verified"}.` : "No CV selected.");
  let attachOk = false;
  let attachDetail = "No CV document.";
  if (cv?.pdfDocId) {
    const bytes = await ctx.blobs.get(cv.pdfDocId);
    attachOk = !!bytes && bytes.byteLength > 1000 && bytes.byteLength < 5 * 1024 * 1024 && Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-";
    attachDetail = bytes ? `PDF ${bytes.byteLength} bytes.` : "PDF missing from storage.";
  }
  add("attachments", attachOk, attachDetail);

  const answers = (await ctx.store.list("answers")).filter((a) => a.applicationId === app.id);
  const missing = missingMandatory(answers);
  add("answers", answers.length > 0 && missing.length === 0, missing.length ? `${missing.length} mandatory answer(s) need you: ${missing.map((m) => m.category).join(", ")}` : answers.length ? "All mandatory answers complete." : "No answers prepared.");

  const elig = evaluateEligibility({ job, profile, prefs, applications: others, now: ctx.now() });
  const hardFails = elig.checks.filter((c) => c.result === "FAIL");
  add("rules", hardFails.length === 0, hardFails.length ? `Violates your rules: ${hardFails.map((c) => c.reason).join(" ")}` : "Salary, location and other rules still satisfied.");

  return { ok: checks.every((c) => c.ok), checks };
}

export function idempotencyKey(app: Application, provider: string, externalId: string | null): string {
  return sha256(`${app.id}|${app.cvVersionId}|${provider}|${externalId ?? ""}`);
}

export interface SubmitOutcome {
  application: Application;
  attempt: SubmissionAttempt;
  alreadySubmitted: boolean;
}

export async function submitApplication(ctx: Ctx, appId: string): Promise<SubmitOutcome> {
  const app = await ctx.store.get("applications", appId);
  if (!app) throw new SubmissionBlocked("NOT_FOUND", "Application not found");
  const job = await ctx.store.get("jobs", app.jobId);
  if (!job) throw new SubmissionBlocked("NOT_FOUND", "Job not found");
  const key = idempotencyKey(app, app.provider, job.externalId);
  const attempts = (await ctx.store.list("attempts")).filter((a) => a.idempotencyKey === key).sort((a, b) => a.attemptNo - b.attemptNo);

  // idempotency: a confirmed success is final and never re-sent
  const done = attempts.find((a) => a.outcome === "SUCCEEDED");
  if (done) {
    const cur = await ctx.store.get("applications", appId);
    return { application: cur!, attempt: done, alreadySubmitted: true };
  }
  const now = ctx.now();
  const inflight = attempts.find((a) => a.outcome === "PENDING" && now.getTime() - Date.parse(a.startedAt) < LOCK_MS);
  if (inflight) throw new SubmissionBlocked("IN_FLIGHT", "A submission for this application is already in progress.");
  if (attempts.some((a) => a.outcome === "UNKNOWN")) {
    throw new SubmissionBlocked("UNCONFIRMED_PRIOR_ATTEMPT", "A previous attempt may have reached the employer. Check the employer's confirmation, then mark it submitted or reset it manually; it will not be re-sent automatically.");
  }
  const permanent = attempts.find((a) => a.outcome === "FAILED" && !a.retriable);
  if (permanent) throw new SubmissionBlocked("PERMANENT_FAILURE", `The provider rejected this application: ${permanent.error ?? "unknown reason"}`);
  if (attempts.filter((a) => a.outcome === "FAILED").length >= MAX_ATTEMPTS) {
    await transition(ctx, appId, "NEEDS_ATTENTION", "SYSTEM", `Retry limit (${MAX_ATTEMPTS}) reached`).catch(() => undefined);
    throw new SubmissionBlocked("RETRY_LIMIT", `Retry limit of ${MAX_ATTEMPTS} reached.`);
  }

  const pf = await preflight(ctx, appId);
  if (!pf.ok) {
    await audit(ctx.store, now, "submission.blocked", "SYSTEM", appId, { failed: pf.checks.filter((c) => !c.ok).map((c) => c.id) });
    throw new SubmissionBlocked("PREFLIGHT", "Submission blocked by pre-submission checks.", pf.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`));
  }

  const profile = (await ctx.store.get("profile", "profile"))!;
  const source = (await ctx.store.list("sources")).find((s) => s.id === job.sourceId);
  const adapter = (await adapterFor(ctx, app.provider, source?.token ?? null))!;
  const cv = (await ctx.store.get("cvVersions", app.cvVersionId!))!;
  const pdfDoc = (await ctx.store.get("documents", cv.pdfDocId!))!;
  const bytes = (await ctx.blobs.get(cv.pdfDocId!))!;
  const letter = app.coverLetterId ? await ctx.store.get("coverLetters", app.coverLetterId) : null;
  const answers = (await ctx.store.list("answers")).filter((a) => a.applicationId === app.id);

  const attempt: SubmissionAttempt = {
    id: newId("att"), applicationId: appId, idempotencyKey: key, attemptNo: attempts.length + 1, provider: app.provider,
    outcome: "PENDING", retriable: false, providerReference: null, responseMeta: {}, error: null, startedAt: now.toISOString(), finishedAt: null,
  };
  await ctx.store.put("attempts", attempt);
  await transition(ctx, appId, "SUBMISSION_PENDING", "SYSTEM", `Attempt ${attempt.attemptNo}`);
  await audit(ctx.store, now, "submission.attempt", "SYSTEM", appId, { attemptNo: attempt.attemptNo, provider: app.provider });

  let result: SubmissionResult;
  try {
    result = await adapter.submit({ idempotencyKey: key, job, profile, cv: { filename: pdfDoc.filename, bytes }, coverLetterText: letter?.text ?? null, answers });
  } catch (e) {
    // An exception after the request may have been sent is ambiguous: never assume failure.
    result = { outcome: "UNKNOWN", retriable: false, reference: null, meta: {}, error: (e as Error).message };
  }
  // A "success" without a confirmation reference is not confirmation.
  if (result.outcome === "SUCCEEDED" && !result.reference) result = { ...result, outcome: "UNKNOWN", error: "Provider reported success without a confirmation reference." };

  const finished = ctx.now().toISOString();
  const done2: SubmissionAttempt = { ...attempt, outcome: result.outcome, retriable: result.retriable, providerReference: result.reference, responseMeta: result.meta, error: result.error ?? null, finishedAt: finished };
  await ctx.store.put("attempts", done2);

  if (result.outcome === "SUCCEEDED") {
    const cur = (await ctx.store.get("applications", appId))!;
    await ctx.store.put("applications", { ...cur, confirmation: { kind: "PROVIDER", reference: result.reference, at: finished }, updatedAt: finished });
    const app2 = await transition(ctx, appId, "SUBMITTED", "PROVIDER", `Confirmed: ${result.reference}`);
    await audit(ctx.store, ctx.now(), "submission.confirmed", "PROVIDER", appId, { reference: result.reference, ...result.meta });
    return { application: app2, attempt: done2, alreadySubmitted: false };
  }
  if (result.outcome === "FAILED") {
    const app2 = await transition(ctx, appId, "SUBMISSION_FAILED", "PROVIDER", result.error ?? "Failed");
    await audit(ctx.store, ctx.now(), "submission.failed", "PROVIDER", appId, { error: result.error, retriable: result.retriable });
    return { application: app2, attempt: done2, alreadySubmitted: false };
  }
  const app2 = await transition(ctx, appId, "NEEDS_ATTENTION", "SYSTEM", `Outcome unconfirmed: ${result.error ?? "no response"}. Verify with the employer before retrying.`);
  await audit(ctx.store, ctx.now(), "submission.unconfirmed", "SYSTEM", appId, { error: result.error });
  return { application: app2, attempt: done2, alreadySubmitted: false };
}

/* ---------- manual handoff ---------- */

export interface HandoffPackage {
  openUrl: string;
  provider: string;
  capability: string;
  capabilityReason: string;
  cvPdfDocId: string | null;
  cvDocxDocId: string | null;
  coverLetterText: string | null;
  answers: { question: string; answer: string | null; needsYou: boolean }[];
  steps: string[];
}

export async function buildHandoff(ctx: Ctx, appId: string): Promise<HandoffPackage> {
  const app = await ctx.store.get("applications", appId);
  if (!app) throw new Error("Application not found");
  const job = (await ctx.store.get("jobs", app.jobId))!;
  const prefs = (await ctx.store.get("preferences", "prefs"))!;
  const cap = resolveCapability(app.provider, prefs, ctx.env, ctx.adapters);
  const cv = app.cvVersionId ? await ctx.store.get("cvVersions", app.cvVersionId) : null;
  const letter = app.coverLetterId ? await ctx.store.get("coverLetters", app.coverLetterId) : null;
  const answers = (await ctx.store.list("answers")).filter((a) => a.applicationId === app.id);
  return {
    openUrl: job.applyUrl ?? job.url,
    provider: app.provider,
    capability: cap.state,
    capabilityReason: cap.reason,
    cvPdfDocId: cv?.pdfDocId ?? null,
    cvDocxDocId: cv?.docxDocId ?? null,
    coverLetterText: letter?.text ?? null,
    answers: answers.map((a) => ({ question: a.question, answer: a.answer, needsYou: a.status !== "ANSWERED" })),
    steps: [
      "Open the original application page (button above).",
      "Upload the approved CV (PDF or DOCX) and paste the cover letter if the form has a field for it.",
      "Copy each prepared answer; fill in any marked 'needs you' yourself.",
      "Complete any CAPTCHA or identity step yourself. This tool never automates them.",
      "Submit on the employer's page, then come back and mark it as submitted.",
    ],
  };
}

/** You report that you applied yourself. Recorded as user-attested, never as provider-confirmed. */
export async function attestManualSubmission(ctx: Ctx, appId: string, reference: string | null): Promise<Application> {
  const app = await ctx.store.get("applications", appId);
  if (!app) throw new SubmissionBlocked("NOT_FOUND", "Application not found");
  const job = (await ctx.store.get("jobs", app.jobId))!;
  const dup = (await ctx.store.list("applications")).find((a) => a.id !== app.id && (a.jobId === job.id || a.fingerprint === job.fingerprint) && ["SUBMITTED", "INTERVIEW", "OFFER"].includes(a.status));
  if (dup) throw new SubmissionBlocked("DUPLICATE", `You already applied to this posting (${dup.id}).`);
  const at = ctx.now().toISOString();
  await ctx.store.put("applications", { ...app, confirmation: { kind: "USER_ATTESTED", reference, at }, updatedAt: at });
  const next = await transition(ctx, appId, "SUBMITTED", "USER", "Marked as submitted by you (self-reported)");
  await recordEvent(ctx, appId, "MANUAL_SUBMISSION_ATTESTED", "USER", reference ?? "no reference");
  await audit(ctx.store, ctx.now(), "submission.attested", "USER", appId, { reference });
  return next;
}
