import type { Connector } from "./types";
import { ConnectorError } from "./types";

/**
 * User-directed import: you paste a job description (for example from a LinkedIn job you are
 * viewing, a job-alert email or a UAE job board). Nothing is fetched from those sites.
 */
export const manual: Connector = {
  info: {
    type: "manual",
    label: "Manual / pasted job",
    retrievalMethod: "You paste the job text and URL (user-directed, no scraping)",
    capabilityNotes:
      "Works for LinkedIn, UAE job boards and any employer page you are allowed to view. The original page is opened for you to apply; nothing is automated.",
    submissionCapability: "PREPARE_AND_HANDOFF",
    needsToken: false,
  },
  async fetchJobs() {
    throw new ConnectorError("Manual source has no feed; use Discover Jobs > Add job.");
  },
};
