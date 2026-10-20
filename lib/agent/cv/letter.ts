import type { Ctx } from "../ctx";
import { saveDocument } from "./service";
import { cvFilename } from "./filename";
import { renderLetterDocx } from "./render-docx";
import { renderLetterPdf } from "./render-pdf";
import { checkClaim } from "./validate";
import { newId } from "../store/store";
import { verifiedEntries } from "../profile/facts";
import type { CoverLetter, Fact } from "../types";

/**
 * Deterministic cover letter assembled only from verified facts. It makes no salary, sponsorship,
 * relocation or availability statements; those need the owner.
 */
export async function generateCoverLetter(ctx: Ctx, jobId: string): Promise<CoverLetter> {
  const job = await ctx.store.get("jobs", jobId);
  const profile = await ctx.store.get("profile", "profile");
  const match = await ctx.store.get("matches", `m_${jobId}`);
  if (!job || !profile || !match) throw new Error("Job, profile and match are required");

  const current = verifiedEntries(profile).find((e) => e.type === "EMPLOYMENT" && e.current) ?? verifiedEntries(profile).find((e) => e.type === "EMPLOYMENT");
  const strong = match.matched.filter((m) => m.strength === "DEMONSTRATED").slice(0, 3);
  const usedFacts: Fact[] = [];
  const paragraphs: string[] = [`Dear Hiring Team at ${job.employer},`];
  paragraphs.push(`I am writing to apply for the ${job.title} role${current ? `. I currently work as ${current.title}${current.org ? ` (${current.org})` : ""}` : ""}.`);

  const seen = new Set<string>();
  const examples: string[] = [];
  for (const m of strong) {
    const fid = m.factIds[0];
    const f = profile.facts.find((x) => x.id === fid);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    usedFacts.push(f);
    const e = profile.entries.find((x) => x.id === f.entryId);
    examples.push(`${m.requirement}${e ? ` (${e.title})` : ""}: ${f.text}`);
  }
  if (examples.length) {
    paragraphs.push(`Your posting asks for ${strong.map((m) => m.requirement).join(", ")}. Examples from my verified experience:`);
    examples.forEach((x) => paragraphs.push(`- ${x}`));
  } else {
    paragraphs.push("I would be glad to walk you through the projects and work most relevant to this role.");
  }
  paragraphs.push("I would welcome the chance to discuss how my background fits the role.");
  paragraphs.push(`Kind regards,\n${profile.fullName}`);

  const problems = usedFacts.flatMap((f) => {
    const line = examples.find((x) => x.endsWith(f.text)) ?? "";
    return line ? [checkClaim(f.text, [f], profile)].filter(Boolean) : [];
  });
  const text = paragraphs.join("\n\n");
  const id = newId("cl");
  const now = ctx.now();
  const opts = { name: profile.fullName, contact: [profile.email, profile.phone].filter((x): x is string => !!x), employer: job.employer, title: job.title, paragraphs: paragraphs.slice(0, -1), dateLabel: now.toISOString().slice(0, 10) };
  const pdf = await saveDocument(ctx, { kind: "COVER_LETTER_PDF", filename: cvFilename(job.employer, job.title, now, "pdf", "CoverLetter"), mime: "application/pdf", jobId, cvVersionId: null }, await renderLetterPdf(opts));
  const docx = await saveDocument(ctx, { kind: "COVER_LETTER_DOCX", filename: cvFilename(job.employer, job.title, now, "docx", "CoverLetter"), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", jobId, cvVersionId: null }, await renderLetterDocx(opts));
  const letter: CoverLetter = {
    id,
    jobId,
    text,
    factIds: usedFacts.map((f) => f.id),
    validation: { pass: problems.length === 0, claims: usedFacts.map((f) => ({ location: "Cover letter", text: f.text, status: "VERIFIED" as const, factIds: [f.id], problem: null })), violations: problems as string[] },
    pdfDocId: pdf.id,
    docxDocId: docx.id,
    createdAt: now.toISOString(),
  };
  await ctx.store.put("coverLetters", letter);
  return letter;
}
