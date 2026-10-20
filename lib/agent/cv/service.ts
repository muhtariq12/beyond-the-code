import { z } from "zod";
import type { Ctx } from "../ctx";
import { UserError } from "../errors";
import { audit } from "../ops/audit";
import { UNTRUSTED_NOTICE, wrapUntrusted } from "../llm/safety";
import { newId, sha256 } from "../store/store";
import type { AtsCheck, CvDoc, CvVersion, Fact, Job, Match, Profile, StoredDocument, Validation } from "../types";
import { atsChecks } from "./ats";
import { buildBaselineCv, buildTailoredCv, type BuildOptions } from "./build";
import { summarizeChanges } from "./diff";
import { cvFilename } from "./filename";
import { renderCvDocx } from "./render-docx";
import { pdfPageCount, renderCvPdf } from "./render-pdf";
import { checkClaim, validateCv } from "./validate";

const RefineSchema = z.object({
  summary: z.object({ text: z.string().max(900), factIds: z.array(z.string()).max(30) }),
  bullets: z.array(z.object({ factId: z.string(), text: z.string().max(400) })).max(60),
});

/** Ask the LLM to rewrite selected bullets. Every suggestion is accepted only if it passes deterministic validation. */
async function llmRefine(ctx: Ctx, doc: CvDoc, profile: Profile, job: Job, notes: string[]): Promise<CvDoc> {
  const selected = new Set([...doc.summary.factIds, ...[...doc.experience, ...doc.projects].flatMap((s) => s.bullets.flatMap((b) => b.factIds))]);
  const facts = profile.facts.filter((f) => f.verified && selected.has(f.id));
  const system =
    "You tailor a candidate's CV to a job. You may only reword the supplied VERIFIED FACTS. " +
    "Rules: never add numbers, tools, employers, titles, outcomes or responsibilities that are not in the fact; never raise seniority; " +
    "use the job's terminology only when the fact genuinely demonstrates it; one fact per bullet; keep each bullet under 220 characters. " +
    'Return JSON only: {"summary":{"text":string,"factIds":string[]},"bullets":[{"factId":string,"text":string}]}. ' +
    UNTRUSTED_NOTICE;
  const user = [
    "VERIFIED FACTS (id: text):",
    ...facts.map((f) => `${f.id}: ${f.text}`),
    "",
    "CURRENT SUMMARY:",
    doc.summary.text,
    "",
    wrapUntrusted("job-posting", `Title: ${job.title}\nEmployer: ${job.employer}\nRequired: ${job.requiredSkills.join(", ")}\nPreferred: ${job.preferredSkills.join(", ")}\n\n${job.description}`, 6000),
  ].join("\n");

  let res: z.infer<typeof RefineSchema>;
  try {
    res = await ctx.llm.completeJson({ system, user, schema: RefineSchema, maxTokens: 3000 });
  } catch (e) {
    notes.push(`LLM refinement skipped: ${(e as Error).message.slice(0, 120)}`);
    return doc;
  }
  const byId = new Map(facts.map((f) => [f.id, f]));
  let accepted = 0;
  let rejected = 0;
  const rewrite = new Map(res.bullets.map((b) => [b.factId, b.text.trim()]));
  const fix = (sections: CvDoc["experience"]) =>
    sections.map((s) => ({
      ...s,
      bullets: s.bullets.map((b) => {
        const cand = b.factIds.length === 1 ? rewrite.get(b.factIds[0]) : undefined;
        if (!cand || cand === b.text) return b;
        const f = byId.get(b.factIds[0]) as Fact;
        const problem = checkClaim(cand, [f], profile);
        if (problem) {
          rejected++;
          return b;
        }
        accepted++;
        return { ...b, text: cand };
      }),
    }));
  let summary = doc.summary;
  const sFacts = res.summary.factIds.map((id) => profile.facts.find((f) => f.id === id)).filter((f): f is Fact => !!f);
  if (res.summary.text.trim() && sFacts.length === res.summary.factIds.length && !checkClaim(res.summary.text, sFacts, profile)) {
    summary = { text: res.summary.text.trim(), factIds: res.summary.factIds };
    accepted++;
  } else if (res.summary.text.trim()) rejected++;
  notes.push(`LLM refinement: ${accepted} rewrite(s) accepted, ${rejected} rejected by evidence validation and kept verbatim.`);
  return { ...doc, summary, experience: fix(doc.experience), projects: fix(doc.projects) };
}

export function unresolvedQuestions(doc: CvDoc, job: Job, match: Match, profile: Profile): string[] {
  const q: string[] = [];
  for (const g of match.gaps.filter((g) => job.requiredSkills.includes(g.requirement)).slice(0, 5)) {
    q.push(
      g.kind === "MISSING"
        ? `The role asks for ${g.requirement}. Your verified profile has no evidence of it. If you have real experience, add it as a verified fact (with where and what you did); otherwise it stays off the CV.`
        : `${g.requirement} is only listed in your skills. If you have used it in work or a project, add that as a verified fact so the CV can show it.`,
    );
  }
  const bare = doc.experience.flatMap((s) => s.bullets.map((b) => ({ s, b }))).filter(({ b }) => !/\d/.test(b.text)).slice(0, 2);
  for (const { s, b } of bare) q.push(`"${b.text.slice(0, 70)}…" (${s.title}) has no measurable outcome. Provide a verified metric only if you can evidence it.`);
  void profile;
  return q.slice(0, 8);
}

