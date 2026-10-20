import { describe, expect, it } from "vitest";
import { normalizeJob, type RawJob } from "@/lib/agent/jobs/normalize";
import { greenhouse } from "@/lib/agent/connectors/greenhouse";
import { buildMatch } from "@/lib/agent/matching/score";
import { evaluateEligibility, titleSeniority } from "@/lib/agent/matching/eligibility";
import { defaultPreferences } from "@/lib/agent/defaults";
import { GREENHOUSE_BOARD, mockFetch } from "./fixtures/jobs";
import { NOW, sampleProfile } from "./helpers";
import type { Application, Job } from "@/lib/agent/types";

const prefs = defaultPreferences();
const profile = sampleProfile();

async function jobs(): Promise<Job[]> {
  const raw = await greenhouse.fetchJobs(
    { id: "src_acme", type: "greenhouse", name: "Acme AI", token: "acmeai", enabled: true, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastJobCount: null, retryAfter: null, createdAt: "" },
    { fetch: mockFetch({ "https://boards-api.greenhouse.io": GREENHOUSE_BOARD }) as never, now: () => NOW },
  );
  return raw.map(normalizeJob);
}
const base = (j: Job, apps: Application[] = []) => ({ job: j, profile, prefs, applications: apps, now: NOW });
const find = (js: Job[], t: string) => js.find((j) => j.title === t)!;
const check = (o: ReturnType<typeof evaluateEligibility>, id: string) => o.checks.find((c) => c.id === id)!;

describe("Stage A: hard eligibility", () => {
  it("passes a UAE role with published base salary above the floor", async () => {
    const o = evaluateEligibility(base(find(await jobs(), "Applied AI Engineer")));
    expect(check(o, "salary").result).toBe("PASS");
    expect(check(o, "geography").result).toBe("PASS");
    expect(o.eligibility).not.toBe("INELIGIBLE");
  });
  it("fails a US-only senior role and records every reason", async () => {
    const o = evaluateEligibility(base(find(await jobs(), "Senior Staff Machine Learning Engineer")));
    expect(o.eligibility).toBe("INELIGIBLE");
    const failed = o.checks.filter((c) => c.result === "FAIL").map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["geography", "seniority", "years", "authorization"]));
    expect(o.checks.every((c) => c.reason.length > 0)).toBe(true);
  });
  it("keeps unknown salary and unknown remote region UNCERTAIN, not failed or confirmed", async () => {
    const j = find(await jobs(), "Generative AI Engineer");
    const o = evaluateEligibility(base(j));
    expect(check(o, "salary").result).toBe("UNKNOWN");
    expect(check(o, "geography").result).toBe("PASS");
    expect(check(o, "geography").reason).toMatch(/confirm/i);
    expect(o.eligibility).toBe("UNCERTAIN");
  });
  it("rejects expired and closed listings", async () => {
    const j = find(await jobs(), "Applied AI Engineer");
    expect(check(evaluateEligibility(base({ ...j, expiresAt: "2026-10-01T00:00:00Z" })), "availability").result).toBe("FAIL");
    expect(check(evaluateEligibility(base({ ...j, availability: "CLOSED" })), "availability").result).toBe("FAIL");
  });
  it("rejects incompatible employment arrangements", async () => {
    const j = find(await jobs(), "Applied AI Engineer");
    expect(check(evaluateEligibility(base({ ...j, employmentType: "CONTRACT" })), "employment").result).toBe("FAIL");
  });
  it("blocks duplicate applications (by job id or cross-source fingerprint)", async () => {
    const j = find(await jobs(), "Applied AI Engineer");
    const app = { id: "a1", jobId: "other-id", fingerprint: j.fingerprint, status: "SUBMITTED" } as Application;
    expect(check(evaluateEligibility(base(j, [app])), "duplicate").result).toBe("FAIL");
    expect(check(evaluateEligibility(base(j, [{ ...app, status: "READY_FOR_REVIEW" } as Application])), "duplicate").result).toBe("PASS");
  });
  it("requires a PhD only when the posting makes it mandatory", async () => {
    const j = find(await jobs(), "Applied AI Engineer");
    expect(check(evaluateEligibility(base({ ...j, requiredDegree: "PHD" })), "degree").result).toBe("FAIL");
    expect(check(evaluateEligibility(base({ ...j, requiredDegree: "MASTER" })), "degree").result).toBe("FAIL");
  });
  it("handles sponsorship and citizenship statements without guessing", async () => {
    const j = find(await jobs(), "Applied AI Engineer");
    const ns = { ...j, description: j.description + "\nWe do not provide visa sponsorship." };
    expect(check(evaluateEligibility(base(ns)), "authorization").result).toBe("UNKNOWN");
    expect(check(evaluateEligibility({ ...base(ns), prefs: { ...prefs, workAuthorization: "NEEDS_SPONSORSHIP" } }), "authorization").result).toBe("FAIL");
    expect(check(evaluateEligibility(base({ ...j, description: j.description + "\nUAE nationals only." })), "authorization").result).toBe("FAIL");
  });
  it("classifies title seniority", () => {
    expect(titleSeniority("Senior AI Engineer")).toBe("SENIOR");
    expect(titleSeniority("Head of AI")).toBe("PRINCIPAL");
    expect(titleSeniority("AI Engineer")).toBe("MID");
    expect(titleSeniority("Junior Developer")).toBe("JUNIOR");
  });
});

