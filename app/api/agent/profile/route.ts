import { z } from "zod";
import { jsonRoute } from "@/lib/agent/api";
import { audit } from "@/lib/agent/ops/audit";
import { extractCvText, sniffCvKind, UploadError } from "@/lib/agent/profile/extract";
import { mergeReimport, parseCvText } from "@/lib/agent/profile/import";
import { canonicalSkill, extractSkills } from "@/lib/agent/skills";
import { saveDocument } from "@/lib/agent/cv/service";
import { newId } from "@/lib/agent/store/store";
import type { Fact } from "@/lib/agent/types";
import crypto from "node:crypto";

/** Upload (or re-upload) your CV. The original file is stored write-once and never modified. */
export const POST = jsonRoute({ name: "profile-upload", raw: true, perMinute: 10 }, async (ctx, _in, req) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new UploadError("Choose a CV file to upload.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffCvKind(bytes, file.name);
  const { text } = await extractCvText(bytes, file.name);
  if (text.length < 200) throw new UploadError("Could not read enough text from that file (scanned images are not supported).");
  const doc = await saveDocument(ctx, { kind: "ORIGINAL_CV", filename: `Original_CV_${ctx.now().toISOString().slice(0, 10)}.${kind === "pdf" ? "pdf" : kind === "docx" ? "docx" : "txt"}`, mime: kind === "pdf" ? "application/pdf" : kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain", jobId: null, cvVersionId: null }, bytes);
  const { profile, warnings } = parseCvText(text, doc.id, ctx.now().toISOString());
  const prev = await ctx.store.get("profile", "profile");
  const merged = mergeReimport(prev, profile);
  await ctx.store.put("profile", { ...merged, id: "profile" });
  await audit(ctx.store, ctx.now(), "profile.imported", "USER", doc.id, { entries: merged.entries.length, facts: merged.facts.length });
  return { entries: merged.entries.length, facts: merged.facts.length, skills: merged.skills.length, warnings };
});

const Patch = z.object({
  verifyAll: z.boolean().optional(),
  verifyFactIds: z.array(z.string()).max(500).optional(),
  verifyEntryIds: z.array(z.string()).max(200).optional(),
  verifySkills: z.array(z.string()).max(300).optional(),
  unverifyFactIds: z.array(z.string()).max(500).optional(),
  removeFactId: z.string().optional(),
  addFact: z.object({ entryId: z.string().nullable(), text: z.string().min(3).max(600), note: z.string().max(300).optional() }).optional(),
});

export const PATCH = jsonRoute({ name: "profile-edit", schema: Patch }, async (ctx, p) => {
  const prof = await ctx.store.get("profile", "profile");
  if (!prof) throw new UploadError("Import your CV first.");
  const now = ctx.now().toISOString();
  const vf = new Set(p.verifyFactIds ?? []);
  const ve = new Set(p.verifyEntryIds ?? []);
  const vs = new Set(p.verifySkills ?? []);
  const uv = new Set(p.unverifyFactIds ?? []);
  let facts: Fact[] = prof.facts.map((f) => (p.verifyAll || vf.has(f.id) ? { ...f, verified: true, verifiedAt: f.verifiedAt ?? now } : uv.has(f.id) ? { ...f, verified: false, verifiedAt: null } : f));
  if (p.removeFactId) facts = facts.filter((f) => f.id !== p.removeFactId);
  if (p.addFact) {
    const t = p.addFact.text.trim();
    facts.push({
      id: "f_" + crypto.createHash("sha1").update(`${p.addFact.entryId ?? "-"}|${t}`).digest("hex").slice(0, 10),
      entryId: p.addFact.entryId,
      text: t,
      skills: extractSkills(t),
      metrics: [...t.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "")),
      source: { doc: "owner-entered", ref: p.addFact.note ?? "Entered by you in Settings", quote: t.slice(0, 200) },
      verified: true, // you typed it and are asserting it
      verifiedAt: now,
    });
  }
  const next = {
    ...prof,
    facts,
    entries: prof.entries.map((e) => (p.verifyAll || ve.has(e.id) ? { ...e, verified: true } : e)),
    skills: prof.skills.map((s) => (p.verifyAll || vs.has(s.label) ? { ...s, verified: true } : s)),
    updatedAt: now,
  };
  if (p.addFact) for (const f of facts.slice(-1)) for (const sk of f.skills) if (!next.skills.some((s) => s.name === sk)) void canonicalSkill(sk);
  await ctx.store.put("profile", next);
  await audit(ctx.store, ctx.now(), "profile.edited", "USER", null, { verifyAll: !!p.verifyAll, added: !!p.addFact, removed: !!p.removeFactId });
  return { ok: true };
});

void newId;
