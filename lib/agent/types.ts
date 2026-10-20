import { z } from "zod";

/* ---------- shared ---------- */

export const SourceRef = z.object({
  doc: z.string(),
  ref: z.string(),
  quote: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

/* ---------- profile (the verified fact registry) ---------- */

export const Fact = z.object({
  id: z.string(),
  entryId: z.string().nullable(),
  text: z.string().min(1).max(700),
  skills: z.array(z.string()),
  metrics: z.array(z.string()),
  source: SourceRef,
  verified: z.boolean(),
  verifiedAt: z.string().nullable(),
});
export type Fact = z.infer<typeof Fact>;

export const EntryType = z.enum(["EMPLOYMENT", "PROJECT", "EDUCATION", "CERTIFICATION", "PUBLICATION", "AWARD"]);
export type EntryType = z.infer<typeof EntryType>;

export const Entry = z.object({
  id: z.string(),
  type: EntryType,
  title: z.string(),
  org: z.string(),
  location: z.string().nullable(),
  start: z.string().nullable(), // YYYY or YYYY-MM
  end: z.string().nullable(),
  current: z.boolean(),
  source: SourceRef,
  verified: z.boolean(),
  order: z.number(),
});
export type Entry = z.infer<typeof Entry>;

export const SkillItem = z.object({
  name: z.string(), // canonical
  label: z.string(), // as written in the CV
  group: z.string(), // category heading as written in the CV
  source: SourceRef,
  verified: z.boolean(),
});
export type SkillItem = z.infer<typeof SkillItem>;

export const Profile = z.object({
  fullName: z.string(),
  headline: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  entries: z.array(Entry),
  facts: z.array(Fact),
  skills: z.array(SkillItem),
  originalCvDocId: z.string().nullable(),
  importedAt: z.string(),
  updatedAt: z.string(),
});
export type Profile = z.infer<typeof Profile>;

/* ---------- preferences ---------- */

export const Preferences = z.object({
  targetRoles: z.array(z.string()),
  minSalaryAedMonthly: z.number().positive(),
  fxRatesToAed: z.record(z.string(), z.number().positive()),
  fxAsOf: z.string(),
  relocationEnabled: z.boolean(),
  employmentTypes: z.array(z.string()),
  maxSeniority: z.enum(["INTERN", "JUNIOR", "MID", "SENIOR", "LEAD", "PRINCIPAL"]),
  yearsTolerance: z.number().min(0),
  candidateYearsOverride: z.number().min(0).nullable(),
  workAuthorization: z.enum(["UNKNOWN", "AUTHORIZED", "NEEDS_SPONSORSHIP"]),
  standingAnswers: z.object({
    salaryExpectation: z.string().optional(),
    relocation: z.string().optional(),
    noticePeriod: z.string().optional(),
    workAuthorization: z.string().optional(),
    sponsorship: z.string().optional(),
  }),
  weights: z.object({
    technical: z.number().min(0),
    evidence: z.number().min(0),
    seniority: z.number().min(0),
    compensation: z.number().min(0),
    product: z.number().min(0),
  }),
  thresholds: z.object({ apply: z.number(), review: z.number() }),
  autoGenerateCvMinScore: z.number(),
  notifyMinScore: z.number(),
  schedule: z.object({
    ingestMinutes: z.number().min(15),
    processMinutes: z.number().min(5),
    reconcileMinutes: z.number().min(15),
    dailySummaryHourUtc: z.number().min(0).max(23),
  }),
  authorizedSubmission: z.record(
    z.string(),
    z.object({ enabled: z.boolean(), basis: z.string() }),
  ),
});
export type Preferences = z.infer<typeof Preferences>;

/* ---------- jobs ---------- */

export const Salary = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().nullable(),
  period: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "UNKNOWN"]),
  basis: z.enum(["BASE", "TOTAL", "UNKNOWN"]),
  raw: z.string(),
});
export type Salary = z.infer<typeof Salary>;

export const RemoteMode = z.enum(["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"]);
export type RemoteMode = z.infer<typeof RemoteMode>;

export const Job = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceType: z.string(),
  externalId: z.string().nullable(),
  url: z.string(),
  canonicalUrl: z.string(),
  applyUrl: z.string().nullable(),
  employer: z.string(),
  title: z.string(),
  description: z.string(),
  location: z.string(),
  remote: RemoteMode,
  remoteRegions: z.array(z.string()),
  salary: Salary.nullable(),
  employmentType: z.string(),
  experienceYearsMin: z.number().nullable(),
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  requiredDegree: z.enum(["NONE", "BACHELOR", "MASTER", "PHD"]),
  postedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  availability: z.enum(["OPEN", "CLOSED", "UNKNOWN"]),
  retrievedAt: z.string(),
  fingerprint: z.string(),
  alsoSeen: z.array(z.object({ sourceId: z.string(), url: z.string() })),
  injectionSignals: z.array(z.string()),
  descriptionMissing: z.boolean(),
});
export type Job = z.infer<typeof Job>;

