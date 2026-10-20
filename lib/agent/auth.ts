/**
 * Single-owner session auth that runs on both the Edge (middleware) and Node runtimes.
 * Cookie value: "<expiryMs>.<hmacSHA256(expiryMs)>". Nothing about the owner is stored in the cookie.
 */
export const SESSION_COOKIE = "agent_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function createSessionToken(secret: string, nowMs: number): Promise<string> {
  const exp = String(nowMs + SESSION_TTL_MS);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function verifySessionToken(secret: string, token: string | undefined, nowMs: number): Promise<boolean> {
  if (!token || secret.length < 32) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  return safeEqual(sig, await hmac(secret, exp));
}

export type AuthConfig = { ok: true; password: string; secret: string } | { ok: false; reason: string };

export function authConfig(env: Record<string, string | undefined>): AuthConfig {
  const password = env.AGENT_ACCESS_PASSWORD ?? "";
  const secret = env.AGENT_SESSION_SECRET ?? "";
  if (password.length < 12) return { ok: false, reason: "Set AGENT_ACCESS_PASSWORD (at least 12 characters)." };
  if (secret.length < 32) return { ok: false, reason: "Set AGENT_SESSION_SECRET (at least 32 random characters)." };
  return { ok: true, password, secret };
}

export function authDisabled(env: Record<string, string | undefined>): boolean {
  return env.AGENT_AUTH_DISABLED === "1" && env.NODE_ENV !== "production";
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite=Strict). */
export function sameOrigin(headers: { get(name: string): string | null }): boolean {
  const origin = headers.get("origin");
  if (!origin) return true; // non-browser clients; still need the session cookie
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
