import { z } from "zod";
import { jsonRoute } from "@/lib/agent/api";

export const POST = jsonRoute({ name: "notifications", schema: z.object({ id: z.string().optional(), all: z.boolean().optional() }) }, async (ctx, b) => {
  for (const n of await ctx.store.list("notifications")) if (!n.read && (b.all || n.id === b.id)) await ctx.store.put("notifications", { ...n, read: true });
  return { ok: true };
});