describe("Stage B: relevance scoring", () => {
  it("scores with configurable weights summing to a 0-100 score and explains each part", async () => {
    const m = buildMatch(base(find(await jobs(), "Applied AI Engineer")));
    expect(m.score).toBeGreaterThan(60);
    expect(Object.keys(m.breakdown).sort()).toEqual(["compensation", "evidence", "product", "seniority", "technical"]);
    const demonstrated = m.matched.filter((x) => x.strength === "DEMONSTRATED").map((x) => x.requirement);
    expect(demonstrated).toEqual(expect.arrayContaining(["Python", "RAG"]));
    for (const x of m.matched.filter((x) => x.strength !== "LISTED_ONLY")) expect(x.factIds.length).toBeGreaterThan(0);
    expect(m.gaps.map((g) => g.requirement)).toContain("Kubernetes");
    expect(m.salaryConfidence).toBe("HIGH");
    expect(m.geoEligibility).toBe("CONFIRMED");
    expect(m.cvEmphasis.length).toBeGreaterThan(0);
  });
  it("weights evidence over keywords: a skills-list entry alone earns less than work evidence", async () => {
    const j = { ...find(await jobs(), "Applied AI Engineer"), requiredSkills: ["Scikit-learn", "Python", "RAG"], preferredSkills: [] };
    const m = buildMatch(base(j));
    const sk = m.matched.find((x) => x.requirement === "Scikit-learn")!;
    expect(sk.strength).toBe("LISTED_ONLY");
    expect(m.gaps.find((g) => g.requirement === "Scikit-learn")?.kind).toBe("WEAK");
    expect(m.breakdown.evidence).toBeLessThan(m.breakdown.technical);
  });
  it("does not count unverified facts as evidence", async () => {
    const unverified = sampleProfile(false);
    const j = find(await jobs(), "Applied AI Engineer");
    const m = buildMatch({ job: j, profile: unverified, prefs, applications: [], now: NOW });
    expect(m.matched).toHaveLength(0);
  });
  it("hard failures override the weighted score", async () => {
    const m = buildMatch(base(find(await jobs(), "Senior Staff Machine Learning Engineer")));
    expect(m.eligibility).toBe("INELIGIBLE");
    expect(m.score).toBe(0);
    expect(m.recommendation).toBe("SKIP");
    expect(m.explanation).toMatch(/Not eligible/);
  });
  it("never auto-recommends APPLY when something is uncertain", async () => {
    const m = buildMatch(base(find(await jobs(), "Generative AI Engineer")));
    expect(m.recommendation).not.toBe("APPLY");
    expect(m.eligibility).toBe("UNCERTAIN");
  });
  it("responds to configured weights", async () => {
    const j = find(await jobs(), "Applied AI Engineer");
    const a = buildMatch(base(j)).score!;
    const b = buildMatch({ ...base(j), prefs: { ...prefs, weights: { technical: 0, evidence: 0, seniority: 0, compensation: 0, product: 1 } } }).score!;
    expect(a).not.toBe(b);
  });
});

describe("prompt-injection in job text is data only", () => {
  it("flags injection signals and never changes scoring facts", async () => {
    const j = find(await jobs(), "AI Engineer");
    expect(j.injectionSignals).toEqual(expect.arrayContaining(["ignore-previous-instructions"]));
    const m = buildMatch(base(j));
    expect(m.matched.flatMap((x) => x.evidence).join(" ")).not.toMatch(/10 years|MIT/);
    expect(m.matched.map((x) => x.requirement)).not.toContain("Kubernetes");
  });
});

void ({} as RawJob);