/* ---------- matching ---------- */

export const CheckResult = z.enum(["PASS", "FAIL", "UNKNOWN"]);
export const Check = z.object({
  id: z.string(),
  label: z.string(),
  result: CheckResult,
  reason: z.string(),
});
export type Check = z.infer<typeof Check>;

export const Match = z.object({
  id: z.string(),
  jobId: z.string(),
  eligibility: z.enum(["ELIGIBLE", "UNCERTAIN", "INELIGIBLE"]),
  checks: z.array(Check),
  score: z.number().nullable(),
  breakdown: z.record(z.string(), z.number()),
  matched: z.array(
    z.object({
      requirement: z.string(),
      strength: z.enum(["DEMONSTRATED", "PROJECT_ONLY", "LISTED_ONLY"]),
      factIds: z.array(z.string()),
      evidence: z.array(z.string()),
    }),
  ),
  gaps: z.array(z.object({ requirement: z.string(), kind: z.enum(["MISSING", "WEAK"]) })),
  salaryConfidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
  salaryAedMonthly: z.object({ min: z.number().nullable(), max: z.number().nullable() }).nullable(),
  geoEligibility: z.enum(["CONFIRMED", "LIKELY", "UNKNOWN", "NOT_ELIGIBLE"]),
  cvEmphasis: z.array(z.string()),
  recommendation: z.enum(["APPLY", "REVIEW", "SKIP"]),
  explanation: z.string(),
  computedAt: z.string(),
  profileUpdatedAt: z.string(),
});
export type Match = z.infer<typeof Match>;

/* ---------- CV ---------- */

export const CvBullet = z.object({ text: z.string().min(1), factIds: z.array(z.string()).min(1) });
export const CvSection = z.object({
  entryId: z.string(),
  title: z.string(),
  org: z.string(),
  location: z.string().nullable(),
  dates: z.string(),
  tech: z.array(z.string()).optional(),
  bullets: z.array(CvBullet),
});
export const CvDoc = z.object({
  header: z.object({
    name: z.string(),
    contact: z.array(z.string()),
  }),
  summary: z.object({ text: z.string(), factIds: z.array(z.string()) }),
  skills: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
  experience: z.array(CvSection),
  projects: z.array(CvSection),
  education: z.array(CvSection),
  certifications: z.array(CvSection),
  publications: z.array(CvSection),
});
export type CvDoc = z.infer<typeof CvDoc>;
export type CvSection = z.infer<typeof CvSection>;

export const ClaimCheck = z.object({
  location: z.string(),
  text: z.string(),
  status: z.enum(["VERIFIED", "UNSUPPORTED"]),
  factIds: z.array(z.string()),
  problem: z.string().nullable(),
});
export type ClaimCheck = z.infer<typeof ClaimCheck>;

export const Validation = z.object({
  pass: z.boolean(),
  claims: z.array(ClaimCheck),
  violations: z.array(z.string()),
});
export type Validation = z.infer<typeof Validation>;

export const AtsCheck = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["PASS", "WARN", "FAIL"]),
  detail: z.string(),
});
export type AtsCheck = z.infer<typeof AtsCheck>;

export const CvVersion = z.object({
  id: z.string(),
  jobId: z.string(),
  version: z.number().int().positive(),
  parentId: z.string().nullable(),
  origin: z.enum(["GENERATED", "REGENERATED", "MANUAL_EDIT"]),
  generator: z.string(),
  status: z.enum(["DRAFT", "APPROVED", "REJECTED", "SUPERSEDED"]),
  doc: CvDoc,
  contentHash: z.string(),
  validation: Validation,
  ats: z.array(AtsCheck),
  changeSummary: z.array(z.string()),
  questions: z.array(z.string()),
  emphasis: z.array(z.string()),
  matchScore: z.number().nullable(),
  pdfDocId: z.string().nullable(),
  docxDocId: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  notes: z.string().nullable(),
});
export type CvVersion = z.infer<typeof CvVersion>;

