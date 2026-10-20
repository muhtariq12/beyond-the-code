import { extractSkills } from "../skills";
import { formatDateRange } from "../profile/import";
import { isTechFact } from "../profile/facts";
import type { ClaimCheck, CvDoc, CvSection, Entry, Fact, Profile, Validation } from "../types";

/** Words that would upgrade seniority or ownership; allowed only if a cited fact already says so. */
const INFLATION = ["senior", "lead", "led", "leading", "leader", "manager", "managed", "managing", "head", "principal", "director", "architect", "architected", "spearheaded", "founded", "owned", "executive", "expert"];
/** Impact verbs that assert an outcome; allowed only if a cited fact already says so. */
const IMPACT = ["increased", "reduced", "improved", "saved", "boosted", "grew", "cut", "accelerated", "optimized", "optimised", "doubled", "tripled", "generated", "delivered", "drove", "achieved", "revenue", "savings"];

const stem = (w: string) => w.toLowerCase().slice(0, 5);
const words = (s: string) => s.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];

function numbers(s: string): string[] {
  return [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
}

/** Check one piece of generated text against the facts it cites. Returns the problem, or null. */
export function checkClaim(text: string, facts: Fact[], profile: Profile): string | null {
  if (facts.length === 0) return "Cites no fact.";
  const bad = facts.find((f) => !f.verified);
  if (bad) return "Cites a fact that has not been verified.";
  const corpus = facts.map((f) => f.text).join(" \n ");
  const entryText = facts
    .map((f) => profile.entries.find((e) => e.id === f.entryId))
    .filter((e): e is Entry => !!e)
    .map((e) => `${e.title} ${e.org}`)
    .join(" ");
  const allowedNumbers = new Set([...facts.flatMap((f) => f.metrics), ...numbers(corpus), ...numbers(entryText)]);
  for (const n of numbers(text)) if (!allowedNumbers.has(n)) return `Introduces the number "${n}" that is not in the cited evidence.`;

  const supportedSkills = new Set([...facts.flatMap((f) => f.skills), ...extractSkills(corpus), ...extractSkills(entryText)]);
  for (const s of extractSkills(text)) if (!supportedSkills.has(s)) return `Mentions "${s}" but the cited evidence does not.`;

  const corpusWords = new Set(words(`${corpus} ${entryText}`).map(stem));
  for (const w of words(text)) {
    if (INFLATION.includes(w) && !corpusWords.has(stem(w))) return `Uses "${w}", which would upgrade seniority or ownership beyond the evidence.`;
    if (IMPACT.includes(w) && !corpusWords.has(stem(w))) return `Asserts an outcome ("${w}") that the cited evidence does not state.`;
  }

  // Capitalised terms mid-sentence (employers, products, tools, titles) must come from the evidence.
  const lowerCorpus = `${corpus} ${entryText} ${profile.skills.map((s) => s.label).join(" ")}`.toLowerCase();
  const tokens = text.replace(/[.!?]\s+/g, ". ").split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i].replace(/^[("'[]+|[)"'\],.;:!?]+$/g, "");
    if (/^[A-Z][A-Za-z0-9.+#/-]{2,}$/.test(t) && !tokens[i - 1].endsWith(".") && !lowerCorpus.includes(t.toLowerCase())) {
      return `Introduces the proper noun "${t}" that is not in the cited evidence.`;
    }
  }
  const yrs = text.match(/(\d+)\+?\s*years?/i);
  if (yrs && !new RegExp(`${yrs[1]}\\+?\\s*years?`, "i").test(corpus)) return `Claims "${yrs[0]}" which is not stated in the evidence.`;
  return null;
}

function checkSection(sec: CvSection, kind: "EMPLOYMENT" | "PROJECT" | "EDUCATION" | "CERTIFICATION" | "PUBLICATION" | "AWARD" | "CERT_OR_AWARD", profile: Profile, where: string, out: { claims: ClaimCheck[]; violations: string[] }) {
  const entry = profile.entries.find((e) => e.id === sec.entryId);
  const okKinds = kind === "CERT_OR_AWARD" ? ["CERTIFICATION", "AWARD"] : [kind];
  if (!entry) {
    out.violations.push(`${where}: "${sec.title}" does not exist in the verified profile.`);
    return;
  }
  if (!okKinds.includes(entry.type)) out.violations.push(`${where}: "${sec.title}" is a ${entry.type.toLowerCase()} and cannot appear in this section (projects are never presented as employment).`);
  if (!entry.verified) out.violations.push(`${where}: "${sec.title}" is not verified.`);
  if (sec.title !== entry.title) out.violations.push(`${where}: title "${sec.title}" differs from the verified title "${entry.title}".`);
  if (sec.org !== entry.org) out.violations.push(`${where}: organisation "${sec.org}" differs from the verified "${entry.org}".`);
  if (sec.dates !== formatDateRange(entry)) out.violations.push(`${where}: dates "${sec.dates}" differ from the verified dates "${formatDateRange(entry)}".`);
  for (const [i, b] of sec.bullets.entries()) {
    const facts = b.factIds.map((id) => profile.facts.find((f) => f.id === id)).filter((f): f is Fact => !!f);
    let problem = facts.length !== b.factIds.length ? "Cites a fact that does not exist." : checkClaim(b.text, facts, profile);
    if (!problem && facts.some((f) => f.entryId !== entry.id)) problem = "Cites evidence from a different role or project.";
    out.claims.push({ location: `${where} › ${sec.title} › bullet ${i + 1}`, text: b.text, status: problem ? "UNSUPPORTED" : "VERIFIED", factIds: b.factIds, problem });
    if (problem) out.violations.push(`${sec.title}: "${b.text.slice(0, 80)}": ${problem}`);
  }
  if (sec.tech) {
    const techFact = profile.facts.find((f) => f.entryId === entry.id && isTechFact(f) && f.verified);
    const allowed = new Set((techFact?.text.replace("Technologies: ", "") ?? "").split(/,\s*(?![^()]*\))/).map((s) => s.trim().toLowerCase()));
    for (const t of sec.tech) if (!allowed.has(t.toLowerCase())) out.violations.push(`${sec.title}: technology "${t}" is not in the verified project record.`);
  }
}

export function validateCv(doc: CvDoc, profile: Profile): Validation {
  const out = { claims: [] as ClaimCheck[], violations: [] as string[] };

  if (doc.header.name !== profile.fullName) out.violations.push("Header name differs from the profile.");

  const sFacts = doc.summary.factIds.map((id) => profile.facts.find((f) => f.id === id)).filter((f): f is Fact => !!f);
  if (doc.summary.text.trim()) {
    const problem = sFacts.length !== doc.summary.factIds.length ? "Cites a fact that does not exist." : checkClaim(doc.summary.text, sFacts, profile);
    out.claims.push({ location: "Summary", text: doc.summary.text, status: problem ? "UNSUPPORTED" : "VERIFIED", factIds: doc.summary.factIds, problem });
    if (problem) out.violations.push(`Summary: ${problem}`);
  }

  const verified = new Map(profile.skills.filter((s) => s.verified).map((s) => [s.label.toLowerCase(), s]));
  for (const row of doc.skills) {
    for (const item of row.items) {
      const s = verified.get(item.toLowerCase());
      const ok = !!s;
      out.claims.push({ location: `Skills › ${row.label}`, text: item, status: ok ? "VERIFIED" : "UNSUPPORTED", factIds: [], problem: ok ? null : "Skill is not in the verified skill list." });
      if (!ok) out.violations.push(`Skills: "${item}" is not a verified skill.`);
    }
  }

  doc.experience.forEach((s) => checkSection(s, "EMPLOYMENT", profile, "Experience", out));
  doc.projects.forEach((s) => checkSection(s, "PROJECT", profile, "Projects", out));
  doc.education.forEach((s) => checkSection(s, "EDUCATION", profile, "Education", out));
  doc.certifications.forEach((s) => checkSection(s, "CERT_OR_AWARD", profile, "Certifications", out));
  doc.publications.forEach((s) => checkSection(s, "PUBLICATION", profile, "Publications", out));

  return { pass: out.violations.length === 0, claims: out.claims, violations: out.violations };
}
