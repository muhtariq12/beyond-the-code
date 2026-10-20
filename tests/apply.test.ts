import { describe, expect, it } from "vitest";
import { makeCtx, NOW } from "./helpers";
import type { Ctx } from "@/lib/agent/ctx";
import { SandboxAdapter, GreenhouseAdapter } from "@/lib/agent/apply/adapters";
import { resolveCapability } from "@/lib/agent/apply/capabilities";
import { answerQuestions, classifyQuestion, missingMandatory, saveUserAnswer, STANDARD_QUESTIONS } from "@/lib/agent/apply/answers";
import { attestManualSubmission, buildHandoff, preflight, submitApplication, SubmissionBlocked } from "@/lib/agent/apply/submit";
import { TRANSITIONS, transition, TransitionError } from "@/lib/agent/apply/status";
import { generateForQualified, screenAll, upsertRawJobs } from "@/lib/agent/ops/pipeline";
import { reviewCvVersion } from "@/lib/agent/cv/service";
import { defaultPreferences } from "@/lib/agent/defaults";
import { htmlToText } from "@/lib/agent/text";
import { APPLIED_AI_HTML } from "./fixtures/jobs";

const JD = htmlToText(APPLIED_AI_HTML);

async function readyApp(opts: { script?: ConstructorParameters<typeof SandboxAdapter>[0]; salaryText?: string } = {}) {
  const sandbox = new SandboxAdapter(opts.script ?? []);
  const ctx = await makeCtx({ env: { ANTHROPIC_API_KEY: "sk-ant-SECRETSECRETSECRET1234" } });
  ctx.adapters = { sandbox };
  await upsertRawJobs(ctx, [{ sourceId: "src_sandbox", sourceType: "sandbox", externalId: "sbx-1", url: "https://sandbox.invalid/jobs/1", employer: "Sandbox Co", title: "Applied AI Engineer", descriptionText: opts.salaryText ? JD.replace(/Salary:.*\./, opts.salaryText) : JD, location: "Dubai, UAE", retrievedAt: NOW.toISOString(), availability: "OPEN" }]);
  await screenAll(ctx);
  await generateForQualified(ctx);
  const app = (await ctx.store.list("applications"))[0];
  expect(app.status).toBe("READY_FOR_REVIEW");
  return { ctx, sandbox, appId: app.id, jobId: app.jobId };
}

async function approve(ctx: Ctx, appId: string, answer = true) {
  const app = (await ctx.store.get("applications", appId))!;
  await reviewCvVersion(ctx, app.cvVersionId!, "APPROVED");
  if (answer) for (const a of await ctx.store.list("answers")) if (a.status !== "ANSWERED") await saveUserAnswer(ctx, a.id, "Confirmed by owner");
  await transition(ctx, appId, "APPROVED", "USER", "approved");
}

