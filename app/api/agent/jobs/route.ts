import { z } from "zod";
import { jsonRoute } from "@/lib/agent/api";
import { ingestAlertEmail, ingestPastedJob, screenAll } from "@/lib/agent/ops/pipeline";

const Paste = z.object({
  kind: z.literal("paste"),
  employer: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  url: z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL"),
  description: z.string().min(80, "Paste the full job description").max(40_000),
  location: z.string().max(160).optional(),
  salaryText: z.string().max(200).optional(),
});
const Email = z.object({ kind: z.literal("email"), body: z.string().min(10).max(200_000) });

export const POST = jsonRoute({ name: "jobs-add", schema: z.discriminatedUnion("kind", [Paste, Email]), perMinute: 20 }, async (ctx, b) => {
  if (b.kind === "paste") {
    const job = await ingestPastedJob(ctx, b);
    await screenAll(ctx);
    return { jobId: job.id };
  }
  const r = await ingestAlertEmail(ctx, b.body);
  await screenAll(ctx);
  return r;
});
