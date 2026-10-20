import type { Ctx } from "../ctx";
import { newId } from "../store/store";
import { norm } from "../text";
import { canonicalSkill, extractSkills } from "../skills";
import { evidenceFor } from "../matching/score";
import { verifiedEntries } from "../profile/facts";
import type { Answer, AnswerCategory, Preferences, Profile } from "../types";

const RULES: [AnswerCategory, RegExp][] = [
  ["DEMOGRAPHIC", /\b(gender|ethnic\w*|race|racial|religio\w*|disabilit\w*|veteran|sexual orientation|marital|pronoun|date of birth|age|nationality)\b/i],
  ["CLEARANCE", /\bclearance\b/i],
  ["SPONSORSHIP", /\b(sponsor(ship)?|visa)\b/i],
  ["WORK_AUTHORIZATION", /\b(authori[sz]ed|legally|right to work|work permit|eligib\w* to work|employment eligibility)\b/i],
  ["SALARY", /\b(salary|compensation|pay expectation|expected (pay|ctc)|remuneration)\b/i],
  ["RELOCATION", /\b(relocat\w*|willing to move)\b/i],
  ["NOTICE_PERIOD", /\b(notice period|start date|when can you start|availability to start|earliest start)\b/i],
  ["LEGAL", /\b(certify|attest|declare|acknowledge|i agree|consent|background check|criminal|convicted|non-?compete|terms and conditions|privacy policy)\b/i],
  ["YEARS_EXPERIENCE", /\bhow many years\b|\byears of (relevant |professional |work )?experience\b/i],
  ["LINK", /\b(linkedin|github|portfolio|website|personal site)\b/i],
  ["CONTACT", /\b(first name|last name|full name|email|e-mail|phone|mobile|city|current location|where are you (based|located)|address)\b/i],
  ["EDUCATION", /\b(degree|university|school|education|graduat\w+|gpa)\b/i],
  ["SKILL_EXPERIENCE", /\b(experience (with|in|using)|do you have experience|familiar(ity)? with|proficien\w+ (in|with))\b/i],
];

export function classifyQuestion(q: string): AnswerCategory {
  for (const [cat, re] of RULES) if (re.test(q)) return cat;
  return "FREE_TEXT";
}

/** Categories that always need the owner unless they configured a standing answer. */
export const SENSITIVE: AnswerCategory[] = ["WORK_AUTHORIZATION", "SPONSORSHIP", "CLEARANCE", "DEMOGRAPHIC", "SALARY", "RELOCATION", "NOTICE_PERIOD", "LEGAL", "YEARS_EXPERIENCE"];

/** Categories whose meaning does not depend on the job, so a past answer can be reused for an equivalent question. */
const REUSABLE: AnswerCategory[] = ["WORK_AUTHORIZATION", "SPONSORSHIP", "CLEARANCE", "SALARY", "RELOCATION", "NOTICE_PERIOD", "CONTACT", "LINK", "EDUCATION"];

export function questionKey(q: string, category: AnswerCategory): string {
  if (category === "SKILL_EXPERIENCE") return `${category}:${extractSkills(q).sort().join("+") || norm(q).slice(0, 60)}`;
  if (category === "CONTACT" || category === "LINK") return `${category}:${norm(q).replace(/\b(please|your|enter|provide|what is|what's)\b/g, "").trim()}`;
  return REUSABLE.includes(category) ? category : `${category}:${norm(q).slice(0, 80)}`;
}

const standing = (cat: AnswerCategory, p: Preferences): string | undefined =>
  ({ WORK_AUTHORIZATION: p.standingAnswers.workAuthorization, SPONSORSHIP: p.standingAnswers.sponsorship, SALARY: p.standingAnswers.salaryExpectation, RELOCATION: p.standingAnswers.relocation, NOTICE_PERIOD: p.standingAnswers.noticePeriod } as Partial<Record<AnswerCategory, string | undefined>>)[cat];

function profileAnswer(cat: AnswerCategory, q: string, profile: Profile): { answer: string; factIds: string[] } | null {
  const l = q.toLowerCase();
  if (cat === "CONTACT") {
    const [first, ...rest] = profile.fullName.split(" ");
    if (/first name/.test(l)) return { answer: first, factIds: [] };
    if (/last name|surname|family name/.test(l)) return rest.length ? { answer: rest.join(" "), factIds: [] } : null;
    if (/full name|^name/.test(l)) return { answer: profile.fullName, factIds: [] };
    if (/e-?mail/.test(l) && profile.email) return { answer: profile.email, factIds: [] };
    if (/phone|mobile/.test(l) && profile.phone) return { answer: profile.phone, factIds: [] };
    if (/city|location|based|address/.test(l) && profile.location) return { answer: profile.location, factIds: [] };
    return null;
  }
  if (cat === "LINK") {
    const want = /linkedin/.test(l) ? "linkedin" : /github/.test(l) ? "github" : null;
    const link = want ? profile.links.find((x) => x.url.includes(want)) : profile.links[0];
    return link ? { answer: link.url, factIds: [] } : null;
  }
  if (cat === "EDUCATION") {
    const e = verifiedEntries(profile).find((x) => x.type === "EDUCATION");
    return e ? { answer: `${e.title}, ${e.org}${e.end ? ` (${e.end})` : ""}`, factIds: [] } : null;
  }
  if (cat === "SKILL_EXPERIENCE") {
    const skills = extractSkills(q).map((s) => canonicalSkill(s) ?? s);
    if (skills.length === 0) return null;
    const ev = skills.map((s) => ({ s, e: evidenceFor(s, profile) }));
    if (ev.every((x) => x.e && x.e.strength !== "LISTED_ONLY")) {
      const facts = ev.flatMap((x) => x.e!.facts);
      return { answer: `Yes. ${facts[0].text}`, factIds: facts.map((f) => f.id) };
    }
    return null; // no verified evidence: never answer "yes", and never answer "no" for the user either
  }
  return null;
}

