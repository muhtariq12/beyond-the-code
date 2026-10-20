import type { Job } from "../types";

export type DedupeReason = "SOURCE_ID" | "CANONICAL_URL" | "FINGERPRINT";

export function findDuplicate(job: Job, existing: Job[]): { match: Job; reason: DedupeReason } | null {
  for (const e of existing) {
    if (e.id === job.id) return { match: e, reason: "SOURCE_ID" };
    if (e.sourceId === job.sourceId && job.externalId && e.externalId === job.externalId) return { match: e, reason: "SOURCE_ID" };
  }
  for (const e of existing) if (e.canonicalUrl === job.canonicalUrl) return { match: e, reason: "CANONICAL_URL" };
  for (const e of existing) if (e.fingerprint === job.fingerprint) return { match: e, reason: "FINGERPRINT" };
  return null;
}

/**
 * Merge `incoming` into `existing` (same posting seen again or on another source).
 * Keeps the record id stable, prefers the richer description, remembers where else it appeared.
 */
export function mergeJobs(existing: Job, incoming: Job): Job {
  const sameSource = existing.sourceId === incoming.sourceId;
  const richer = incoming.description.length > existing.description.length * 1.1 && sameSource;
  const alsoSeen = [...existing.alsoSeen];
  if (!sameSource && !alsoSeen.some((a) => a.sourceId === incoming.sourceId) && incoming.canonicalUrl !== existing.canonicalUrl) {
    alsoSeen.push({ sourceId: incoming.sourceId, url: incoming.url });
  }
  const base = sameSource ? incoming : existing;
  return {
    ...base,
    id: existing.id,
    alsoSeen,
    description: richer || sameSource ? incoming.description : existing.description,
    salary: base.salary ?? incoming.salary ?? existing.salary,
    availability: sameSource ? incoming.availability : existing.availability,
    retrievedAt: incoming.retrievedAt,
    postedAt: existing.postedAt ?? incoming.postedAt,
  };
}
