import type { Preferences, RemoteMode } from "../types";

const UAE_PLACES = [
  "united arab emirates", "uae", "u.a.e", "dubai", "abu dhabi", "sharjah", "ajman",
  "ras al khaimah", "ras al-khaimah", "fujairah", "umm al quwain", "al ain", "difc", "masdar", "jebel ali",
];
const GULF_REGIONS = ["gcc", "gulf", "middle east", "mena", "middle east and north africa"];
const BROAD_REGIONS = ["emea", "worldwide", "world wide", "global", "anywhere", "any location", "international"];

export type GeoStatus = "CONFIRMED" | "LIKELY" | "UNKNOWN" | "NOT_ELIGIBLE";

export interface GeoAssessment {
  status: GeoStatus;
  result: "PASS" | "FAIL" | "UNKNOWN";
  reason: string;
}

export function mentionsUae(text: string): boolean {
  const t = text.toLowerCase();
  return UAE_PLACES.some((p) => new RegExp(`(?<![a-z])${p.replace(/\./g, "\\.")}(?![a-z])`).test(t));
}

export function detectRemote(location: string, description: string, hint?: string | null): RemoteMode {
  const hay = `${hint ?? ""} ${location} ${description.slice(0, 1500)}`.toLowerCase();
  if (/\bhybrid\b/.test(hay)) return "HYBRID";
  if (/\b(fully |100% )?remote\b|work from home|work from anywhere|distributed team/.test(hay)) {
    if (/\bon-?site\b|\bin[- ]office\b/.test(hint?.toLowerCase() ?? "")) return "ONSITE";
    return "REMOTE";
  }
  if (/\bon-?site\b|\bin[- ]office\b/.test(hay)) return "ONSITE";
  return "UNKNOWN";
}

/** Regions a remote role says it accepts, e.g. "Remote - US" -> ["US"]. */
export function detectRemoteRegions(location: string, description: string): string[] {
  const out = new Set<string>();
  const hay = `${location}\n${description.slice(0, 3000)}`;
  const t = hay.toLowerCase();
  if (mentionsUae(t)) out.add("UAE");
  for (const g of GULF_REGIONS) if (t.includes(g)) out.add(g.toUpperCase());
  for (const b of BROAD_REGIONS) if (new RegExp(`(?<![a-z])${b}(?![a-z])`).test(t)) out.add(b.toUpperCase());
  const restricted: [RegExp, string][] = [
    [/\b(us|usa|u\.s\.|united states)( only| based| residents)?\b/, "US"],
    [/\bcanada\b/, "CANADA"],
    [/\b(uk|united kingdom|great britain)\b/, "UK"],
    [/\b(europe|european union|eu)\b/, "EUROPE"],
    [/\bindia\b/, "INDIA"],
    [/\bapac\b|\basia pacific\b/, "APAC"],
    [/\blatam\b|latin america/, "LATAM"],
    [/\baustralia\b/, "AUSTRALIA"],
  ];
  for (const [re, label] of restricted) if (re.test(t)) out.add(label);
  return [...out];
}

export function assessGeography(
  job: { location: string; remote: RemoteMode; remoteRegions: string[]; description: string },
  prefs: Pick<Preferences, "relocationEnabled">,
): GeoAssessment {
  const loc = job.location;
  const inUae = mentionsUae(loc);
  const regions = job.remoteRegions;
  const acceptsUae = regions.includes("UAE");

  if (job.remote === "REMOTE") {
    if (acceptsUae) return { status: "CONFIRMED", result: "PASS", reason: "Remote role that names the UAE explicitly." };
    const gulf = regions.some((r) => ["GCC", "GULF", "MIDDLE EAST", "MENA", "MIDDLE EAST AND NORTH AFRICA"].includes(r));
    if (gulf) return { status: "LIKELY", result: "PASS", reason: `Remote role open to ${regions.join(", ")}, which includes the UAE; confirm the employer can engage you from the UAE.` };
    const broad = regions.some((r) => ["WORLDWIDE", "WORLD WIDE", "GLOBAL", "ANYWHERE", "ANY LOCATION", "EMEA", "INTERNATIONAL"].includes(r));
    const restricted = regions.filter((r) => !["WORLDWIDE", "WORLD WIDE", "GLOBAL", "ANYWHERE", "ANY LOCATION", "EMEA", "INTERNATIONAL"].includes(r));
    if (broad && restricted.length === 0) return { status: "LIKELY", result: "PASS", reason: `Remote role open "${regions.join(", ").toLowerCase()}"; does not name the UAE, so confirm hiring from the UAE is possible.` };
    if (restricted.length > 0) return { status: "NOT_ELIGIBLE", result: "FAIL", reason: `Remote role restricted to ${restricted.join(", ")}; the UAE is not listed.` };
    if (inUae) return { status: "CONFIRMED", result: "PASS", reason: "Remote role located in the UAE." };
    return { status: "UNKNOWN", result: "UNKNOWN", reason: "Remote role with no stated eligible countries or regions." };
  }

  if (inUae) {
    return { status: "CONFIRMED", result: "PASS", reason: `${job.remote === "HYBRID" ? "Hybrid" : "On-site"} role located in the UAE (${loc}).` };
  }
  if (!loc.trim() || /^(n\/?a|unknown|-)$/i.test(loc.trim())) {
    return { status: "UNKNOWN", result: "UNKNOWN", reason: "Job location not stated." };
  }
  if (prefs.relocationEnabled) {
    return { status: "UNKNOWN", result: "UNKNOWN", reason: `Located in ${loc}; relocation is enabled, needs your decision.` };
  }
  return { status: "NOT_ELIGIBLE", result: "FAIL", reason: `Located in ${loc}, outside the UAE, and relocation is disabled.` };
}
