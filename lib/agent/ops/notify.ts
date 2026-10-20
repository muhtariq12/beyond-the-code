import type { Ctx } from "../ctx";
import { newId } from "../store/store";
import { redactSecrets } from "../llm/safety";
import type { Notification } from "../types";

export interface NotifyInput {
  type: "HIGH_MATCH" | "CV_READY" | "APPROVAL_REQUIRED" | "SUBMISSION_FAILED" | "NEEDS_ATTENTION" | "FOLLOW_UP_DUE" | "SOURCE_ERROR" | "DAILY_SUMMARY" | "INTERVIEW";
  title: string;
  body: string;
  entityId: string | null;
  /** extra discriminator so a genuinely new event on the same entity can notify again */
  discriminator?: string;
}

/** Stores an in-app notification and optionally posts it to NOTIFY_WEBHOOK_URL. The same event never notifies twice. */
export async function notify(ctx: Ctx, n: NotifyInput): Promise<Notification | null> {
  const dedupeKey = `${n.type}:${n.entityId ?? "-"}:${n.discriminator ?? ""}`;
  const existing = (await ctx.store.list("notifications")).find((x) => x.dedupeKey === dedupeKey);
  if (existing) return null;
  let delivered = false;
  const url = ctx.env.NOTIFY_WEBHOOK_URL;
  if (url && /^https:\/\//.test(url)) {
    try {
      const res = await ctx.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: redactSecrets(`${n.title}\n${n.body}`).slice(0, 1500) }) });
      delivered = res.ok;
    } catch {
      delivered = false;
    }
  }
  const rec: Notification = { id: newId("ntf"), dedupeKey, type: n.type, title: n.title.slice(0, 200), body: n.body.slice(0, 1000), entityId: n.entityId, read: false, deliveredWebhook: delivered, createdAt: ctx.now().toISOString() };
  await ctx.store.put("notifications", rec);
  return rec;
}