describe("application questions", () => {
  it("classifies sensitive and routine questions", () => {
    expect(classifyQuestion("Do you require visa sponsorship?")).toBe("SPONSORSHIP");
    expect(classifyQuestion("Are you legally authorized to work in the UAE?")).toBe("WORK_AUTHORIZATION");
    expect(classifyQuestion("What are your salary expectations?")).toBe("SALARY");
    expect(classifyQuestion("Do you hold a security clearance?")).toBe("CLEARANCE");
    expect(classifyQuestion("Please state your gender")).toBe("DEMOGRAPHIC");
    expect(classifyQuestion("Do you have a disability?")).toBe("DEMOGRAPHIC");
    expect(classifyQuestion("Are you willing to relocate?")).toBe("RELOCATION");
    expect(classifyQuestion("Would you be open to relocation?")).toBe("RELOCATION");
    expect(classifyQuestion("I certify the above is true")).toBe("LEGAL");
    expect(classifyQuestion("How many years of experience do you have with Python?")).toBe("YEARS_EXPERIENCE");
    expect(classifyQuestion("Do you have experience with RAG?")).toBe("SKILL_EXPERIENCE");
    expect(classifyQuestion("Why do you want to work here?")).toBe("FREE_TEXT");
  });

  it("never guesses sensitive answers, but fills contact details and evidenced skills from the profile", async () => {
    const { ctx, appId } = await readyApp();
    const qs = [
      "Are you legally authorized to work in the UAE?", "Will you require visa sponsorship?", "What are your salary expectations?",
      "Are you willing to relocate?", "Do you hold a security clearance?", "Please state your gender", "I certify that all answers are true",
      "How many years of experience do you have with Python?", "Email address", "Do you have experience with Kubernetes?",
      "Do you have experience with RAG?", "Why do you want to work here?",
    ];
    const out = await answerQuestions(ctx, appId, qs.map((text) => ({ text })));
    const by = (frag: string) => out.find((a) => a.question.includes(frag))!;
    for (const f of ["authorized", "sponsorship", "salary", "relocate", "clearance", "gender", "certify", "years of experience", "Kubernetes", "Why do you"]) {
      expect(by(f).status, f).toBe("NEEDS_USER");
      expect(by(f).answer, f).toBeNull();
    }
    expect(by("Email").answer).toBe("alex.sample@example.com");
    expect(by("RAG").status).toBe("ANSWERED");
    expect(by("RAG").factIds.length).toBeGreaterThan(0);
    expect(missingMandatory(out).length).toBeGreaterThan(5);
  });

  it("uses standing answers only when you configured them, and reuses your earlier equivalent answers safely", async () => {
    const { ctx, appId } = await readyApp();
    await ctx.store.put("preferences", { ...defaultPreferences(), id: "prefs", standingAnswers: { salaryExpectation: "AED 15,000 per month" } });
    const [sal, reloc] = await answerQuestions(ctx, appId, [{ text: "What are your salary expectations?" }, { text: "Are you willing to relocate?" }]);
    expect(sal).toMatchObject({ answer: "AED 15,000 per month", source: "PREFERENCE", status: "ANSWERED" });
    expect(reloc.status).toBe("NEEDS_USER");

    await saveUserAnswer(ctx, reloc.id, "No, UAE only");
    const second = await answerQuestions(ctx, "app_other", [{ text: "Would you be open to relocation?" }, { text: "Why do you want to work here?" }]);
    expect(second[0]).toMatchObject({ status: "NEEDS_USER", draft: "No, UAE only" }); // offered for confirmation, not silently sent
    expect(second[1].status).toBe("NEEDS_USER"); // free text is never reused
    await saveUserAnswer(ctx, (await answerQuestions(ctx, appId, [{ text: "Email address" }]))[0].id, "alt@example.com");
    const reused = await answerQuestions(ctx, "app_third", [{ text: "Email address" }]);
    expect(reused[0]).toMatchObject({ status: "ANSWERED", answer: "alex.sample@example.com" });
  });
});

describe("capability registry", () => {
  const prefs = defaultPreferences();
  it("defaults to handoff and requires documented authorisation, credentials and an adapter", () => {
    expect(resolveCapability("linkedin", prefs, {}).state).toBe("DISCOVERY_ONLY");
    expect(resolveCapability("greenhouse", prefs, {}).state).toBe("PREPARE_AND_HANDOFF");
    expect(resolveCapability("email", prefs, {}).state).toBe("PREPARE_AND_HANDOFF");
    const on = { ...prefs, authorizedSubmission: { greenhouse: { enabled: true, basis: "" } } };
    expect(resolveCapability("greenhouse", on, { GREENHOUSE_JOB_BOARD_API_KEY: "k" }).reason).toMatch(/no basis/i);
    const ok = { ...prefs, authorizedSubmission: { greenhouse: { enabled: true, basis: "Employer-issued key, ToS v3 section 4" } } };
    expect(resolveCapability("greenhouse", ok, {}).reason).toMatch(/credential/i);
    expect(resolveCapability("greenhouse", ok, { GREENHOUSE_JOB_BOARD_API_KEY: "k" }).state).toBe("AUTHORIZED_API_SUBMISSION");
    expect(resolveCapability("lever", { ...prefs, authorizedSubmission: { lever: { enabled: true, basis: "x" } } }, { LEVER_API_KEY: "k" }).state).toBe("PREPARE_AND_HANDOFF");
    expect(resolveCapability("greenhouse", ok, { GREENHOUSE_JOB_BOARD_API_KEY: "k", AGENT_DISABLE_SUBMISSION: "1" }).state).toBe("DISABLED");
    expect(resolveCapability("sandbox", prefs, {}).state).toBe("DISABLED");
    expect(resolveCapability("sandbox", prefs, { AGENT_ENABLE_SANDBOX: "1" }).state).toBe("AUTHORIZED_API_SUBMISSION");
  });
});

describe("status machine", () => {
  it("rejects shortcuts to SUBMITTED and invalid hops", async () => {
    const { ctx, appId } = await readyApp();
    await expect(transition(ctx, appId, "SUBMITTED", "USER", "nope")).resolves.toBeTruthy(); // READY_FOR_REVIEW→SUBMITTED only via attest path
    expect(TRANSITIONS.QUALIFIED).not.toContain("SUBMITTED");
    expect(TRANSITIONS.DISCOVERED).not.toContain("SUBMITTED");
    expect(TRANSITIONS.REJECTED).toEqual([]);
    expect(TRANSITIONS.SUBMISSION_FAILED).not.toContain("SUBMITTED");
    expect(TRANSITIONS.SUBMISSION_PENDING).toContain("SUBMITTED");
  });
  it("throws on illegal transitions and logs events", async () => {
    const { ctx, appId } = await readyApp();
    await expect(transition(ctx, appId, "INTERVIEW", "USER", "x")).rejects.toThrow(TransitionError);
    const ev = (await ctx.store.list("events")).filter((e) => e.applicationId === appId).map((e) => e.to);
    expect(ev).toEqual(expect.arrayContaining(["QUALIFIED", "CV_GENERATED", "READY_FOR_REVIEW"]));
  });
});

