import { describe, expect, it } from "vitest";
import { assessSalary, parseSalaryText, toMonthlyAed } from "@/lib/agent/jobs/salary";
import { assessGeography, detectRemoteRegions } from "@/lib/agent/jobs/location";
import { canonicalizeUrl, jobFingerprint, normalizeJob } from "@/lib/agent/jobs/normalize";
import { findDuplicate, mergeJobs } from "@/lib/agent/jobs/dedupe";
import { htmlToText } from "@/lib/agent/text";
import { defaultPreferences } from "@/lib/agent/defaults";
import { greenhouse } from "@/lib/agent/connectors/greenhouse";
import { lever } from "@/lib/agent/connectors/lever";
import { ashby } from "@/lib/agent/connectors/ashby";
import { RateLimitedError } from "@/lib/agent/connectors/types";
import { parseAlertEmail } from "@/lib/agent/connectors/email";
import { GREENHOUSE_BOARD, LEVER_POSTINGS, ASHBY_BOARD, mockFetch } from "./fixtures/jobs";
import { NOW } from "./helpers";
import type { Source } from "@/lib/agent/types";

const prefs = defaultPreferences();
const src = (type: Source["type"], token: string, name: string): Source => ({ id: `src_${token}`, type, name, token, enabled: true, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastJobCount: null, retryAfter: null, createdAt: NOW.toISOString() });
const ctxFor = (f: ReturnType<typeof mockFetch>) => ({ fetch: f as never, now: () => NOW });

describe("salary normalisation", () => {
  it("normalises currencies and pay periods to AED per month", () => {
    const usdYear = parseSalaryText("$120k - $150k per year")!;
    expect(usdYear).toMatchObject({ currency: "USD", period: "YEAR", min: 120000, max: 150000 });
    expect(toMonthlyAed(usdYear)).toEqual({ min: Math.round((120000 * 3.6725) / 12), max: Math.round((150000 * 3.6725) / 12) });
    expect(toMonthlyAed(parseSalaryText("AED 12,000 per month")!)).toEqual({ min: 12000, max: 12000 });
    expect(toMonthlyAed({ min: 100, max: 100, currency: "AED", period: "HOUR", basis: "UNKNOWN", raw: "" })!.min).toBe(17333);
    expect(toMonthlyAed({ min: 1000, max: 1000, currency: "AED", period: "WEEK", basis: "UNKNOWN", raw: "" })!.min).toBe(4333);
  });
  it("applies the AED 10,000/month floor (= AED 120,000/year)", () => {
    const yr = (n: number) => ({ min: n, max: n, currency: "AED", period: "YEAR" as const, basis: "BASE" as const, raw: "" });
    expect(assessSalary(yr(120000), prefs).result).toBe("PASS");
    expect(assessSalary(yr(119000), prefs).result).toBe("FAIL");
    expect(assessSalary(parseSalaryText("AED 8,000 - 9,500 per month")!, prefs).result).toBe("FAIL");
    expect(assessSalary(parseSalaryText("AED 9,000 - 13,000 per month")!, prefs)).toMatchObject({ result: "PASS", confidence: "MEDIUM" });
  });
  it("never treats unknown salary or unknown period as a match", () => {
    expect(assessSalary(null, prefs)).toMatchObject({ result: "UNKNOWN", confidence: "UNKNOWN" });
    const noPeriod = parseSalaryText("AED 15,000 - 20,000")!;
    expect(noPeriod.period).toBe("UNKNOWN");
    expect(assessSalary(noPeriod, prefs).result).toBe("UNKNOWN");
    expect(assessSalary({ min: 5000, max: 6000, currency: "XYZ", period: "MONTH", basis: "BASE", raw: "" }, prefs).result).toBe("UNKNOWN");
  });
  it("distinguishes base from total compensation", () => {
    const total = parseSalaryText("AED 25,000 per month total compensation including bonus")!;
    expect(total.basis).toBe("TOTAL");
    expect(assessSalary(total, prefs)).toMatchObject({ result: "UNKNOWN", confidence: "LOW" });
    expect(assessSalary(parseSalaryText("AED 6,000 per month total package")!, prefs).result).toBe("FAIL");
  });
});

