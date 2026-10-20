import type { Application, Job, Match, Salary } from "./types";

export function fmtAed(n: number | null | undefined): string {
  return n == null ? "–" : n.toLocaleString("en-US");
}

export function salaryLabel(job: Job, match: Match | undefined): { text: string; sub: string; tone: "ok" | "warn" | "bad" | "" } {
  const s: Salary | null = job.salary;
  if (!s) return { text: "Not published", sub: "UNKNOWN", tone: "" };
  const aed = match?.salaryAedMonthly;
  const conf = match?.salaryConfidence ?? "UNKNOWN";
  if (!aed || (aed.min == null && aed.max == null)) return { text: s.raw.slice(0, 40), sub: `UNKNOWN · cannot normalise`, tone: "warn" };
  const range = aed.min === aed.max || aed.min == null || aed.max == null ? fmtAed(aed.max ?? aed.min) : `${fmtAed(aed.min)}–${fmtAed(aed.max)}`;
  const failed = match?.checks.find((c) => c.id === "salary")?.result === "FAIL";
  return { text: `AED ${range}/mo`, sub: `${conf.toLowerCase()} confidence · ${s.basis === "UNKNOWN" ? "base/total n/s" : s.basis.toLowerCase()}`, tone: failed ? "bad" : conf === "HIGH" ? "ok" : "warn" };
}

export function remoteLabel(job: Job): string {
  return job.remote === "UNKNOWN" ? "Work mode n/s" : job.remote.charAt(0) + job.remote.slice(1).toLowerCase();
}

export const STATUS_TONE: Record<Application["status"], string> = {
  DISCOVERED: "", SCREENED: "", QUALIFIED: "info", CV_GENERATED: "info", READY_FOR_REVIEW: "warn", APPROVED: "accent",
  SUBMISSION_PENDING: "warn", SUBMITTED: "ok", SUBMISSION_FAILED: "bad", NEEDS_ATTENTION: "bad", INTERVIEW: "ok", REJECTED: "", WITHDRAWN: "", OFFER: "ok",
};

export function ago(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
