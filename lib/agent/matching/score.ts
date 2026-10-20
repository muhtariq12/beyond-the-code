import { isTechFact, verifiedFacts } from "../profile/facts";
import type { Entry, Fact, Job, Match, Preferences, Profile } from "../types";
import { evaluateEligibility, seniorityRank, titleSeniority, type EligibilityInput } from "./eligibility";
import { norm } from "../text";

type Strength = Match["matched"][number]["strength"];

interface Evidence {
  strength: Strength;
  facts: Fact[];
}

/** Evidence for a skill: employment work outranks personal projects, which outrank a bare skills-list entry. */
export function evidenceFor(skill: string, profile: Profile): Evidence | null {
  const facts = verifiedFacts(profile);
  const entry = (f: Fact): Entry | undefined => profile.entries.find((e) => e.id === f.entryId);
  const used = facts.filter((f) => f.skills.includes(skill));
  const work = used.filter((f) => entry(f)?.type === "EMPLOYMENT" && !isTechFact(f));
  if (work.length) return { strength: "DEMONSTRATED", facts: work.slice(0, 3) };
  const proj = used.filter((f) => ["PROJECT", "EDUCATION", "PUBLICATION"].includes(entry(f)?.type ?? "") || (f.entryId === null));
  if (proj.length) return { strength: "PROJECT_ONLY", facts: proj.slice(0, 3) };
  const other = used.filter((f) => f.entryId);
  if (other.length) return { strength: "PROJECT_ONLY", facts: other.slice(0, 2) };
  if (profile.skills.some((s) => s.verified && s.name === skill)) return { strength: "LISTED_ONLY", facts: [] };
  return null;
}

const STRENGTH_W: Record<Strength, number> = { DEMONSTRATED: 1, PROJECT_ONLY: 0.7, LISTED_ONLY: 0.35 };

const PRODUCT_TERMS = /\b(ai product|llm|rag|agent|generative|genai|applied ai|copilot|assistant|chatbot|foundation model|prompt|ml platform)\b/i;

export function scoreRelevance(inp: EligibilityInput, elig = evaluateEligibility(inp)): Pick<Match, "score" | "breakdown" | "matched" | "gaps" | "cvEmphasis"> {
  const { job, profile, prefs } = inp;
  const matched: Match["matched"] = [];
  const gaps: Match["gaps"] = [];

  const consider = (skills: string[], weight: number) => {
    let sum = 0;
    for (const s of skills) {
      const ev = evidenceFor(s, profile);
      if (!ev) gaps.push({ requirement: s, kind: "MISSING" });
      else {
        sum += STRENGTH_W[ev.strength];
        if (ev.strength === "LISTED_ONLY") gaps.push({ requirement: s, kind: "WEAK" });
        matched.push({ requirement: s, strength: ev.strength, factIds: ev.facts.map((f) => f.id), evidence: ev.facts.map((f) => f.text) });
      }
    }
    return { sum, n: skills.length, weight };
  };
  const req = consider(job.requiredSkills, 1);
  const pref = consider(job.preferredSkills, 0.5);

  // Technical: skill coverage (listed or evidenced) weighted by required vs preferred
  const covered = (skills: string[]) => skills.filter((s) => evidenceFor(s, profile)).length;
  const techDen = req.n * 1 + pref.n * 0.5;
  const technical = techDen === 0 ? 0.4 : (covered(job.requiredSkills) * 1 + covered(job.preferredSkills) * 0.5) / techDen;

  // Evidence-backed experience: strength-weighted, so a keyword in a skills list earns little
  const evDen = req.n + pref.n * 0.5;
  const evidence = evDen === 0 ? 0.3 : (req.sum + pref.sum * 0.5) / evDen;

  // Seniority and responsibility fit
  const level = titleSeniority(job.title);
  const maxRank = seniorityRank(prefs.maxSeniority);
  let seniority = 1 - Math.max(0, Math.abs(seniorityRank(level) - Math.min(2, maxRank))) * 0.25;
  if (job.experienceYearsMin != null) seniority -= Math.min(0.5, Math.max(0, job.experienceYearsMin - 2) * 0.1);
  seniority = Math.max(0, Math.min(1, seniority));

  // Compensation
  const sal = elig.salary;
  let compensation = 0.5;
  if (sal.result === "PASS") {
    const top = sal.aed?.max ?? sal.aed?.min ?? 0;
    compensation = Math.min(1, 0.7 + Math.min(0.3, (top - prefs.minSalaryAedMonthly) / (prefs.minSalaryAedMonthly * 2)));
    if (sal.confidence === "MEDIUM") compensation *= 0.9;
  } else if (sal.result === "FAIL") compensation = 0;

  // Career/product fit
  const titleN = norm(job.title);
  const roleHit = prefs.targetRoles.some((r) => titleN.includes(norm(r)) || norm(r).split(" ").every((w) => titleN.includes(w)));
  let product = roleHit ? 0.7 : 0.3;
  if (PRODUCT_TERMS.test(job.title)) product += 0.2;
  else if (PRODUCT_TERMS.test(job.description.slice(0, 2500))) product += 0.1;
  product = Math.min(1, product);

  const w = prefs.weights;
  const total = w.technical + w.evidence + w.seniority + w.compensation + w.product || 1;
  const parts = {
    technical: technical * w.technical,
    evidence: evidence * w.evidence,
    seniority: seniority * w.seniority,
    compensation: compensation * w.compensation,
    product: product * w.product,
  };
  const score = Math.round((Object.values(parts).reduce((a, b) => a + b, 0) / total) * 100);

  const cvEmphasis = matched
    .filter((m) => m.strength !== "LISTED_ONLY")
    .sort((a, b) => (a.strength === "DEMONSTRATED" ? 0 : 1) - (b.strength === "DEMONSTRATED" ? 0 : 1))
    .map((m) => m.requirement)
    .slice(0, 8);

  return {
    score,
    breakdown: {
      technical: Math.round(technical * 100),
      evidence: Math.round(evidence * 100),
      seniority: Math.round(seniority * 100),
      compensation: Math.round(compensation * 100),
      product: Math.round(product * 100),
    },
    matched,
    gaps,
    cvEmphasis,
  };
}

