import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authConfig, createSessionToken, safeEqual, SESSION_COOKIE, SESSION_TTL_MS, sameOrigin } from "@/lib/agent/auth";
import { limiter } from "@/lib/agent/ratelimit";

const Body = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  const rl = limiter.check(`login:${ip}`, 5, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const cfg = authConfig(process.env);
  if (!cfg.ok) return NextResponse.json({ error: "Auth not configured", detail: cfg.reason }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || !safeEqual(parsed.data.password, cfg.password)) return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(cfg.secret, Date.now()), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
