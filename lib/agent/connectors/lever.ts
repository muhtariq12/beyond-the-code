import { htmlToText } from "../text";
import type { RawJob } from "../jobs/normalize";
import { assertSafeToken, getJson, type Connector } from "./types";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  descriptionPlain?: string;
  description?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
  categories?: { location?: string; commitment?: string; team?: string; allLocations?: string[] };
  country?: string;
  salaryRange?: { currency?: string; interval?: string; min?: number; max?: number };
}

const INTERVAL: Record<string, "HOUR" | "MONTH" | "YEAR" | "WEEK" | "DAY"> = {
  "per-hour-salary": "HOUR",
  "per-month-salary": "MONTH",
  "per-year-salary": "YEAR",
  "per-week-salary": "WEEK",
  "per-day-salary": "DAY",
};

/** Lever Postings API (public): GET /v0/postings/{site}?mode=json */
export const lever: Connector = {
  info: {
    type: "lever",
    label: "Lever",
    retrievalMethod: "Public Postings API (api.lever.co/v0/postings), read-only JSON",
    capabilityNotes:
      "Published postings are public. Applying through the Postings API needs an employer-issued API key, so submission defaults to prepare-and-handoff.",
    submissionCapability: "PREPARE_AND_HANDOFF",
    needsToken: true,
    tokenHelp: "Site slug from jobs.lever.co/<slug>",
  },
  async fetchJobs(source, ctx) {
    const token = assertSafeToken(source.token);
    const data = (await getJson(ctx, `https://api.lever.co/v0/postings/${token}?mode=json`)) as LeverPosting[];
    const retrievedAt = ctx.now().toISOString();
    return (Array.isArray(data) ? data : []).map((p): RawJob => {
      const body = [
        p.descriptionPlain ?? htmlToText(p.description ?? ""),
        ...(p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
        p.additionalPlain ?? "",
      ].join("\n\n");
      const sr = p.salaryRange;
      return {
        sourceId: source.id,
        sourceType: "lever",
        externalId: p.id,
        url: p.hostedUrl,
        applyUrl: p.applyUrl ?? p.hostedUrl,
        employer: source.name,
        title: p.text,
        descriptionText: body,
        location: p.categories?.allLocations?.join("; ") || p.categories?.location || "",
        remoteHint: p.workplaceType ?? null,
        employmentTypeHint: p.categories?.commitment ?? null,
        salary: sr && (sr.min != null || sr.max != null)
          ? { min: sr.min ?? null, max: sr.max ?? null, currency: sr.currency ?? null, period: INTERVAL[sr.interval ?? ""] ?? "UNKNOWN", basis: "UNKNOWN", raw: `${sr.currency ?? ""} ${sr.min ?? ""}-${sr.max ?? ""} ${sr.interval ?? ""}`.trim() }
          : null,
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
        retrievedAt,
        availability: "OPEN",
      };
    });
  },
};