describe("geography", () => {
  const geo = (location: string, description = "", remote: "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN" = "REMOTE") =>
    assessGeography({ location, remote, remoteRegions: detectRemoteRegions(location, description), description }, prefs);
  it("accepts UAE roles and remote roles that name the UAE or Gulf", () => {
    expect(geo("Dubai, UAE", "", "ONSITE").result).toBe("PASS");
    expect(geo("Remote - UAE").status).toBe("CONFIRMED");
    expect(geo("Remote - Middle East").status).toBe("LIKELY");
  });
  it("rejects remote roles restricted to other regions and non-UAE onsite roles", () => {
    expect(geo("Remote - United States").result).toBe("FAIL");
    expect(geo("Remote", "Open to candidates in the UK and Europe only").result).toBe("FAIL");
    expect(geo("London, UK", "", "ONSITE").result).toBe("FAIL");
  });
  it("keeps unspecified remote regions uncertain", () => {
    expect(geo("Remote").result).toBe("UNKNOWN");
  });
  it("does not confuse relocation with eligibility", () => {
    expect(assessGeography({ location: "Berlin", remote: "ONSITE", remoteRegions: [], description: "" }, { relocationEnabled: true }).result).toBe("UNKNOWN");
  });
});

describe("normalisation and deduplication", () => {
  it("canonicalises URLs by stripping tracking but keeping identity", () => {
    expect(canonicalizeUrl("https://www.Boards.greenhouse.io/acme/jobs/1/?utm_source=x&gh_src=y#top")).toBe("https://boards.greenhouse.io/acme/jobs/1");
    expect(canonicalizeUrl("https://x.com/careers?gh_jid=77&utm_medium=z")).toBe("https://x.com/careers?gh_jid=77");
  });
  it("fingerprints ignore company suffixes, case and remote labels but keep seniority", () => {
    expect(jobFingerprint("Acme AI Inc.", "AI Engineer", "Dubai")).toBe(jobFingerprint("ACME AI", "ai engineer", "Dubai (Hybrid)"));
    expect(jobFingerprint("Acme", "AI Engineer", "Dubai")).not.toBe(jobFingerprint("Acme", "Senior AI Engineer", "Dubai"));
  });
  it("detects duplicates by source id, canonical URL and fingerprint, and merges cross-source copies", async () => {
    const gh = await greenhouse.fetchJobs(src("greenhouse", "acmeai", "Acme AI"), ctxFor(mockFetch({ "https://boards-api.greenhouse.io/v1/boards/acmeai": GREENHOUSE_BOARD })));
    const a = normalizeJob(gh[0]);
    expect(findDuplicate(normalizeJob(gh[0]), [a])?.reason).toBe("SOURCE_ID");
    const viaUrl = { ...normalizeJob({ ...gh[0], sourceId: "other", externalId: null }), id: "x" };
    expect(findDuplicate(viaUrl, [a])?.reason).toBe("CANONICAL_URL");
    const viaFp = normalizeJob({ ...gh[0], sourceId: "other2", externalId: "zzz", url: "https://jobs.example.com/ai-1", employer: "ACME AI Inc" });
    const dup = findDuplicate(viaFp, [a]);
    expect(dup?.reason).toBe("FINGERPRINT");
    const merged = mergeJobs(a, viaFp);
    expect(merged.id).toBe(a.id);
    expect(merged.alsoSeen).toHaveLength(1);
  });
  it("converts HTML to inert text", () => {
    const t = htmlToText("<p>Hello <b>there</b></p><script>alert(1)</script><ul><li>One</li></ul>&lt;img src=x onerror=alert(1)&gt;");
    expect(t).not.toContain("alert(1)</");
    expect(t).toContain("• One");
    expect(t).not.toContain("<script");
  });
});

