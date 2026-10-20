import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/agent/auth";
import { runDue } from "@/lib/agent/ops/pipeline";
import { errorResponse } from "@/lib/agent/api";
import { getCtx } from "@/lib/agent/runtime";

/** Scheduler entry point for Vercel Cron or any external scheduler. Authenticated by CRON_SECRET, not the browser session. */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret.length < 24 || !safeEqual(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runDue(await getCtx()));
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = handle;
export const POST = handle;