export interface SavedDocs {
  pdf: StoredDocument;
  docx: StoredDocument;
  pdfBytes: Uint8Array;
  docxBytes: Uint8Array;
}

export async function saveDocument(ctx: Ctx, d: Omit<StoredDocument, "id" | "sha256" | "bytes" | "createdAt">, bytes: Uint8Array): Promise<StoredDocument> {
  const rec: StoredDocument = { ...d, id: newId("doc"), sha256: sha256(bytes), bytes: bytes.byteLength, createdAt: ctx.now().toISOString() };
  await ctx.blobs.put(rec.id, bytes);
  await ctx.store.put("documents", rec);
  return rec;
}

export interface GenerateOptions extends BuildOptions {
  origin?: CvVersion["origin"];
  parentId?: string | null;
  /** pre-built (edited) document; skips tailoring */
  doc?: CvDoc;
  notes?: string | null;
}

/** Build, validate, render and store a new immutable CV version for one job. */
export async function generateCvVersion(ctx: Ctx, jobId: string, opts: GenerateOptions = {}): Promise<CvVersion> {
  const job = await ctx.store.get("jobs", jobId);
  const profile = await ctx.store.get("profile", "profile");
  const match = await ctx.store.get("matches", `m_${jobId}`);
  if (!job) throw new UserError("Job not found");
  if (!profile) throw new UserError("Import your CV first");
  if (!match) throw new UserError("Score the job before generating a CV");
  if (match.eligibility === "INELIGIBLE") throw new UserError("Job failed eligibility; no CV is generated for ineligible jobs");

  const baseline = buildBaselineCv(profile);
  const generatorNotes: string[] = [];
  let doc = opts.doc ?? buildTailoredCv(profile, job, match, opts);
  let generator = "deterministic-selection";
  if (!opts.doc && ctx.llm.available) {
    doc = await llmRefine(ctx, doc, profile, job, generatorNotes);
    generator = `${ctx.llm.name}+validated`;
  }
  const validation: Validation = validateCv(doc, profile);

  const now = ctx.now();
  const pdfBytes = await renderCvPdf(doc);
  const docxBytes = await renderCvDocx(doc);
  const { extractText, getDocumentProxy } = await import("unpdf");
  const proxy = await getDocumentProxy(new Uint8Array(pdfBytes));
  const { text: pdfText } = await extractText(proxy, { mergePages: true });
  const ats: AtsCheck[] = atsChecks({ doc, job, pdfText, pdfPages: await pdfPageCount(pdfBytes), docxBytes: docxBytes.byteLength });

  const existing = (await ctx.store.list("cvVersions")).filter((v) => v.jobId === jobId);
  const version = existing.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const id = newId("cv");
  const pdf = await saveDocument(ctx, { kind: "CV_PDF", filename: cvFilename(job.employer, job.title, now, "pdf"), mime: "application/pdf", jobId, cvVersionId: id }, pdfBytes);
  const docx = await saveDocument(ctx, { kind: "CV_DOCX", filename: cvFilename(job.employer, job.title, now, "docx"), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", jobId, cvVersionId: id }, docxBytes);

  const rec: CvVersion = {
    id,
    jobId,
    version,
    parentId: opts.parentId ?? null,
    origin: opts.origin ?? "GENERATED",
    generator,
    status: "DRAFT",
    doc,
    contentHash: sha256(JSON.stringify(doc)),
    validation,
    ats,
    changeSummary: [...summarizeChanges(baseline, doc, job, profile), ...generatorNotes],
    questions: unresolvedQuestions(doc, job, match, profile),
    emphasis: [...new Set([...(opts.emphasis ?? []), ...match.cvEmphasis])],
    matchScore: match.score,
    pdfDocId: pdf.id,
    docxDocId: docx.id,
    createdAt: now.toISOString(),
    reviewedAt: null,
    notes: opts.notes ?? null,
  };
  await ctx.store.put("cvVersions", rec);

  // Earlier DRAFTs are superseded. An APPROVED version stays approved until the owner approves its replacement.
  for (const v of existing) if (v.status === "DRAFT") await ctx.store.put("cvVersions", { ...v, status: "SUPERSEDED" });
  await audit(ctx.store, now, "cv.generated", "SYSTEM", id, { jobId, version, generator, validationPass: validation.pass });
  return rec;
}

export class ApprovalError extends Error {}

export async function reviewCvVersion(ctx: Ctx, id: string, decision: "APPROVED" | "REJECTED", notes?: string): Promise<CvVersion> {
  const v = await ctx.store.get("cvVersions", id);
  if (!v) throw new ApprovalError("CV version not found");
  if (decision === "APPROVED") {
    if (!v.validation.pass) throw new ApprovalError("This version has unsupported claims and cannot be approved. Fix or regenerate it.");
    if (v.status === "SUPERSEDED") throw new ApprovalError("This version was superseded by a newer one.");
    if (!v.pdfDocId || !v.docxDocId) throw new ApprovalError("Documents are missing for this version.");
    for (const other of (await ctx.store.list("cvVersions")).filter((o) => o.jobId === v.jobId && o.id !== v.id && o.status === "APPROVED")) {
      await ctx.store.put("cvVersions", { ...other, status: "SUPERSEDED" });
    }
  }
  const next: CvVersion = { ...v, status: decision, reviewedAt: ctx.now().toISOString(), notes: notes ?? v.notes };
  await ctx.store.put("cvVersions", next);
  await audit(ctx.store, ctx.now(), `cv.${decision.toLowerCase()}`, "USER", id, { jobId: v.jobId });
  return next;
}
