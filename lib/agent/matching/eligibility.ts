import { assessGeography } from "../jobs/location";
import { assessSalary } from "../jobs/salary";
import { professionalMonths, verifiedEntries } from "../profile/facts";
import type { Application, Check, Job, Preferences, Profile } from "../types";

export type Seniority = "INTERN" | "JUNIOR" | "MID" | "SENIOR" | "LEAD" | "PRINCIPAL";
const ORDER: Seniority[] = ["INTERN", "JUNIOR", "MID", "SENIOR", "LEAD", "PRINCIPAL"];

export function titleSeniority(title: string): Seniority {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return "INTERN";
  if (/\b(vp|vice president|head of|director|chief|cto|principal|distinguished|fellow)\b/.test(t)) return "PRINCIPAL";
  if (/\b(staff|lead|manager|architect)\b/.test(t)) return "LEAD";
  if (/\b(senior|sr\.?)\b|\biii\b|\blevel 3\b/.test(t)) return "SENIOR";
  if (/\b(junior|jr\.?|graduate|entry[- ]level|associate)\b|\bi\b$/.test(t)) return "JUNIOR";
  return "MID";
}

export const seniorityRank = (s: Seniority) => ORDER.indexOf(s);

const AUTH_NEEDED_ELSEWHERE = /(must|required to|need to|only)\b.{0,50}\b(authori[sz]ed|eligible|legally|right) to work in (the )?(us|u\.s\.|united states|uk|united kingdom|canada|eu|european union|india|germany|australia)/i;
const NO_SPONSORSHIP = /(no|not|unable to|cannot|can't|won't|do not|does not|without)\b.{0,30}\b(visa )?sponsor(ship)?\b|sponsorship (is )?not (available|provided|offered)/i;
const CLEARANCE = /\b(security clearance|secret clearance|top secret|ts\/sci|government clearance|dv clearance|sc clearance)\b/i;
const CITIZEN = /\b(citizens? only|nationals? only|emirati nationals?|uae nationals?|citizenship (is )?required|must be a (uae|emirati|saudi|us|u\.s\.) (national|citizen))\b/i;

function check(id: string, label: string, result: Check["result"], reason: string): Check {
  return { id, label, result, reason };
}

export interface EligibilityInput {
  job: Job;
  profile: Profile;
  prefs: Preferences;
  applications: Application[];
  now: Date;
}

export interface EligibilityOutcome {
  eligibility: "ELIGIBLE" | "UNCERTAIN" | "INELIGIBLE";
  checks: Check[];
  salary: ReturnType<typeof assessSalary>;
  geo: ReturnType<typeof assessGeography>;
}

