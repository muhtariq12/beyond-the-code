import { htmlToText } from "../text";
import { findSalaryInDescription } from "../jobs/salary";
import type { RawJob } from "../jobs/normalize";
import { assertSafeToken, getJson, type Connector } from "./types";

interface GhJob {
  id: number;
  title: string;
  updated_at?: string;
  first_published?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  metadata?: { name: string; value: unknown }[] | null;
}

/** Greenhouse Job Board API (public, read-only): GET /v1/boards/{token}/jobs?content=true */
export const greenhouse: Connector = {
  info: {
    type: "greenhouse",
    label: "Greenhouse",
    retrievalMethod: "Public Job Board API (boards-api.greenhouse.io), read-only JSON",
    capabilityNotes:
      "Published jobs are public. Submitting applications through the Job Board API requires an API key issued by the employer, so submission defaults to prepare-and-handoff.",
    submissionCapability: "PREPARE_AND_HANDOFF",
    needsToken: true,
    tokenHelp: "Board token from boards.greenhouse.io/<token>",
  },
  async fetchJobs(source, ctx) {
    const token = assertSafeToken(source.token);
    const data = (await getJson(ctx, `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`)) as { jobs?: GhJob[] };
    const retrievedAt = ctx.now().toISOString();
    return (data.jobs ?? []).map((j): RawJob => {
      const text = htmlToText(j.content ?? "");
      const payMeta = (j.metadata ?? []).find((m) => /salary|compensation|pay/i.test(m.name) && typeof m.value === "string");
      return {
        sourceId: source.id,
        sourceType: "greenhouse",
        externalId: String(j.id),
        url: j.absolute_url,
        applyUrl: j.absolute_url,
        employer: source.name,
        title: j.title,
        descriptionText: text,
        location: j.location?.name ?? "",
        salary: payMeta ? findSalaryInDescription(String(payMeta.value)) : null,
        postedAt: j.first_published ?? j.updated_at ?? null,
        retrievedAt,
        availability: "OPEN",
      };
    });
  },
};
