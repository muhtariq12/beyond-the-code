import crypto from "node:crypto";
import { htmlToText, norm, normalizeWhitespace, stripControl } from "../text";
import { extractSkills } from "../skills";
import { detectInjection } from "../llm/safety";
import type { Job, RemoteMode, Salary } from "../types";
import { detectRemote, detectRemoteRegions } from "./location";
import { findSalaryInDescription } from "./salary";

const TRACKING = /^(utm_.+|gh_src|gh_jid|lever-source|lever-origin|ref|referrer|source|src|fbclid|gclid|trk|trackingid|refid)$/i;

export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if (u.hostname.startsWith("www.")) u.hostname = u.hostname.slice(4);
    // Greenhouse embeds keep the job id in gh_jid: preserve it, drop other tracking
    const keep: [string, string][] = [];
    for (const [k, v] of u.searchParams) if (!TRACKING.test(k) || k === "gh_jid") keep.push([k, v]);
    keep.sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [k, v] of keep) u.searchParams.append(k, v);
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}

const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|fze|fzco|fz-llc|pjsc|plc|gmbh|corp|corporation|co|company|holdings?|group)\b/g;

export function jobFingerprint(employer: string, title: string, location: string): string {
  const e = norm(employer).replace(COMPANY_SUFFIX, "").replace(/\s+/g, " ").trim();
  const t = norm(title)
    .replace(/\b(senior|sr|jr|junior)\b/g, (m) => m) // seniority is meaningful: keep
    .replace(/\b(m f d|f m d|all genders)\b/g, "")
    .trim();
  const l = norm(location.split(/[;|]/)[0]).replace(/\b(remote|hybrid|on site|onsite)\b/g, "").trim();
  return crypto.createHash("sha256").update(`${e}|${t}|${l}`).digest("hex").slice(0, 24);
}

export function jobId(sourceId: string, externalId: string | null, canonicalUrl: string): string {
  return "job_" + crypto.createHash("sha256").update(`${sourceId}|${externalId ?? canonicalUrl}`).digest("hex").slice(0, 20);
}

/* ---------- description analysis ---------- */

