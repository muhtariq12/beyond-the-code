import crypto from "node:crypto";
import { extractSkills, canonicalSkill } from "../skills";
import { normalizeWhitespace } from "../text";
import type { Entry, EntryType, Fact, Profile, SkillItem } from "../types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE = "(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?\\s+)?\\d{4}";
const RANGE_RE = new RegExp(`(${DATE})\\s*[-–—]\\s*(${DATE}|Present|Current|Now)\\s*$`, "i");

function parseDate(s: string): string {
  const m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m) {
    const i = MONTHS.indexOf(m[1].toLowerCase());
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, "0")}`;
  }
  return s.match(/\d{4}/)?.[0] ?? s;
}

export function formatDateRange(e: Pick<Entry, "start" | "end" | "current">): string {
  const f = (d: string | null) => {
    if (!d) return "";
    const m = d.match(/^(\d{4})-(\d{2})$/);
    return m ? `${MONTHS[+m[2] - 1][0].toUpperCase()}${MONTHS[+m[2] - 1].slice(1)} ${m[1]}` : d;
  };
  if (!e.start && !e.end && !e.current) return "";
  return `${f(e.start)} – ${e.current ? "Present" : f(e.end)}`.trim();
}

const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

const SECTION_RE: [RegExp, string][] = [
  [/^summary|^profile|^professional summary|^about/i, "SUMMARY"],
  [/^(work |professional )?experience|^employment/i, "EXPERIENCE"],
  [/^projects?/i, "PROJECTS"],
  [/^(technical )?skills/i, "SKILLS"],
  [/^education/i, "EDUCATION"],
  [/^publications?/i, "PUBLICATIONS"],
  [/^certifications?|^(awards|leadership|achievements)/i, "CERTS"],
];

function sectionOf(line: string): string | null {
  const t = line.trim();
  if (t.length > 45 || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return null;
  for (const [re, name] of SECTION_RE) if (re.test(t)) return name;
  return null;
}

const isBullet = (l: string) => /^[•\-•*▪◦]\s*/.test(l);
const stripBullet = (l: string) => l.replace(/^[•\-•*▪◦]\s*/, "");

function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
}

export interface ParseResult {
  profile: Profile;
  warnings: string[];
}

/**
 * Deterministic CV parser for conventional "HEADING / Title | Org  Dates / • bullet" layouts.
 * Everything it produces is unverified until the owner confirms it; nothing is inferred beyond the text.
 */
export function parseCvText(rawText: string, docId: string, nowIso: string): ParseResult {
  const warnings: string[] = [];
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: Entry[] = [];
  const facts: Fact[] = [];
  const skills: SkillItem[] = [];
  const src = (ref: string, quote?: string) => ({ doc: docId, ref, quote: quote?.slice(0, 200) });

  // header
  const fullName = lines[0] ?? "";
  let i = 1;
  let headline: string | null = null;
  if (lines[1] && !/@|\+?\d{6,}/.test(lines[1]) && !sectionOf(lines[1])) {
    headline = lines[1];
    i = 2;
  }
  let email: string | null = null;
  let phone: string | null = null;
  let location: string | null = null;
  const links: { label: string; url: string }[] = [];
  if (lines[i] && !sectionOf(lines[i])) {
    for (const part of lines[i].split("|").map((p) => p.trim())) {
      if (/@/.test(part)) email = part.match(/[^\s|]+@[^\s|]+/)?.[0] ?? null;
      else if (/^\+?[\d\s().-]{7,}$/.test(part)) phone = part;
      else if (/linkedin\.com|github\.com|\.(com|io|app|dev)\b/i.test(part)) links.push({ label: part.replace(/^https?:\/\//, "").split("/")[0], url: part.startsWith("http") ? part : `https://${part}` });
      else if (!location) location = part;
    }
    i++;
  }

  // sections
  const sections: { name: string; lines: string[] }[] = [];
  for (; i < lines.length; i++) {
    const s = sectionOf(lines[i]);
    if (s) sections.push({ name: s, lines: [] });
    else if (sections.length) sections[sections.length - 1].lines.push(lines[i]);
  }

  const addFact = (entryId: string | null, text: string, ref: string, extraSkills: string[] = []) => {
    const t = normalizeWhitespace(text);
    const id = "f_" + hash(`${entryId ?? "-"}|${t}`);
    if (facts.some((f) => f.id === id)) return id;
    facts.push({
      id,
      entryId,
      text: t,
      skills: [...new Set([...extractSkills(t), ...extraSkills])],
      metrics: numbersIn(t),
      source: src(ref, t),
      verified: false,
      verifiedAt: null,
    });
    return id;
  };
  const addEntry = (type: EntryType, title: string, org: string, range: RegExpMatchArray | null, ref: string, order: number): Entry => {
    const e: Entry = {
      id: "e_" + hash(`${type}|${title}|${org}`),
      type,
      title: title.trim(),
      org: org.trim(),
      location: null,
      start: range ? parseDate(range[1]) : null,
      end: range && !/present|current|now/i.test(range[2]) ? parseDate(range[2]) : null,
      current: !!range && /present|current|now/i.test(range[2]),
      source: src(ref, title),
      verified: false,
      order,
    };
    entries.push(e);
    return e;
  };

  /** group "• bullet" lines (joining wrapped continuations) under header lines */
  const blocks = (ls: string[], isHeader: (l: string, prevIsBullet: boolean) => boolean) => {
    const out: { header: string; bullets: string[] }[] = [];
    for (const l of ls) {
      const prevBullet = out.length > 0 && out[out.length - 1].bullets.length > 0;
      if (isBullet(l)) out[out.length - 1]?.bullets.push(stripBullet(l));
      else if (isHeader(l, prevBullet) || out.length === 0) out.push({ header: l, bullets: [] });
      else if (out[out.length - 1].bullets.length) {
        const b = out[out.length - 1].bullets;
        b[b.length - 1] = `${b[b.length - 1]} ${l}`;
      } else out[out.length - 1].header += ` ${l}`;
    }
    return out;
  };

  for (const sec of sections) {
    const ref = `CV section "${sec.name}"`;
    if (sec.name === "SUMMARY") {
      const sentences = normalizeWhitespace(sec.lines.join(" ")).split(/(?<=[.!?])\s+/).filter(Boolean);
      for (const s of sentences) addFact(null, s, ref);
    }
    if (sec.name === "EXPERIENCE") {
      blocks(sec.lines, (l) => l.includes(" | ") && RANGE_RE.test(l)).forEach((b, idx) => {
        const range = b.header.match(RANGE_RE);
        const head = range ? b.header.slice(0, range.index).trim() : b.header;
        const [title, ...rest] = head.split(" | ");
        if (!range) warnings.push(`No date range found for "${title}".`);
        const e = addEntry("EMPLOYMENT", title, rest.join(" | "), range, `${ref}, entry ${idx + 1}`, idx);
        b.bullets.forEach((t) => addFact(e.id, t, `${ref}, ${e.title}`));
      });
    }
    if (sec.name === "PROJECTS") {
      blocks(sec.lines, (l) => l.includes(" | ")).forEach((b, idx) => {
        const [nameAndUrl, tech] = b.header.split(" | ").map((s) => s.trim());
        const e = addEntry("PROJECT", nameAndUrl, "", null, `${ref}, project ${idx + 1}`, idx);
        const techItems = tech ? splitTop(tech) : [];
        if (techItems.length) {
          const canon = techItems.map((t) => canonicalSkill(t)).filter((x): x is string => !!x);
          addFact(e.id, `Technologies: ${techItems.join(", ")}`, `${ref}, ${e.title} (technology list)`, canon);
        }
        b.bullets.forEach((t) => addFact(e.id, t, `${ref}, ${e.title}`));
      });
    }
    if (sec.name === "SKILLS") {
      const joined: string[] = [];
      for (const l of sec.lines) {
        if (/^[A-Z][A-Za-z &/]{1,40}:/.test(l) || joined.length === 0) joined.push(l);
        else joined[joined.length - 1] += ` ${l}`;
      }
      for (const l of joined) {
        const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
        const group = m ? m[1].trim() : "Skills";
        for (const label of splitTop(m ? m[2] : l)) {
          skills.push({ name: canonicalSkill(label) ?? label, label, group, source: src(`${ref}, ${group}`, label), verified: false });
        }
      }
    }
    if (sec.name === "EDUCATION") {
      for (let k = 0; k < sec.lines.length; k++) {
        const l = sec.lines[k];
        const range = l.match(RANGE_RE);
        if (!range && !/^(bachelor|master|bsc|msc|phd|diploma|b\.?sc|m\.?sc)/i.test(l)) continue;
        const title = (range ? l.slice(0, range.index) : l).trim();
        const [org, ...extra] = (sec.lines[k + 1] ?? "").split(" | ").map((x) => x.trim());
        const e = addEntry("EDUCATION", title, org ?? "", range, `${ref}, entry ${entries.filter((x) => x.type === "EDUCATION").length + 1}`, entries.length);
        extra.forEach((x) => addFact(e.id, x, `${ref}, ${e.title}`));
        k++;
      }
    }
    if (sec.name === "PUBLICATIONS") {
      const text = normalizeWhitespace(sec.lines.join(" "));
      const e = addEntry("PUBLICATION", text, "", null, ref, 0);
      addFact(e.id, text, ref);
    }
    if (sec.name === "CERTS") {
      sec.lines.forEach((l, idx) => {
        const items = idx === 0 && l.includes(",") && !/\b(award|talk|panel)\b/i.test(l) ? splitTop(l) : [l];
        for (const it of items) {
          const isAward = /\b(award|winner|speaker|prize|scholarship)\b/i.test(it);
          const e = addEntry(isAward ? "AWARD" : "CERTIFICATION", it, "", null, ref, entries.length);
          addFact(e.id, it, ref);
        }
      });
    }
  }

  if (!fullName) warnings.push("Could not read a name from the first line.");
  if (!entries.some((e) => e.type === "EMPLOYMENT")) warnings.push("No work-experience entries were detected; check the CV layout or add them manually.");

  return {
    warnings,
    profile: {
      fullName,
      headline,
      email,
      phone,
      location,
      links,
      entries,
      facts,
      skills,
      originalCvDocId: docId,
      importedAt: nowIso,
      updatedAt: nowIso,
    },
  };
}

/** Re-import keeps the owner's verification for any fact/entry/skill whose content is unchanged. */
export function mergeReimport(prev: Profile | null, next: Profile): Profile {
  if (!prev) return next;
  const vf = new Map(prev.facts.filter((f) => f.verified).map((f) => [f.id, f]));
  const ve = new Map(prev.entries.filter((e) => e.verified).map((e) => [e.id, e]));
  const vs = new Map(prev.skills.filter((s) => s.verified).map((s) => [s.label, s]));
  return {
    ...next,
    facts: next.facts.map((f) => (vf.has(f.id) ? { ...f, verified: true, verifiedAt: vf.get(f.id)!.verifiedAt } : f)),
    entries: next.entries.map((e) => (ve.has(e.id) ? { ...e, verified: true } : e)),
    skills: next.skills.map((s) => (vs.has(s.label) ? { ...s, verified: true } : s)),
  };
}