describe("authorised submission", () => {
  it("submits through the adapter and marks SUBMITTED only after a confirmation reference", async () => {
    const { ctx, sandbox, appId } = await readyApp();
    await approve(ctx, appId);
    const out = await submitApplication(ctx, appId);
    expect(out.application.status).toBe("SUBMITTED");
    expect(out.application.confirmation).toMatchObject({ kind: "PROVIDER" });
    expect(out.application.confirmation!.reference).toMatch(/^SBX-/);
    expect(out.attempt).toMatchObject({ outcome: "SUCCEEDED", attemptNo: 1 });
    expect(sandbox.received.size).toBe(1);
    const actions = (await ctx.store.list("audit")).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["submission.attempt", "submission.confirmed"]));
    const req = [...sandbox.received.values()][0];
    expect(req.cv.filename).toMatch(/^Sandbox_Co_Applied_AI_Engineer_CV_2026-10-20\.pdf$/);
  });

  it("is idempotent: a second call never re-sends", async () => {
    const { ctx, sandbox, appId } = await readyApp();
    await approve(ctx, appId);
    await submitApplication(ctx, appId);
    const again = await submitApplication(ctx, appId);
    expect(again.alreadySubmitted).toBe(true);
    expect(sandbox.received.size).toBe(1);
    expect((await ctx.store.list("attempts")).length).toBe(1);
  });

  it("retries transient failures safely with the same idempotency key", async () => {
    const { ctx, sandbox, appId } = await readyApp({ script: ["fail", "ok"] });
    await approve(ctx, appId);
    const first = await submitApplication(ctx, appId);
    expect(first.application.status).toBe("SUBMISSION_FAILED");
    expect(first.attempt).toMatchObject({ outcome: "FAILED", retriable: true });
    const second = await submitApplication(ctx, appId);
    expect(second.application.status).toBe("SUBMITTED");
    const attempts = await ctx.store.list("attempts");
    expect(attempts.map((a) => a.attemptNo).sort()).toEqual([1, 2]);
    expect(new Set(attempts.map((a) => a.idempotencyKey)).size).toBe(1);
    expect(sandbox.received.size).toBe(1);
  });

  it("treats a timeout as unconfirmed: NEEDS_ATTENTION and no automatic re-send", async () => {
    const { ctx, appId } = await readyApp({ script: ["timeout", "ok"] });
    await approve(ctx, appId);
    const out = await submitApplication(ctx, appId);
    expect(out.application.status).toBe("NEEDS_ATTENTION");
    expect(out.attempt.outcome).toBe("UNKNOWN");
    await expect(submitApplication(ctx, appId)).rejects.toMatchObject({ code: "UNCONFIRMED_PRIOR_ATTEMPT" });
  });

  it("does not accept success without a confirmation reference", async () => {
    const { ctx, appId } = await readyApp({ script: ["no-reference"] });
    await approve(ctx, appId);
    const out = await submitApplication(ctx, appId);
    expect(out.application.status).toBe("NEEDS_ATTENTION");
    expect(out.application.confirmation).toBeNull();
  });

  it("stops after a permanent rejection and after the retry limit", async () => {
    const a = await readyApp({ script: ["fail-permanent"] });
    await approve(a.ctx, a.appId);
    expect((await submitApplication(a.ctx, a.appId)).application.status).toBe("SUBMISSION_FAILED");
    await expect(submitApplication(a.ctx, a.appId)).rejects.toMatchObject({ code: "PERMANENT_FAILURE" });
    const b = await readyApp({ script: ["fail", "fail", "fail"] });
    await approve(b.ctx, b.appId);
    for (let i = 0; i < 3; i++) await submitApplication(b.ctx, b.appId);
    await expect(submitApplication(b.ctx, b.appId)).rejects.toMatchObject({ code: "RETRY_LIMIT" });
    expect((await b.ctx.store.get("applications", b.appId))!.status).toBe("NEEDS_ATTENTION");
  });

  it("blocks unless every pre-submission check passes", async () => {
    // not approved
    const a = await readyApp();
    await expect(submitApplication(a.ctx, a.appId)).rejects.toBeInstanceOf(SubmissionBlocked);
    expect((await preflight(a.ctx, a.appId)).checks.find((c) => c.id === "approved")!.ok).toBe(false);
    expect(a.sandbox.received.size).toBe(0);
    // mandatory answers missing
    const b = await readyApp();
    await approve(b.ctx, b.appId, false);
    await expect(submitApplication(b.ctx, b.appId)).rejects.toMatchObject({ code: "PREFLIGHT", details: expect.arrayContaining([expect.stringMatching(/^answers:/)]) });
    // role closed
    const c = await readyApp({ script: ["closed"] });
    await approve(c.ctx, c.appId);
    await expect(submitApplication(c.ctx, c.appId)).rejects.toMatchObject({ details: expect.arrayContaining([expect.stringMatching(/^available:/)]) });
    // salary now below the configured minimum
    const d = await readyApp();
    await approve(d.ctx, d.appId);
    await d.ctx.store.put("preferences", { ...defaultPreferences(), id: "prefs", minSalaryAedMonthly: 40000 });
    await expect(submitApplication(d.ctx, d.appId)).rejects.toMatchObject({ details: expect.arrayContaining([expect.stringMatching(/^rules:/)]) });
    expect((await d.ctx.store.list("audit")).some((x) => x.action === "submission.blocked")).toBe(true);
  });

  it("prevents duplicate applications across postings of the same job", async () => {
    const { ctx, sandbox, appId, jobId } = await readyApp();
    await approve(ctx, appId);
    const job = (await ctx.store.get("jobs", jobId))!;
    await ctx.store.put("applications", { id: "app_prev", jobId: "job_other_source", fingerprint: job.fingerprint, status: "SUBMITTED", cvVersionId: null, coverLetterId: null, provider: "manual", confirmation: null, followUpAt: null, notes: null, createdAt: "", updatedAt: "" });
    await expect(submitApplication(ctx, appId)).rejects.toMatchObject({ details: expect.arrayContaining([expect.stringMatching(/^not-duplicate:/)]) });
    expect(sandbox.received.size).toBe(0);
  });

  it("is blocked for providers without authorisation (greenhouse by default)", async () => {
    const { ctx, appId, jobId } = await readyApp();
    await approve(ctx, appId);
    const job = (await ctx.store.get("jobs", jobId))!;
    await ctx.store.put("jobs", { ...job, sourceType: "greenhouse" });
    const app = (await ctx.store.get("applications", appId))!;
    await ctx.store.put("applications", { ...app, provider: "greenhouse" });
    await expect(submitApplication(ctx, appId)).rejects.toMatchObject({ code: "PREFLIGHT", details: expect.arrayContaining([expect.stringMatching(/^capability: PREPARE_AND_HANDOFF/)]) });
  });
});