export function draftFor(cat: AnswerCategory, q: string, profile: Profile): string | null {
  if (cat === "FREE_TEXT" && /why/i.test(q)) return "Draft needed from you: explain your specific reason for this employer and role. (Not generated, because it requires your own judgement.)";
  void profile;
  return null;
}

export async function answerQuestions(ctx: Ctx, applicationId: string, questions: { text: string; required?: boolean }[]): Promise<Answer[]> {
  const profile = await ctx.store.get("profile", "profile");
  const prefs = await ctx.store.get("preferences", "prefs");
  if (!profile || !prefs) throw new Error("Profile and preferences are required");
  const all = await ctx.store.list("answers");
  const out: Answer[] = [];
  for (const q of questions) {
    const category = classifyQuestion(q.text);
    const key = questionKey(q.text, category);
    const now = ctx.now().toISOString();
    const id = `ans_${applicationId.slice(4)}_${Buffer.from(key).toString("hex").slice(0, 24)}`;
    const existing = all.find((a) => a.id === id);
    if (existing && existing.source === "USER") {
      out.push(existing);
      continue;
    }
    let ans: Pick<Answer, "answer" | "source" | "factIds" | "status" | "reusedFrom" | "draft">;
    const stand = standing(category, prefs);
    const fromProfile = !SENSITIVE.includes(category) ? profileAnswer(category, q.text, profile) : null;
    const prior = REUSABLE.includes(category) || category === "SKILL_EXPERIENCE"
      ? all.filter((a) => a.applicationId !== applicationId && a.key === key && a.source === "USER" && a.answer).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      : undefined;
    if (stand) ans = { answer: stand, source: "PREFERENCE", factIds: [], status: "ANSWERED", reusedFrom: null, draft: null };
    else if (fromProfile) ans = { answer: fromProfile.answer, source: "PROFILE", factIds: fromProfile.factIds, status: "ANSWERED", reusedFrom: null, draft: null };
    else if (prior && !SENSITIVE.includes(category)) ans = { answer: prior.answer, source: "USER", factIds: prior.factIds, status: "ANSWERED", reusedFrom: prior.id, draft: null };
    else if (prior && ["WORK_AUTHORIZATION", "SPONSORSHIP", "CLEARANCE", "SALARY", "RELOCATION", "NOTICE_PERIOD"].includes(category)) {
      // Reuse your own earlier equivalent answer, but surface it for confirmation rather than silently sending it.
      ans = { answer: null, source: "NONE", factIds: [], status: "NEEDS_USER", reusedFrom: prior.id, draft: prior.answer };
    } else ans = { answer: null, source: "NONE", factIds: [], status: "NEEDS_USER", reusedFrom: null, draft: draftFor(category, q.text, profile) };
    const rec: Answer = { id, applicationId, key, question: q.text.slice(0, 500), category, required: q.required ?? true, updatedAt: now, ...ans };
    await ctx.store.put("answers", rec);
    out.push(rec);
  }
  return out;
}

export async function saveUserAnswer(ctx: Ctx, answerId: string, text: string): Promise<Answer> {
  const a = await ctx.store.get("answers", answerId);
  if (!a) throw new Error("Answer not found");
  const next: Answer = { ...a, answer: text.trim(), status: text.trim() ? "ANSWERED" : "NEEDS_USER", source: "USER", updatedAt: ctx.now().toISOString() };
  await ctx.store.put("answers", next);
  return next;
}

/** The question set prepared for every application unless the employer's own form is pasted in. */
export const STANDARD_QUESTIONS = [
  "Are you legally authorized to work in the country where this role is based?",
  "Will you now or in the future require visa sponsorship?",
  "What are your salary expectations?",
  "Are you willing to relocate?",
  "What is your notice period / earliest start date?",
  "LinkedIn profile URL",
  "Email address",
  "Phone number",
];

export function missingMandatory(answers: Answer[]): Answer[] {
  return answers.filter((a) => a.required && (a.status !== "ANSWERED" || !a.answer?.trim()));
}

void newId;
