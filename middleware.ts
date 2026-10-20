import { NextResponse, type NextRequest } from "next/server";
import { authConfig, authDisabled, SESSION_COOKIE, verifySessionToken } from "@/lib/agent/auth";

const PUBLIC = new Set(["/agent/login", "/api/agent/login", "/api/agent/cron"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();
  if (authDisabled(process.env)) return NextResponse.next();
  const cfg = authConfig(process.env);
  const isApi = pathname.startsWith("/api/");
  if (!cfg.ok) {
    return isApi ? NextResponse.json({ error: "Auth not configured", detail: cfg.reason }, { status: 503 }) : NextResponse.redirect(new URL("/agent/login", req.url));
  }
  if (await verifySessionToken(cfg.secret, req.cookies.get(SESSION_COOKIE)?.value, Date.now())) return NextResponse.next();
  return isApi ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : NextResponse.redirect(new URL("/agent/login", req.url));
}

export const config = { matcher: ["/agent/:path*", "/api/agent/:path*"] };
