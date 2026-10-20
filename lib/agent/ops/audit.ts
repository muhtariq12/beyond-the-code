import { newId, type Store } from "../store/store";
import { redactSecrets } from "../llm/safety";

function scrub(v: unknown): unknown {
  if (typeof v === "string") return redactSecrets(v).slice(0, 500);
  if (Array.isArray(v)) return v.slice(0, 20).map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, /key|secret|token|password|authorization|cookie/i.test(k) ? "[REDACTED]" : scrub(x)]),
    );
  }
  return v;
}

export async function audit(
  store: Store,
  now: Date,
  action: string,
  actor: string,
  entity: string | null,
  detail: Record<string, unknown> = {},
) {
  await store.put("audit", {
    id: newId("aud"),
    action,
    actor,
    entity,
    detail: scrub(detail) as Record<string, unknown>,
    at: now.toISOString(),
  });
}
