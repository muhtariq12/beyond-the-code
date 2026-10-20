import { htmlToText } from "../text";
import { findSalaryInDescription } from "../jobs/salary";
import type { RawJob } from "../jobs/normalize";
import { assertSafeToken, getJson, type Connector } from "./types";

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  employmentType?: string;
  jobUrl: string;
  applyUrl?: string;
  compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
}

/** Ashby public job board: GET /posting-api/job-board/{name}?includeCompensation=true */
export const ashby: Connector = {
  info: {
    type: "ashby",
    label: "Ashby",
    retrievalMethod: "Public job-board posting API (api.ashbyhq.com/posting-api), read-only JSON",
    capabilityNotes:
      "Published jobs are public. Application submission needs the employer's authorization, so submission defaults to prepare-and-handoff.",
    submissionCapability: "PREPARE_AND_HANDOFF",
    needsToken: true,
    tokenHelp: "Board name from jobs.ashbyhq.com/<name>",
  },
  async fetchJobs(source, ctx) {
    const token = assertSafeToken(source.token);
    const data = (await getJson(ctx, `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`)) as { jobs?: AshbyJob[] };
    const retrievedAt = ctx.now().toISOString();
    return (data.jobs ?? [])
      .filter((j) => j.isListed !== false)
      .map((j): RawJob => {
        const pay = j.compensation?.scrapeableCompensationSalarySummary ?? j.compensation?.compensationTierSummary ?? "";
        const loc = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join("; ");
        return {
          sourceId: source.id,
          sourceType: "ashby",
          externalId: j.id,
          url: j.jobUrl,
          applyUrl: j.applyUrl ?? j.jobUrl,
          employer: source.name,
          title: j.title,
          descriptionText: j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? ""),
          location: loc,
          remoteHint: j.isRemote ? "remote" : (j.workplaceType ?? null),
          employmentTypeHint: j.employmentType ?? null,
          salary: pay ? findSalaryInDescription(pay) : null,
          postedAt: j.publishedAt ?? null,
          retrievedAt,
          availability: "OPEN",
        };
      });
  },
};