/** Stage A. Hard filters; uncertain information stays UNKNOWN and is never promoted to PASS or FAIL. */
export function evaluateEligibility(inp: EligibilityInput): EligibilityOutcome {
  const { job, profile, prefs, applications, now } = inp;
  const checks: Check[] = [];

  // content safety: text aimed at AI readers is never obeyed, but it needs a human look
  if (job.injectionSignals.length) {
    checks.push(check("content", "Posting content", "UNKNOWN", `Contains text addressed to AI systems (${job.injectionSignals.join(", ")}). It was ignored for screening; read the posting yourself before applying.`));
  }

  // availability
  if (job.availability === "CLOSED" || (job.expiresAt && new Date(job.expiresAt) < now)) {
    checks.push(check("availability", "Listing availability", "FAIL", "The listing is closed or has expired."));
  } else if (job.availability === "UNKNOWN") {
    checks.push(check("availability", "Listing availability", "UNKNOWN", "Availability could not be confirmed from the source."));
  } else checks.push(check("availability", "Listing availability", "PASS", "Listed as open at last retrieval."));

  // description present
  if (job.descriptionMissing) checks.push(check("description", "Full description", "UNKNOWN", "No usable description (alert stub). Paste the description to screen this job."));

  // duplicate application
  // Only applications that were actually sent (or are being sent) count; a prepared draft for this same job must not block itself.
  const SENT = new Set(["SUBMISSION_PENDING", "SUBMITTED", "INTERVIEW", "OFFER"]);
  const dup = applications.find((a) => (a.jobId === job.id || a.fingerprint === job.fingerprint) && SENT.has(a.status));
  checks.push(dup
    ? check("duplicate", "Duplicate application", "FAIL", `Already applied or in progress (application ${dup.id}, status ${dup.status}).`)
    : check("duplicate", "Duplicate application", "PASS", "No existing application for this posting."));

  // salary
  const salary = assessSalary(job.salary, prefs);
  checks.push(check("salary", "Salary threshold", salary.result, salary.reason));

  // geography
  const geo = assessGeography(job, prefs);
  checks.push(check("geography", "UAE / permitted remote", geo.result, geo.reason));

  // employment arrangement
  if (job.employmentType === "UNKNOWN") checks.push(check("employment", "Employment arrangement", "UNKNOWN", "Employment type not stated."));
  else if (!prefs.employmentTypes.includes(job.employmentType)) checks.push(check("employment", "Employment arrangement", "FAIL", `${job.employmentType.replace("_", " ").toLowerCase()} role; your preference is ${prefs.employmentTypes.join(", ").replace(/_/g, " ").toLowerCase()}.`));
  else checks.push(check("employment", "Employment arrangement", "PASS", "Employment type matches preference."));

  // seniority + years
  const level = titleSeniority(job.title);
  const maxRank = seniorityRank(prefs.maxSeniority);
  if (level === "INTERN" && !prefs.employmentTypes.includes("INTERNSHIP")) checks.push(check("seniority", "Seniority", "FAIL", "Internship-level role."));
  else if (seniorityRank(level) > maxRank) checks.push(check("seniority", "Seniority", "FAIL", `Title implies ${level.toLowerCase()} level; your ceiling is ${prefs.maxSeniority.toLowerCase()}.`));
  else checks.push(check("seniority", "Seniority", "PASS", `Title implies ${level.toLowerCase()} level.`));

  const months = prefs.candidateYearsOverride != null ? prefs.candidateYearsOverride * 12 : professionalMonths(profile, now);
  if (job.experienceYearsMin == null) {
    checks.push(check("years", "Years of experience", "PASS", "No explicit years-of-experience requirement stated."));
  } else if (months == null) {
    checks.push(check("years", "Years of experience", "UNKNOWN", `Requires ${job.experienceYearsMin}+ years; your verified employment dates are not available to compare.`));
  } else {
    const have = months / 12;
    if (job.experienceYearsMin > have + prefs.yearsTolerance) checks.push(check("years", "Years of experience", "FAIL", `Requires ${job.experienceYearsMin}+ years; verified professional experience is about ${have.toFixed(1)} years (tolerance ${prefs.yearsTolerance}).`));
    else checks.push(check("years", "Years of experience", "PASS", `Requires ${job.experienceYearsMin}+ years; verified experience about ${have.toFixed(1)} years.`));
  }

  // qualifications
  const edu = verifiedEntries(profile).filter((e) => e.type === "EDUCATION").map((e) => e.title.toLowerCase());
  const has = { master: edu.some((t) => /master|msc|m\.sc/.test(t)), phd: edu.some((t) => /ph\.?d|doctor/.test(t)), bachelor: edu.some((t) => /bachelor|bsc|b\.sc/.test(t)) };
  if (job.requiredDegree === "PHD") checks.push(check("degree", "Required qualification", has.phd ? "PASS" : "FAIL", has.phd ? "PhD requirement met." : "Requires a PhD; none in your verified profile."));
  else if (job.requiredDegree === "MASTER") checks.push(check("degree", "Required qualification", has.master || has.phd ? "PASS" : "FAIL", has.master || has.phd ? "Master's requirement met." : "Requires a master's degree; your verified education is a bachelor's."));
  else if (job.requiredDegree === "BACHELOR") checks.push(check("degree", "Required qualification", edu.length === 0 ? "UNKNOWN" : has.bachelor || has.master || has.phd ? "PASS" : "UNKNOWN", edu.length === 0 ? "No verified education in the profile." : "Bachelor's requirement."));
  else checks.push(check("degree", "Required qualification", "PASS", "No degree requirement detected."));

  // work authorization / sponsorship / clearance / citizenship
  const d = job.description;
  const inUae = /uae|dubai|abu dhabi|sharjah|emirates/i.test(job.location);
  if (CITIZEN.test(d)) checks.push(check("authorization", "Work authorization", "FAIL", "The posting restricts the role by citizenship/nationality."));
  else if (CLEARANCE.test(d)) checks.push(check("authorization", "Work authorization", "UNKNOWN", "Mentions a security clearance; confirm you can meet it."));
  else if (AUTH_NEEDED_ELSEWHERE.test(d) && !inUae) checks.push(check("authorization", "Work authorization", "FAIL", "Requires existing work authorization in a country other than the UAE."));
  else if (NO_SPONSORSHIP.test(d)) {
    if (prefs.workAuthorization === "NEEDS_SPONSORSHIP") checks.push(check("authorization", "Work authorization", "FAIL", "No visa sponsorship offered and you need sponsorship."));
    else if (prefs.workAuthorization === "AUTHORIZED") checks.push(check("authorization", "Work authorization", "PASS", "No sponsorship offered; you are configured as authorised."));
    else checks.push(check("authorization", "Work authorization", "UNKNOWN", "No sponsorship offered; set your work-authorisation status in Settings."));
  } else checks.push(check("authorization", "Work authorization", "PASS", "No conflicting authorisation constraints detected."));

  // mandatory technical requirements (coverage of required skills by verified evidence)
  const have = new Set(profile.facts.filter((f) => f.verified).flatMap((f) => f.skills).concat(profile.skills.filter((s) => s.verified).map((s) => s.name)));
  const req = job.requiredSkills;
  if (req.length >= 3) {
    const missing = req.filter((s) => !have.has(s));
    const ratio = missing.length / req.length;
    if (ratio > 0.6) checks.push(check("mandatory", "Mandatory technical requirements", "FAIL", `${missing.length} of ${req.length} required skills have no verified evidence (${missing.slice(0, 5).join(", ")}).`));
    else if (ratio > 0.35) checks.push(check("mandatory", "Mandatory technical requirements", "UNKNOWN", `${missing.length} of ${req.length} required skills lack verified evidence (${missing.slice(0, 5).join(", ")}).`));
    else checks.push(check("mandatory", "Mandatory technical requirements", "PASS", `${req.length - missing.length} of ${req.length} required skills are evidenced.`));
  } else checks.push(check("mandatory", "Mandatory technical requirements", "UNKNOWN", "Too few required skills could be extracted to judge."));

  const eligibility = checks.some((c) => c.result === "FAIL") ? "INELIGIBLE" : checks.some((c) => c.result === "UNKNOWN") ? "UNCERTAIN" : "ELIGIBLE";
  return { eligibility, checks, salary, geo };
}