type Section = "REQUIRED" | "PREFERRED" | "OTHER";
const H_REQ = /^(?:[-*•#\s]*)(requirements?|required|qualifications?|must[- ]haves?|minimum (qualifications|requirements)|what you('|’)ll need|what we('|’)re looking for|you have|you bring|who you are|about you|skills (and|&) experience|essential)\b/i;
const H_PREF = /^(?:[-*•#\s]*)(preferred|nice[- ]to[- ]haves?|bonus|desirable|good to have|a plus|extra credit|great if you|it would be great)/i;
const H_OTHER = /^(?:[-*•#\s]*)(responsibilit|what you('|’)ll do|about the (role|team|job)|the role|benefits|perks|about us|who we are|our (mission|culture)|how we work|what we offer|compensation|salary)/i;

export function splitRequirementSections(desc: string): { required: string[]; preferred: string[]; other: string[]; hasExplicitRequired: boolean } {
  const required: string[] = [];
  const preferred: string[] = [];
  const other: string[] = [];
  let section: Section = "OTHER";
  let hasExplicitRequired = false;
  for (const rawLine of desc.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Lines that try to instruct an AI reader are never treated as requirements.
    if (detectInjection(line).length) continue;
    const isHeading = line.length < 90 && !/[.;]$/.test(line) || /:$/.test(line);
    if (isHeading && H_PREF.test(line)) section = "PREFERRED";
    else if (isHeading && H_REQ.test(line)) {
      section = "REQUIRED";
      hasExplicitRequired = true;
    } else if (isHeading && H_OTHER.test(line)) section = "OTHER";
    const inlinePref = /\b(preferred|nice to have|a plus|is a bonus|bonus points|desirable|advantageous)\b/i.test(line);
    const target = inlinePref ? preferred : section === "REQUIRED" ? required : section === "PREFERRED" ? preferred : other;
    target.push(line);
  }
  return { required, preferred, other, hasExplicitRequired };
}

export function parseExperienceYears(desc: string): number | null {
  let best: number | null = null;
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|to|–)?\s*(\d{1,2})?\s*\+?\s*years?(?:['’]s?)?\s*(?:of\s*)?(?:(?:relevant|professional|hands[- ]on|industry|commercial|proven|practical|work|related|software|engineering)\s*)*(?:experience|exp\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc))) {
    const v = parseInt(m[1], 10);
    if (v > 0 && v < 30 && (best === null || v > best)) best = v;
  }
  return best;
}

export function parseRequiredDegree(requiredLines: string[]): Job["requiredDegree"] {
  const t = requiredLines.join("\n");
  const mustHave = (re: RegExp) =>
    t.split("\n").some((l) => re.test(l) && !/\b(preferred|a plus|nice to have|bonus|or equivalent|or related|desirable)\b/i.test(l) && !/\b(bachelor|bsc|b\.s\.|undergraduate)\b.*\b(or|and)\b.*\b(master|phd)/i.test(l));
  if (mustHave(/\b(ph\.?d\.?|doctorate|doctoral)\b/i)) return "PHD";
  if (mustHave(/\b(master'?s|msc|m\.s\.|postgraduate)\b/i)) return "MASTER";
  if (/\b(bachelor|bsc|b\.s\.|undergraduate degree|university degree)\b/i.test(t)) return "BACHELOR";
  return "NONE";
}

export function parseEmploymentType(text: string, hint?: string | null): string {
  const t = `${hint ?? ""} ${text.slice(0, 800)}`.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return "INTERNSHIP";
  if (/\bcontract(or)?\b|fixed[- ]term|freelance|\bc2c\b/.test(t)) return "CONTRACT";
  if (/\bpart[-_ ]?time\b/.test(t)) return "PART_TIME";
  if (/\bfull[-_ ]?time\b|permanent/.test(t)) return "FULL_TIME";
  return "UNKNOWN";
}

export interface RawJob {
  sourceId: string;
  sourceType: string;
  externalId: string | null;
  url: string;
  applyUrl?: string | null;
  employer: string;
  title: string;
  descriptionText: string;
  location: string;
  remoteHint?: string | null;
  employmentTypeHint?: string | null;
  salary?: Salary | null;
  postedAt?: string | null;
  expiresAt?: string | null;
  availability?: Job["availability"];
  retrievedAt: string;
}

export function normalizeJob(raw: RawJob): Job {
  // Untrusted text: strip control characters and any markup so it is only ever stored (and later rendered) as inert text.
  const cleaned = stripControl(raw.descriptionText);
  const description = /<[a-z!/][^>]*>/i.test(cleaned) ? htmlToText(cleaned) : normalizeWhitespace(cleaned);
  const sections = splitRequirementSections(description);
  const reqSkills = new Set(extractSkills(sections.required.join("\n")));
  const prefSkills = new Set(extractSkills(sections.preferred.join("\n")));
  if (!sections.hasExplicitRequired) for (const s of extractSkills(sections.other.join("\n"))) if (!prefSkills.has(s)) reqSkills.add(s);
  for (const s of reqSkills) prefSkills.delete(s);
  const remote: RemoteMode = detectRemote(raw.location, description, raw.remoteHint);
  const salary = raw.salary ?? findSalaryInDescription(description);
  const canonicalUrl = canonicalizeUrl(raw.url);
  return {
    id: jobId(raw.sourceId, raw.externalId, canonicalUrl),
    sourceId: raw.sourceId,
    sourceType: raw.sourceType,
    externalId: raw.externalId,
    url: raw.url,
    canonicalUrl,
    applyUrl: raw.applyUrl ?? null,
    employer: raw.employer.trim(),
    title: raw.title.trim(),
    description,
    location: raw.location.trim(),
    remote,
    remoteRegions: detectRemoteRegions(raw.location, description),
    salary,
    employmentType: parseEmploymentType(`${raw.title}\n${description}`, raw.employmentTypeHint),
    experienceYearsMin: parseExperienceYears(sections.required.length ? sections.required.join("\n") : description),
    requiredSkills: [...reqSkills],
    preferredSkills: [...prefSkills],
    requiredDegree: parseRequiredDegree(sections.required.length ? sections.required : sections.other),
    postedAt: raw.postedAt ?? null,
    expiresAt: raw.expiresAt ?? null,
    availability: raw.availability ?? "OPEN",
    retrievedAt: raw.retrievedAt,
    fingerprint: jobFingerprint(raw.employer, raw.title, raw.location),
    alsoSeen: [],
    injectionSignals: detectInjection(description),
    descriptionMissing: description.length < 80,
  };
}
