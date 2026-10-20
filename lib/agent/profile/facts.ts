import type { Entry, Fact, Profile, SkillItem } from "../types";

export const verifiedFacts = (p: Profile): Fact[] => p.facts.filter((f) => f.verified);
export const verifiedSkills = (p: Profile): SkillItem[] => p.skills.filter((s) => s.verified);
export const verifiedEntries = (p: Profile): Entry[] => p.entries.filter((e) => e.verified);
export const factById = (p: Profile, id: string) => p.facts.find((f) => f.id === id);
export const entryById = (p: Profile, id: string) => p.entries.find((e) => e.id === id);
export const isTechFact = (f: Fact) => f.text.startsWith("Technologies: ");

function monthIndex(d: string | null, fallbackEnd: Date): number | null {
  if (!d) return fallbackEnd.getFullYear() * 12 + fallbackEnd.getMonth();
  const m = d.match(/^(\d{4})(?:-(\d{2}))?$/);
  return m ? +m[1] * 12 + (m[2] ? +m[2] - 1 : 0) : null;
}

/** Months of professional experience from verified employment entries (overlaps counted once). Null if dates unusable. */
export function professionalMonths(p: Profile, now: Date): number | null {
  const spans: [number, number][] = [];
  for (const e of verifiedEntries(p)) {
    if (e.type !== "EMPLOYMENT") continue;
    const s = monthIndex(e.start, now);
    const en = e.current ? now.getFullYear() * 12 + now.getMonth() : monthIndex(e.end, now);
    if (s == null || en == null || !e.start) continue;
    spans.push([s, Math.max(s, en)]);
  }
  if (!spans.length) return null;
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else {
      total += ce - cs;
      [cs, ce] = [s, e];
    }
  }
  return total + (ce - cs);
}

export interface ProfileIssue {
  level: "QUESTION" | "WARNING";
  text: string;
}

/** Things the owner should confirm before facts are relied on. Never auto-corrected. */
export function profileIssues(p: Profile, now: Date): ProfileIssue[] {
  const out: ProfileIssue[] = [];
  const emp = p.entries.filter((e) => e.type === "EMPLOYMENT" && e.start);
  for (let i = 0; i < emp.length; i++) {
    for (let j = i + 1; j < emp.length; j++) {
      const a = emp[i], b = emp[j];
      const [as, ae] = [monthIndex(a.start, now)!, a.current ? monthIndex(null, now)! : monthIndex(a.end, now) ?? monthIndex(null, now)!];
      const [bs, be] = [monthIndex(b.start, now)!, b.current ? monthIndex(null, now)! : monthIndex(b.end, now) ?? monthIndex(null, now)!];
      if (as <= be && bs <= ae && !(as === be || bs === ae)) {
        out.push({ level: "QUESTION", text: `"${a.title}" (${a.org}) and "${b.title}" (${b.org}) have overlapping dates. Confirm they were held concurrently so CVs show them correctly.` });
      }
    }
  }
  for (const e of emp) {
    const end = e.current ? null : e.end;
    if (end && monthIndex(end, now)! > now.getFullYear() * 12 + now.getMonth()) {
      out.push({ level: "QUESTION", text: `"${e.title}" at ${e.org} ends in the future (${end}). Confirm the end date or mark it as ongoing.` });
    }
  }
  const unverified = p.facts.filter((f) => !f.verified).length + p.entries.filter((e) => !e.verified).length + p.skills.filter((s) => !s.verified).length;
  if (unverified) out.push({ level: "WARNING", text: `${unverified} imported item(s) are unverified and will not be used in any CV until you confirm them.` });
  const bare = p.facts.filter((f) => f.verified && f.entryId && !isTechFact(f) && f.metrics.length === 0 && p.entries.find((e) => e.id === f.entryId)?.type === "EMPLOYMENT");
  if (bare.length) out.push({ level: "QUESTION", text: `${bare.length} work bullet(s) state no measurable outcome. Add a verified metric only if you can evidence it; none will be invented.` });
  return out;
}