describe("connectors", () => {
  it("Greenhouse: normalises the shared schema", async () => {
    const f = mockFetch({ "https://boards-api.greenhouse.io/v1/boards/acmeai/jobs?content=true": GREENHOUSE_BOARD });
    const raw = await greenhouse.fetchJobs(src("greenhouse", "acmeai", "Acme AI"), ctxFor(f));
    expect(f.calls[0]).toContain("/boards/acmeai/jobs");
    const j = normalizeJob(raw[0]);
    expect(j).toMatchObject({ employer: "Acme AI", title: "Applied AI Engineer", externalId: "4001", remote: "ONSITE", employmentType: "FULL_TIME", requiredDegree: "BACHELOR", experienceYearsMin: 2 });
    expect(j.canonicalUrl).toBe("https://boards.greenhouse.io/acmeai/jobs/4001");
    expect(j.salary).toMatchObject({ currency: "AED", period: "MONTH", basis: "BASE", min: 18000, max: 24000 });
    expect(j.requiredSkills).toEqual(expect.arrayContaining(["Python", "SQL", "RAG", "LLM integration", "PostgreSQL", "Docker"]));
    expect(j.preferredSkills).toEqual(expect.arrayContaining(["Kubernetes", "NetSuite"]));
    expect(j.requiredSkills).not.toContain("Kubernetes");
    expect(j.description).not.toMatch(/<[a-z]/i);
  });
  it("Lever: reads structured salary, lists and workplace type", async () => {
    const raw = await lever.fetchJobs(src("lever", "globexai", "Globex AI"), ctxFor(mockFetch({ "https://api.lever.co/v0/postings/globexai": LEVER_POSTINGS })));
    const j = normalizeJob(raw[0]);
    expect(j).toMatchObject({ remote: "HYBRID", employmentType: "FULL_TIME", salary: { currency: "AED", period: "MONTH", min: 15000 } });
    expect(j.requiredSkills).toEqual(expect.arrayContaining(["Python", "RAG"]));
    expect(j.preferredSkills).toContain("LangChain");
  });
  it("Ashby: skips unlisted jobs and flags remote regions", async () => {
    const raw = await ashby.fetchJobs(src("ashby", "initech", "Initech"), ctxFor(mockFetch({ "https://api.ashbyhq.com/posting-api/job-board/initech": ASHBY_BOARD })));
    expect(raw).toHaveLength(1);
    const j = normalizeJob(raw[0]);
    expect(j.remote).toBe("REMOTE");
    expect(j.remoteRegions).toContain("MIDDLE EAST");
    expect(j.salary).toMatchObject({ currency: "USD", period: "YEAR", min: 60000 });
  });
  it("honours 429 Retry-After and rejects unsafe tokens", async () => {
    await expect(greenhouse.fetchJobs(src("greenhouse", "acmeai", "A"), ctxFor(mockFetch({ "https://boards-api.greenhouse.io": { status: 429, headers: { "retry-after": "120" } } })))).rejects.toMatchObject({ retryAfterSeconds: 120 });
    await expect(greenhouse.fetchJobs(src("greenhouse", "../etc/passwd", "A"), ctxFor(mockFetch({})))).rejects.toThrow(/Invalid board token/);
    expect(new RateLimitedError(5).retryAfterSeconds).toBe(5);
  });
  it("parses alert emails deterministically without following links", () => {
    const links = parseAlertEmail(`<a href="https://jobs.lever.co/globexai/lev-1?utm_source=email">LLM Engineer</a> <a href="https://x.com/unsubscribe">no</a> https://boards.greenhouse.io/acmeai/jobs/4001`);
    expect(links.map((l) => l.ats)).toEqual(["lever", "greenhouse"]);
    expect(links[0].title).toBe("LLM Engineer");
  });
});
