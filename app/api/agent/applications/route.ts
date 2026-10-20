import { z } from "zod";
import { jsonRoute } from "@/lib/agent/api";
import { answerQuestions, saveUserAnswer } from "@/lib/agent/apply/answers";
import { transition } from "@/lib/agent/apply/status";
import { attestManualSubmission, buildHandoff, preflight, submitApplication } from "@/lib/agent/apply/submit";
import { ApplicationStatus } from "@/lib/agent/types";
import { audit } from "@/lib/agent/ops/audit";
import { UserError } from "@/lib/agent/errors";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), id: z.string(), to: ApplicationStatus, note: z.string().max(300).optional() }),
  z.object({ action: z.literal("approve"), id: z.string(), cvVersionId: z.string() }),
  z.object({ action: z.literal("answer"), answerId: z.string(), text: z.string().max(2000) }),
  z.object({ action: z.literal("add-questions"), id: z.string(), questions: z.array(z.object({ text: z.string().min(3).max(500), required: z.boolean().optional() })).min(1).max(40) }),
  z.object({ action: z.literal("preflight"), id: z.string() }),
  z.object({ action: z.literal("submit"), id: z.string() }),
  z.object({ action: z.literal("handoff"), id: z.string() }),
  z.object({ action: z.literal("attest"), id: z.string(), reference: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("followup"), id: z.string(), at: z.string().datetime().nullable() }),
]);

export const POST = jsonRoute({ name: "applications", schema: Body, perMinute: 40 }, async (ctx, b) => {
  switch (b.action) {
    case "status": {
      // These states are only reachable through their own verified paths.
      if (["SUBMITTED", "SUBMISSION_PENDING", "SUBMISSION_FAILED"].includes(b.to)) throw new UserError("That status is set by submission or the manual 'mark as submitted' action only.");
      return transition(ctx, b.id, b.to, "USER", b.note ?? "Updated by you");
    }
    case "approve": {
      const cv = await ctx.store.get("cvVersions", b.cvVersionId);
      if (!cv || cv.status !== "APPROVED") throw new UserError("Approve the CV version in CV Studio first.");
      const app = await ctx.store.get("applications", b.id);
      if (!app || app.jobId !== cv.jobId) throw new UserError("That CV belongs to a different job.");
      await ctx.store.put("applications", { ...app, cvVersionId: cv.id });
      await audit(ctx.store, ctx.now(), "application.approved", "USER", b.id, { cvVersionId: cv.id });
      return transition(ctx, b.id, "APPROVED", "USER", `Approved with CV v${cv.version}`);
    }
    case "answer":
      return saveUserAnswer(ctx, b.answerId, b.text);
    case "add-questions":
      return answerQuestions(ctx, b.id, b.questions);
    case "preflight":
      return preflight(ctx, b.id);
    case "submit":
      return submitApplication(ctx, b.id);
    case "handoff":
      return buildHandoff(ctx, b.id);
    case "attest":
      return attestManualSubmission(ctx, b.id, b.reference ?? null);
    case "followup": {
      const app = await ctx.store.get("applications", b.id);
      if (!app) throw new UserError("Application not found");
      await ctx.store.put("applications", { ...app, followUpAt: b.at });
      return { ok: true };
    }
  }
});
