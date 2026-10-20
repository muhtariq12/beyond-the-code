import { Preferences } from "@/lib/agent/types";
import { jsonRoute } from "@/lib/agent/api";
import { audit } from "@/lib/agent/ops/audit";

export const PUT = jsonRoute({ name: "prefs", schema: Preferences }, async (ctx, prefs) => {
  await ctx.store.put("preferences", { ...prefs, id: "prefs" });
  await audit(ctx.store, ctx.now(), "preferences.updated", "USER", null, { minSalary: prefs.minSalaryAedMonthly });
  return { ok: true };
});
