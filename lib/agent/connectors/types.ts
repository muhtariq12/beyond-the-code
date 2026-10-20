import type { Source, SourceType } from "../types";
import type { RawJob } from "../jobs/normalize";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorContext {
  fetch: FetchLike;
  now: () => Date;
}

export interface ConnectorInfo {
  type: SourceType;
  label: string;
  retrievalMethod: string;
  capabilityNotes: string;
  /** What the connector may do with a job it finds. */
  submissionCapability: "DISCOVERY_ONLY" | "PREPARE_AND_HANDOFF";
  needsToken: boolean;
  tokenHelp?: string;
}

export interface Connector {
  info: ConnectorInfo;
  fetchJobs(source: Source, ctx: ConnectorContext): Promise<RawJob[]>;
}

export class RateLimitedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limited by provider; retry after ${retryAfterSeconds}s`);
  }
}

export class ConnectorError extends Error {}

const MAX_BYTES = 15 * 1024 * 1024;

/** Polite, bounded GET returning parsed JSON. Honors 429/Retry-After. */
export async function getJson(ctx: ConnectorContext, url: string): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await ctx.fetch(url, {
      headers: { accept: "application/json", "user-agent": "personal-job-agent/1.0 (+personal use; published feeds only)" },
      signal: ctl.signal,
    });
    if (res.status === 429 || res.status === 503) {
      const ra = parseInt(res.headers.get("retry-after") ?? "", 10);
      throw new RateLimitedError(Number.isFinite(ra) ? ra : 900);
    }
    if (res.status === 404) throw new ConnectorError("Board not found (check the token/slug).");
    if (!res.ok) throw new ConnectorError(`Provider responded ${res.status}`);
    const len = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (len > MAX_BYTES) throw new ConnectorError("Response too large");
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new ConnectorError("Response too large");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** Board tokens are interpolated into URLs; restrict to a safe alphabet. */
export function assertSafeToken(token: string | null): string {
  if (!token || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(token)) throw new ConnectorError("Invalid board token.");
  return token;
}
