import { norm } from "../text";
import { isTechFact } from "../profile/facts";
import type { Fact, Job, Profile } from "../types";

const STOP = new Set("the a an and or of to in for with on at by from as is are be will you we our your this that these those it its their they have has had not but can may such into across over under about more than also using use used work working team teams role roles experience years year strong ability skills skill build building".split(" "));

export function jobTerms(job: Job): Set<string> {
  const t = norm(`${job.title}\n${job.description}`).split(" ").filter((w) => w.length > 3 && !STOP.has(w));
  return new Set(t);
}

/** Deterministic relevance of a verified fact to a job. Evidence-weighted; keyword overlap alone is capped. */
export function factRelevance(f: Fact, job: Job, profile: Profile, terms = jobTerms(job)): number {
  let s = 0;
  for (const sk of f.skills) {
    if (job.requiredSkills.includes(sk)) s += 3;
    else if (job.preferredSkills.includes(sk)) s += 1.5;
  }
  const words = new Set(norm(f.text).split(" "));
  let overlap = 0;
  for (const w of words) if (terms.has(w)) overlap++;
  s += Math.min(1.5, overlap * 0.1);
  if (f.metrics.length) s += 0.5;
  const entry = profile.entries.find((e) => e.id === f.entryId);
  if (entry?.type === "EMPLOYMENT") s += 0.5;
  return s;
}

export function rankFacts(facts: Fact[], job: Job, profile: Profile): Fact[] {
  const terms = jobTerms(job);
  return facts
    .filter((f) => !isTechFact(f))
    .map((f, i) => ({ f, s: factRelevance(f, job, profile, terms), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.f);
}