export const StoredDocument = z.object({
  id: z.string(),
  kind: z.enum(["ORIGINAL_CV", "CV_PDF", "CV_DOCX", "COVER_LETTER_PDF", "COVER_LETTER_DOCX"]),
  filename: z.string(),
  mime: z.string(),
  bytes: z.number(),
  sha256: z.string(),
  jobId: z.string().nullable(),
  cvVersionId: z.string().nullable(),
  createdAt: z.string(),
});
export type StoredDocument = z.infer<typeof StoredDocument>;

export const CoverLetter = z.object({
  id: z.string(),
  jobId: z.string(),
  text: z.string(),
  factIds: z.array(z.string()),
  validation: Validation,
  pdfDocId: z.string().nullable(),
  docxDocId: z.string().nullable(),
  createdAt: z.string(),
});
export type CoverLetter = z.infer<typeof CoverLetter>;

/* ---------- applications ---------- */

export const APPLICATION_STATUSES = [
  "DISCOVERED",
  "SCREENED",
  "QUALIFIED",
  "CV_GENERATED",
  "READY_FOR_REVIEW",
  "APPROVED",
  "SUBMISSION_PENDING",
  "SUBMITTED",
  "SUBMISSION_FAILED",
  "NEEDS_ATTENTION",
  "INTERVIEW",
  "REJECTED",
  "WITHDRAWN",
  "OFFER",
] as const;
export const ApplicationStatus = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const Application = z.object({
  id: z.string(),
  jobId: z.string(),
  fingerprint: z.string(),
  status: ApplicationStatus,
  cvVersionId: z.string().nullable(),
  coverLetterId: z.string().nullable(),
  provider: z.string(),
  confirmation: z
    .object({
      kind: z.enum(["PROVIDER", "USER_ATTESTED"]),
      reference: z.string().nullable(),
      at: z.string(),
    })
    .nullable(),
  followUpAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Application = z.infer<typeof Application>;

export const AnswerCategory = z.enum([
  "WORK_AUTHORIZATION",
  "SPONSORSHIP",
  "CLEARANCE",
  "DEMOGRAPHIC",
  "SALARY",
  "RELOCATION",
  "YEARS_EXPERIENCE",
  "LEGAL",
  "NOTICE_PERIOD",
  "CONTACT",
  "LINK",
  "EDUCATION",
  "SKILL_EXPERIENCE",
  "FREE_TEXT",
]);
export type AnswerCategory = z.infer<typeof AnswerCategory>;

export const Answer = z.object({
  id: z.string(),
  applicationId: z.string(),
  key: z.string(),
  question: z.string(),
  category: AnswerCategory,
  required: z.boolean(),
  status: z.enum(["ANSWERED", "NEEDS_USER"]),
  answer: z.string().nullable(),
  source: z.enum(["PROFILE", "PREFERENCE", "USER", "NONE"]),
  factIds: z.array(z.string()),
  reusedFrom: z.string().nullable(),
  draft: z.string().nullable(),
  updatedAt: z.string(),
});
export type Answer = z.infer<typeof Answer>;

export const SubmissionAttempt = z.object({
  id: z.string(),
  applicationId: z.string(),
  idempotencyKey: z.string(),
  attemptNo: z.number(),
  provider: z.string(),
  outcome: z.enum(["PENDING", "SUCCEEDED", "FAILED", "UNKNOWN"]),
  retriable: z.boolean(),
  providerReference: z.string().nullable(),
  responseMeta: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type SubmissionAttempt = z.infer<typeof SubmissionAttempt>;

export const AppEvent = z.object({
  id: z.string(),
  applicationId: z.string().nullable(),
  type: z.string(),
  actor: z.enum(["SYSTEM", "USER", "PROVIDER"]),
  from: z.string().nullable(),
  to: z.string().nullable(),
  detail: z.string(),
  at: z.string(),
});
export type AppEvent = z.infer<typeof AppEvent>;

/* ---------- sources & misc ---------- */

export const SourceType = z.enum(["greenhouse", "lever", "ashby", "manual", "email", "sandbox"]);
export type SourceType = z.infer<typeof SourceType>;

export const Source = z.object({
  id: z.string(),
  type: SourceType,
  name: z.string(),
  token: z.string().nullable(),
  enabled: z.boolean(),
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  lastJobCount: z.number().nullable(),
  retryAfter: z.string().nullable(),
  createdAt: z.string(),
});
export type Source = z.infer<typeof Source>;

export const Notification = z.object({
  id: z.string(),
  dedupeKey: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  entityId: z.string().nullable(),
  read: z.boolean(),
  deliveredWebhook: z.boolean(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof Notification>;

export const AuditEntry = z.object({
  id: z.string(),
  action: z.string(),
  actor: z.string(),
  entity: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
