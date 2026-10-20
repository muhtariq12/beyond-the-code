import type { Source, SourceType } from "../types";
import { ashby } from "./ashby";
import { email } from "./email";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { manual } from "./manual";
import { ConnectorError } from "./types";
import type { Connector, ConnectorInfo } from "./types";

const sandbox: Connector = {
  info: {
    type: "sandbox",
    label: "Sandbox (test employer)",
    retrievalMethod: "Seeded fixtures only; never contacts a real employer",
    capabilityNotes: "Exercises the authorised-submission path against an in-memory fake. Requires AGENT_ENABLE_SANDBOX=1.",
    submissionCapability: "PREPARE_AND_HANDOFF",
    needsToken: false,
  },
  async fetchJobs() {
    throw new ConnectorError("Sandbox has no feed.");
  },
};

export const CONNECTORS: Record<SourceType, Connector> = { greenhouse, lever, ashby, manual, email, sandbox };

/** Providers we deliberately do not connect to, shown honestly in the Sources page. */
export const UNCONNECTED_PROVIDERS: { name: string; status: "NOT_CONNECTED"; note: string }[] = [
  { name: "LinkedIn", status: "NOT_CONNECTED", note: "No scraping or browser automation. Use saved-job alert emails or paste a job description you are viewing." },
  { name: "Bayt / GulfTalent / Naukrigulf", status: "NOT_CONNECTED", note: "No authorized API or feed configured. Paste jobs or forward alert emails." },
  { name: "Official company career pages", status: "NOT_CONNECTED", note: "Add the company's Greenhouse, Lever or Ashby board if it has one; otherwise paste the job." },
];

export function connectorFor(source: Source): Connector {
  return CONNECTORS[source.type];
}

export function connectorInfos(): ConnectorInfo[] {
  return Object.values(CONNECTORS).filter((c) => c.info.type !== "sandbox").map((c) => c.info);
}
