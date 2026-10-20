import { z } from "zod";
import { jsonRoute } from "@/lib/agent/api";
import { generateForQualified, ingestAll, runDue, screenAll } from "@/lib/agent/ops/pipeline";

export const POST = jsonRoute({ name: "pipeline", schema: z.object({ step: z.enum(["all", "ingest", "screen", "generate"]) }), perMinute: 6 }, async (ctx, { step }) => {
  if (step === "ingest") return { ingest: await ingestAll(ctx) };
  if (step === "screen") return { screen: await screenAll(ctx) };
  if (step === "generate") return { generate: await generateForQualified(ctx) };
  return runDue(ctx, { force: true });
});