export function buildMatch(inp: EligibilityInput): Match {
  const elig = evaluateEligibility(inp);
  const rel = scoreRelevance(inp, elig);
  const { prefs } = inp;
  const failed = elig.checks.filter((c) => c.result === "FAIL");
  const unknown = elig.checks.filter((c) => c.result === "UNKNOWN");

  let recommendation: Match["recommendation"];
  let explanation: string;
  if (elig.eligibility === "INELIGIBLE") {
    recommendation = "SKIP";
    explanation = `Not eligible: ${failed.map((c) => c.reason).join(" ")}`;
  } else if (elig.eligibility === "UNCERTAIN" || (rel.score ?? 0) < prefs.thresholds.apply) {
    recommendation = (rel.score ?? 0) >= prefs.thresholds.review ? "REVIEW" : "SKIP";
    explanation =
      recommendation === "SKIP"
        ? `Relevance ${rel.score}/100 is below the review threshold (${prefs.thresholds.review}).`
        : `Worth a look (relevance ${rel.score}/100) but needs your input: ${unknown.map((c) => c.label.toLowerCase() + " - " + c.reason).join(" ")}`.trim();
  } else {
    recommendation = "APPLY";
    explanation = `Eligible with relevance ${rel.score}/100. ${rel.matched.filter((m) => m.strength === "DEMONSTRATED").length} requirements are demonstrated in your work, ${rel.gaps.filter((g) => g.kind === "MISSING").length} missing.`;
  }
  return {
    id: `m_${inp.job.id}`,
    jobId: inp.job.id,
    eligibility: elig.eligibility,
    checks: elig.checks,
    // Hard failures override the weighted score; keep it for transparency but do not rank by it.
    score: elig.eligibility === "INELIGIBLE" ? 0 : rel.score,
    breakdown: rel.breakdown,
    matched: rel.matched,
    gaps: rel.gaps,
    salaryConfidence: elig.salary.confidence,
    salaryAedMonthly: elig.salary.aed,
    geoEligibility: elig.geo.status,
    cvEmphasis: rel.cvEmphasis,
    recommendation,
    explanation,
    computedAt: inp.now.toISOString(),
    profileUpdatedAt: inp.profile.updatedAt,
  };
}

export type { Preferences };