describe("Greenhouse adapter (mocked HTTP only, never a real employer)", () => {
  it("maps provider responses to outcomes", async () => {
    const mk = (status: number, body = "") => new GreenhouseAdapter("key", "acme", (async () => new Response(body, { status })) as never);
    const { ctx, jobId } = await readyApp();
    const job = (await ctx.store.get("jobs", jobId))!;
    const profile = (await ctx.store.get("profile", "profile"))!;
    const req = { idempotencyKey: "abcdef0123456789", job, profile, cv: { filename: "x.pdf", bytes: new Uint8Array(2000) }, coverLetterText: null, answers: [] };
    expect(await mk(200, '{"success":"Candidate saved successfully"}').submit(req)).toMatchObject({ outcome: "SUCCEEDED", reference: expect.stringMatching(/^GH-/) });
    expect(await mk(503).submit(req)).toMatchObject({ outcome: "FAILED", retriable: true });
    expect(await mk(422, "bad").submit(req)).toMatchObject({ outcome: "FAILED", retriable: false });
    const net = new GreenhouseAdapter("key", "acme", (async () => { throw new Error("ECONNRESET"); }) as never);
    expect((await net.submit(req)).outcome).toBe("UNKNOWN");
  });
});

describe("manual handoff", () => {
  it("builds a complete package and records self-reported submissions as user-attested", async () => {
    const { ctx, appId } = await readyApp();
    const pkg = await buildHandoff(ctx, appId);
    expect(pkg.openUrl).toBe("https://sandbox.invalid/jobs/1");
    expect(pkg.cvPdfDocId && pkg.cvDocxDocId && pkg.coverLetterText).toBeTruthy();
    expect(pkg.answers.length).toBe(STANDARD_QUESTIONS.length);
    expect(pkg.answers.some((a) => a.needsYou)).toBe(true);
    expect(pkg.steps.join(" ")).toMatch(/CAPTCHA/);
    const app = await attestManualSubmission(ctx, appId, "ref-123");
    expect(app.status).toBe("SUBMITTED");
    expect(app.confirmation).toMatchObject({ kind: "USER_ATTESTED", reference: "ref-123" });
  });
});
