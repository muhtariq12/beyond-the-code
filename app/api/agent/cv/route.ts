import { z } from "zod";
import { jsonRoute } from "@/lib/agent/api";
import { generateCvVersion, reviewCvVersion } from "@/lib/agent/cv/service";
import { prepareJob } from "@/lib/agent/ops/pipeline";
import { CvDoc } from "@/lib/agent/types";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), jobId: z.string() }),
  z.object({ action: z.literal("regenerate"), jobId: z.string(), parentId: z.string().nullable().optional(), emphasis: z.array(z.string().max(60)).max(10).default([]) }),
  z.object({ action: z.literal("edit"), jobId: z.string(), parentId: z.string(), doc: CvDoc, notes: z.string().max(300).optional() }),
  z.object({ action: z.literal("review"), id: z.string(), decision: z.enum(["APPROVED", "REJECTED"]), notes: z.string().max(300).optional() }),
]);

export const POST = jsonRoute({ name: "cv", schema: Body, perMinute: 20 }, async (ctx, b) => {
  if (b.action === "prepare") {
    const r = await prepareJob(ctx, b.jobId);
    return { cvId: r.cv.id, applicationId: r.applicationId };
  }
  if (b.action === "regenerate") {
    const v = await generateCvVersion(ctx, b.jobId, { origin: "REGENERATED", parentId: b.parentId ?? null, emphasis: b.emphasis });
    return { cvId: v.id };
  }
  if (b.action === "edit") {
    const v = await generateCvVersion(ctx, b.jobId, { origin: "MANUAL_EDIT", parentId: b.parentId, doc: b.doc, notes: b.notes ?? null });
    return { cvId: v.id, validationPass: v.validation.pass, violations: v.validation.violations };
  }
  const v = await reviewCvVersion(ctx, b.id, b.decision, b.notes);
  return { status: v.status };
});
