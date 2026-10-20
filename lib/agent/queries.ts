import type { Ctx } from "./ctx";
import type { Application, CvVersion, Job, Match } from "./types";

export interface Row {
  job: Job;
  match: Match | undefined;
  app: Application | undefined;
  cv: CvVersion | undefined; // latest version
  cvCount: number;
}

export async function loadRows(ctx: Ctx): Promise<Row[]> {
  const [jobs, matches, apps, cvs] = await Promise.all([ctx.store.list("jobs"), ctx.store.list("matches"), ctx.store.list("applications"), ctx.store.list("cvVersions")]);
  const m = new Map(matches.map((x) => [x.jobId, x]));
  const a = new Map(apps.map((x) => [x.jobId, x]));
  const c = new Map<string, CvVersion[]>();
  for (const v of cvs) c.set(v.jobId, [...(c.get(v.jobId) ?? []), v]);
  return jobs.map((job) => {
    const list = (c.get(job.id) ?? []).sort((x, y) => y.version - x.version);
    return { job, match: m.get(job.id), app: a.get(job.id), cv: list[0], cvCount: list.length };
  });
}

export const isQualified = (m: Match | undefined) => !!m && m.eligibility !== "INELIGIBLE" && m.recommendation !== "SKIP";

export async function overview(ctx: Ctx) {
  const rows = await loadRows(ctx);
  const apps = rows.map((r) => r.app).filter((x): x is Application => !!x);
  const week = ctx.now().getTime() - 7 * 86400_000;
  const by = (...s: Application["status"][]) => apps.filter((a) => s.includes(a.status)).length;
  const sent = apps.filter((a) => a.confirmation);
  return {
    discovered: apps.filter((a) => Date.parse(a.createdAt) >= week).length,
    discoveredTotal: rows.length,
    qualified: rows.filter((r) => isQualified(r.match)).length,
    eligibleConfirmed: rows.filter((r) => r.match?.eligibility === "ELIGIBLE" && r.match.recommendation !== "SKIP").length,
    cvs: rows.filter((r) => r.cvCount > 0).length,
    prepared: apps.filter((a) => a.cvVersionId).length,
    submitted: sent.length,
    submittedProvider: sent.filter((a) => a.confirmation!.kind === "PROVIDER").length,
    submittedSelf: sent.filter((a) => a.confirmation!.kind === "USER_ATTESTED").length,
    attention: by("NEEDS_ATTENTION", "SUBMISSION_FAILED"),
    awaitingReview: by("READY_FOR_REVIEW"),
    interviews: by("INTERVIEW"),
    rejections: by("REJECTED"),
    offers: by("OFFER"),
    rows,
  };
}
