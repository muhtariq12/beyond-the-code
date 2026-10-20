import type { Preferences } from "./types";
import { DEFAULT_FX_TO_AED } from "./jobs/salary";

export function defaultPreferences(): Preferences {
  return {
    targetRoles: [
      "AI Engineer", "Applied AI Engineer", "Generative AI Engineer", "LLM Engineer",
      "AI Agent Engineer", "AI Product Engineer", "Software Engineer",
    ],
    minSalaryAedMonthly: 10000,
    fxRatesToAed: DEFAULT_FX_TO_AED,
    fxAsOf: "2026-01-01 (approximate; edit in Settings)",
    relocationEnabled: false,
    employmentTypes: ["FULL_TIME"],
    maxSeniority: "SENIOR",
    yearsTolerance: 2,
    candidateYearsOverride: null,
    workAuthorization: "UNKNOWN",
    standingAnswers: {},
    weights: { technical: 0.35, evidence: 0.25, seniority: 0.15, compensation: 0.15, product: 0.1 },
    thresholds: { apply: 70, review: 50 },
    autoGenerateCvMinScore: 60,
    notifyMinScore: 75,
    schedule: { ingestMinutes: 360, processMinutes: 15, reconcileMinutes: 720, dailySummaryHourUtc: 4 },
    authorizedSubmission: {},
  };
}
