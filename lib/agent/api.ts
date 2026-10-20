import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApprovalError } from "./cv/service";
import { UserError } from "./errors";
import { UploadError } from "./profile/extract";
import { TransitionError } from "./apply/status";
import { SubmissionBlocked } from "./apply/submit";
import { ImmutableViolation } from "./store/store";
import { redactSecrets } from "./llm/safety";
import { limiter } from "./ratelimit";
import { sameOrigin } from "./auth";
import { getCtx } from "./runtime";
import type { Ctx } from "./ctx";

interface Opts<S> {
  schema?: ZodType<S>;
  /** handler reads the request itself (multipart uploads) */
  raw?: boolean;
  /** requests per minute per client; default 60 */
  perMinute?: number;
  name: string;
}

function clientKey(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  if (e instanceof SubmissionBlocked) return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: 409 });
  if (e instanceof ApprovalError || e instanceof TransitionError || e instanceof ImmutableViolation) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof UploadError || e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error("[agent api]", redactSecrets((e as Error)?.stack ?? String(e)).slice(0, 800));
  return NextResponse.json({ error: "Something went wrong. Check the server log." }, { status: 500 });
}

/** Wraps a JSON route: same-origin check, rate limit, input validation, uniform errors. */
export function jsonRoute<S = unknown>(opts: Opts<S>, fn: (ctx: Ctx, input: S, req: NextRequest) => Promise<unknown>) {
  return async (req: NextRequest) => {
    try {
      if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
      const rl = limiter.check(`${opts.name}:${clientKey(req)}`, opts.perMinute ?? 60, 60_000);
      if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
      let input = undefined as S;
      if (opts.schema) {
        const body = await req.json().catch(() => ({}));
        input = opts.schema.parse(body);
      }
      const out = await fn(await getCtx(), input, req);
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
