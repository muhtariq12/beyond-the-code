import { z } from "zod";
import { jsonRoute } from "@/lib/agent/api";
import { CONNECTORS } from "@/lib/agent/connectors/registry";
import { syncSource } from "@/lib/agent/ops/pipeline";
import { audit } from "@/lib/agent/ops/audit";
import { newId } from "@/lib/agent/store/store";
import { UserError } from "@/lib/agent/errors";

const Add = z.object({
  type: z.enum(["greenhouse", "lever", "ashby"]),
  name: z.string().min(1).max(80),
  token: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, "Letters, numbers, dot, dash and underscore only"),
});

export const POST = jsonRoute({ name: "sources-add", schema: Add }, async (ctx, b) => {
  const id = newId("src");
  await ctx.store.put("sources", { id, type: b.type, name: b.name.trim(), token: b.token, enabled: true, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastJobCount: null, retryAfter: null, createdAt: ctx.now().toISOString() });
  await audit(ctx.store, ctx.now(), "source.added", "USER", id, { type: b.type, via: CONNECTORS[b.type].info.retrievalMethod });
  return { id };
});

const Patch = z.object({ id: z.string(), enabled: z.boolean().optional(), sync: z.boolean().optional(), remove: z.boolean().optional() });

export const PATCH = jsonRoute({ name: "sources-edit", schema: Patch, perMinute: 20 }, async (ctx, b) => {
  const s = await ctx.store.get("sources", b.id);
  if (!s) throw new UserError("Source not found");
  if (b.remove) {
    await ctx.store.delete("sources", b.id);
    return { ok: true };
  }
  if (b.enabled !== undefined) await ctx.store.put("sources", { ...s, enabled: b.enabled });
  if (b.sync) return syncSource(ctx, b.id, { force: true });
  return { ok: true };
});
