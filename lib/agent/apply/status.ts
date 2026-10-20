import type { Ctx } from "../ctx";
import { audit } from "../ops/audit";
import { newId } from "../store/store";
import type { Application, ApplicationStatus } from "../types";

/** Allowed status transitions. SUBMITTED is reachable only from SUBMISSION_PENDING (confirmed) or an explicit user attestation. */
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  DISCOVERED: ["SCREENED", "QUALIFIED", "NEEDS_ATTENTION", "WITHDRAWN"],
  SCREENED: ["QUALIFIED", "DISCOVERED", "NEEDS_ATTENTION", "WITHDRAWN"],
  QUALIFIED: ["SCREENED", "CV_GENERATED", "NEEDS_ATTENTION", "WITHDRAWN"],
  CV_GENERATED: ["READY_FOR_REVIEW", "NEEDS_ATTENTION", "QUALIFIED", "WITHDRAWN"],
  READY_FOR_REVIEW: ["APPROVED", "CV_GENERATED", "NEEDS_ATTENTION", "WITHDRAWN", "SUBMITTED"],
  APPROVED: ["SUBMISSION_PENDING", "READY_FOR_REVIEW", "CV_GENERATED", "NEEDS_ATTENTION", "WITHDRAWN", "SUBMITTED"],
  SUBMISSION_PENDING: ["SUBMITTED", "SUBMISSION_FAILED", "NEEDS_ATTENTION"],
  SUBMISSION_FAILED: ["SUBMISSION_PENDING", "NEEDS_ATTENTION", "APPROVED", "WITHDRAWN"],
  NEEDS_ATTENTION: ["QUALIFIED", "CV_GENERATED", "READY_FOR_REVIEW", "APPROVED", "SUBMISSION_PENDING", "SUBMITTED", "SUBMISSION_FAILED", "WITHDRAWN"],
  SUBMITTED: ["INTERVIEW", "REJECTED", "WITHDRAWN", "OFFER"],
  INTERVIEW: ["REJECTED", "OFFER", "WITHDRAWN"],
  REJECTED: [],
  WITHDRAWN: [],
  OFFER: ["WITHDRAWN", "REJECTED"],
};

export class TransitionError extends Error {}

export async function transition(
  ctx: Ctx,
  appId: string,
  to: ApplicationStatus,
  actor: "SYSTEM" | "USER" | "PROVIDER",
  detail: string,
): Promise<Application> {
  const app = await ctx.store.get("applications", appId);
  if (!app) throw new TransitionError("Application not found");
  if (app.status === to) return app;
  if (!TRANSITIONS[app.status].includes(to)) throw new TransitionError(`Cannot move from ${app.status} to ${to}.`);
  const now = ctx.now().toISOString();
  const next: Application = { ...app, status: to, updatedAt: now };
  await ctx.store.put("applications", next);
  await ctx.store.put("events", { id: newId("evt"), applicationId: appId, type: "STATUS_CHANGED", actor, from: app.status, to, detail: detail.slice(0, 400), at: now });
  await audit(ctx.store, ctx.now(), "application.status", actor, appId, { from: app.status, to });
  return next;
}

export async function recordEvent(ctx: Ctx, appId: string | null, type: string, actor: "SYSTEM" | "USER" | "PROVIDER", detail: string) {
  await ctx.store.put("events", { id: newId("evt"), applicationId: appId, type, actor, from: null, to: null, detail: detail.slice(0, 400), at: ctx.now().toISOString() });
}

export async function ensureApplication(ctx: Ctx, jobId: string): Promise<Application> {
  const existing = (await ctx.store.list("applications")).find((a) => a.jobId === jobId);
  if (existing) return existing;
  const job = await ctx.store.get("jobs", jobId);
  if (!job) throw new Error("Job not found");
  const now = ctx.now().toISOString();
  const app: Application = {
    id: `app_${jobId.slice(4)}`,
    jobId,
    fingerprint: job.fingerprint,
    status: "DISCOVERED",
    cvVersionId: null,
    coverLetterId: null,
    provider: job.sourceType,
    confirmation: null,
    followUpAt: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.store.put("applications", app);
  await recordEvent(ctx, app.id, "CREATED", "SYSTEM", "Job discovered");
  return app;
}
