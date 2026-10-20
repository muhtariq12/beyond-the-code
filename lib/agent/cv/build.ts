import { skillDef } from "../skills";
import { formatDateRange } from "../profile/import";
import { isTechFact, verifiedEntries, verifiedFacts, verifiedSkills } from "../profile/facts";
import type { CvDoc, CvSection, Entry, Fact, Job, Match, Profile } from "../types";
import { factRelevance, jobTerms, rankFacts } from "./rank";

export interface BuildOptions {
  /** extra skills the user wants emphasised (from "regenerate with revised emphasis") */
  emphasis?: string[];
  maxBulletsCurrent?: number;
  maxBullets?: number;
  maxProjects?: number;
}

function headerLines(p: Profile): CvDoc["header"] {
  const contact = [p.location, p.phone, p.email, ...p.links.map((l) => l.label)].filter((x): x is string => !!x);
  return { name: p.fullName, contact };
}

function sectionFor(e: Entry, bullets: Fact[], tech?: string[]): CvSection {
  return {
    entryId: e.id,
    title: e.title,
    org: e.org,
    location: e.location,
    dates: formatDateRange(e),
    ...(tech && tech.length ? { tech } : {}),
    bullets: bullets.filter((f) => f.text !== e.title).map((f) => ({ text: f.text, factIds: [f.id] })),
  };
}

function techItems(profile: Profile, e: Entry): { items: string[]; fact: Fact | null } {
  const f = verifiedFacts(profile).find((x) => x.entryId === e.id && isTechFact(x));
  return { items: f ? f.text.replace("Technologies: ", "").split(/,\s*(?![^()]*\))/).map((s) => s.trim()) : [], fact: f ?? null };
}

function skillsSection(profile: Profile, job: Job | null, emphasis: string[]): CvDoc["skills"] {
  const vs = verifiedSkills(profile);
  const boost = (name: string) => (job?.requiredSkills.includes(name) ? 3 : job?.preferredSkills.includes(name) ? 2 : 0) + (emphasis.includes(name) ? 2 : 0);
  const groups = new Map<string, typeof vs>();
  for (const s of vs) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  const rows = [...groups.entries()].map(([label, items], gi) => ({
    label,
    gi,
    score: items.reduce((a, s) => a + boost(s.name), 0),
    items: items.map((s, i) => ({ s, i })).sort((a, b) => boost(b.s.name) - boost(a.s.name) || a.i - b.i).map((x) => x.s.label),
  }));
  rows.sort((a, b) => b.score - a.score || a.gi - b.gi);
  return rows.map(({ label, items }) => ({ label, items }));
}

/** The unmodified master view: every verified item in original CV order. Used as the comparison baseline. */
export function buildBaselineCv(profile: Profile): CvDoc {
  const facts = verifiedFacts(profile);
  const entries = verifiedEntries(profile);
  const sec = (type: Entry["type"]) =>
    entries.filter((e) => e.type === type).sort((a, b) => a.order - b.order).map((e) => {
      const t = techItems(profile, e);
      return sectionFor(e, facts.filter((f) => f.entryId === e.id && !isTechFact(f)), t.items);
    });
  const summaryFacts = facts.filter((f) => f.entryId === null);
  return {
    header: headerLines(profile),
    summary: { text: summaryFacts.map((f) => f.text).join(" "), factIds: summaryFacts.map((f) => f.id) },
    skills: skillsSection(profile, null, []),
    experience: sec("EMPLOYMENT"),
    projects: sec("PROJECT"),
    education: sec("EDUCATION"),
    certifications: [...sec("CERTIFICATION"), ...sec("AWARD")],
    publications: sec("PUBLICATION"),
  };
}

/** Deterministic tailoring: selects, orders and emphasises verified content. Bullet text stays verbatim. */
export function buildTailoredCv(profile: Profile, job: Job, match: Match, opts: BuildOptions = {}): CvDoc {
  const emphasis = opts.emphasis ?? [];
  const jobWithEmphasis: Job = emphasis.length ? { ...job, requiredSkills: [...new Set([...job.requiredSkills, ...emphasis])] } : job;
  const facts = verifiedFacts(profile);
  const entries = verifiedEntries(profile);
  const terms = jobTerms(jobWithEmphasis);

  const pick = (entry: Entry, max: number) => {
    const ranked = rankFacts(facts.filter((f) => f.entryId === entry.id), jobWithEmphasis, profile);
    return ranked.slice(0, max);
  };
  const orderedDates = (e: Entry) => e.order;

  const experience = entries
    .filter((e) => e.type === "EMPLOYMENT")
    .sort((a, b) => orderedDates(a) - orderedDates(b))
    .map((e, i) => sectionFor(e, pick(e, i === 0 ? (opts.maxBulletsCurrent ?? 4) : (opts.maxBullets ?? 3))));

  const projEntries = entries.filter((e) => e.type === "PROJECT").map((e) => {
    const fs = facts.filter((f) => f.entryId === e.id);
    const score = Math.max(0, ...fs.map((f) => factRelevance(f, jobWithEmphasis, profile, terms)));
    return { e, score };
  });
  projEntries.sort((a, b) => b.score - a.score || a.e.order - b.e.order);
  const projects = projEntries.slice(0, opts.maxProjects ?? 3).map(({ e }) => {
    const t = techItems(profile, e);
    const boosted = [...t.items].sort((a, b) => Number(jobWithEmphasis.requiredSkills.includes(skillDef(b)?.name ?? b)) - Number(jobWithEmphasis.requiredSkills.includes(skillDef(a)?.name ?? a)));
    return sectionFor(e, pick(e, 2), boosted);
  });

  const plain = (type: Entry["type"]) => entries.filter((e) => e.type === type).sort((a, b) => a.order - b.order).map((e) => sectionFor(e, facts.filter((f) => f.entryId === e.id && !isTechFact(f))));

  return {
    header: headerLines(profile),
    summary: buildSummary(profile, jobWithEmphasis, match),
    skills: skillsSection(profile, jobWithEmphasis, emphasis),
    experience,
    projects,
    education: plain("EDUCATION"),
    certifications: [...plain("CERTIFICATION"), ...plain("AWARD")],
    publications: plain("PUBLICATION"),
  };
}

export function buildSummary(profile: Profile, job: Job, match: Match): CvDoc["summary"] {
  const facts = verifiedFacts(profile);
  const base = facts.filter((f) => f.entryId === null);
  const keep = base.filter((f, i) => i === 0 || /graduat|bsc|bachelor|degree/i.test(f.text) || factRelevance(f, job, profile) > 0);
  const parts = keep.map((f) => f.text);
  const ids = keep.map((f) => f.id);
  const strong = match.matched.filter((m) => m.strength !== "LISTED_ONLY").slice(0, 5);
  if (strong.length) {
    const names = strong.map((m) => m.requirement);
    parts.push(`Hands-on experience with ${joinList(names)} across professional work and projects.`);
    for (const m of strong) for (const id of m.factIds.slice(0, 1)) if (!ids.includes(id)) ids.push(id);
  }
  return { text: parts.join(" "), factIds: ids };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
