import { normalizeWhitespace, stripControl } from "../text";
import type { RawJob } from "../jobs/normalize";
import { canonicalizeUrl } from "../jobs/normalize";
import type { Connector } from "./types";
import { ConnectorError } from "./types";

export const email: Connector = {
  info: {
    type: "email",
    label: "Job-alert email",
    retrievalMethod: "You paste or forward alert emails; links are extracted deterministically (no model reads the email)",
    capabilityNotes:
      "Discovery only. Alert emails carry links, not full descriptions, so jobs are created as stubs until you paste the description or an ATS API resolves them.",
    submissionCapability: "PREPARE_AND_HANDOFF",
    needsToken: false,
  },
  async fetchJobs() {
    throw new ConnectorError("Email source is push-based; paste an alert in Discover Jobs.");
  },
};

const ATS_HOSTS = /(?:boards|job-boards)\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com/i;

export interface ParsedAlertLink {
  url: string;
  title: string;
  ats: "greenhouse" | "lever" | "ashby" | null;
}

/** Extract job links and their visible titles from an alert email body (text or HTML). Pure parsing. */
export function parseAlertEmail(body: string): ParsedAlertLink[] {
  const text = stripControl(body);
  const found = new Map<string, ParsedAlertLink>();
  const anchor = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(text))) add(m[1], m[2].replace(/<[^>]+>/g, " "));
  const bare = /https?:\/\/[^\s<>"')]+/gi;
  while ((m = bare.exec(text))) if (!found.has(canonicalizeUrl(m[0]))) add(m[0], "");
  function add(url: string, label: string) {
    if (!/^https?:\/\//i.test(url)) return;
    if (/unsubscribe|preferences|privacy|mailto:|\.(png|jpe?g|gif)(\?|$)/i.test(url)) return;
    if (!/job|career|position|vacanc|apply|opening|posting|greenhouse|lever|ashby/i.test(url)) return;
    const canonical = canonicalizeUrl(url);
    const host = ATS_HOSTS.exec(url)?.[0]?.toLowerCase() ?? "";
    found.set(canonical, {
      url: canonical,
      title: normalizeWhitespace(label).slice(0, 160) || "Untitled alert job",
      ats: host.includes("greenhouse") ? "greenhouse" : host.includes("lever") ? "lever" : host.includes("ashby") ? "ashby" : null,
    });
  }
  return [...found.values()].slice(0, 100);
}

export function alertLinkToStub(link: ParsedAlertLink, sourceId: string, nowIso: string): RawJob {
  return {
    sourceId,
    sourceType: "email",
    externalId: null,
    url: link.url,
    employer: new URL(link.url).hostname.replace(/^www\./, ""),
    title: link.title,
    descriptionText: "",
    location: "",
    retrievedAt: nowIso,
    availability: "UNKNOWN",
  };
}
