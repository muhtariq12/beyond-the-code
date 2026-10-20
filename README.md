# Personal Job Agent

A single-user job-search agent that discovers roles from permitted sources, screens them against your hard rules, scores them against your **verified** experience, generates a separately tailored and evidence-checked CV for each qualified job (PDF + DOCX), prepares a cover letter and application answers, and either submits through an explicitly authorised integration or hands you a complete package for the employer's own page.

It lives at `/agent`. The original essay site is unchanged at `/` (see the bottom of this file).

> **Truthfulness is enforced in code, not by prompting.** Every bullet in a generated CV cites verified fact IDs. A deterministic validator rejects any number, skill, title, outcome, employer or proper noun that is not in the cited evidence. LLM output (optional) is accepted only if it passes that same validator.

## Status

Tested = covered by automated tests that run in CI (`npm test`, 112 tests) or the browser smoke test (`npm run e2e`).

| Area | State |
| --- | --- |
| CV import (PDF/DOCX/TXT/MD) → fact registry, verification workflow, issue detection (e.g. overlapping dates) | Implemented, tested. Parser verified against a real CV layout |
| Connectors: Greenhouse, Lever, Ashby (published feeds), pasted jobs, alert-email parsing | Implemented, tested against fixtures shaped like the documented payloads. **Not yet run against live boards** (the build sandbox blocks those hosts); first real sync is the first live check |
| Normalisation, dedupe (source ID / canonical URL / fingerprint), salary & location normalisation | Implemented, tested |
| Stage A hard filters + Stage B scoring (configurable weights, evidence-weighted) | Implemented, tested |
| Per-job tailored CV: selection, ordering, validation, ATS checks, change summary, PDF + DOCX, immutable versions, approval | Implemented, tested (real PDF text extraction, real DOCX XML inspection) |
| LLM-assisted rewording (Anthropic / OpenAI-compatible) | Implemented behind the validator; tested with scripted fake providers only. **Never exercised with a real API key** |
| Cover letters, application questions (never guesses sensitive answers) | Implemented, tested. Letters are deterministic templates over verified facts |
| Capability registry, preflight, idempotent submission engine, retries, failure states, audit log | Implemented, tested against an in-memory sandbox employer |
| Greenhouse Job Board API submission adapter | Written from public docs, tested with mocked HTTP only. Off by default; needs an employer-issued key. **Unverified live** |
| Manual hand-off + "I applied myself" attestation (recorded as self-reported, never as provider-confirmed) | Implemented, tested |
| Dashboard (all 8 sections), CV Studio compare/preview/claims/ATS/edit/regenerate/approve | Implemented, browser-tested |
| Scheduler/worker, notifications with de-duplication, webhook | Implemented, tested |
| Auth (password + signed session), rate limiting, input validation, safe rendering, prompt-injection handling, secret redaction | Implemented, tested |
| Postgres schema + Row Level Security + immutability triggers | Implemented and tested on real Postgres (PGlite), two-user isolation included. **The app does not use it yet** (see below) |
| Supabase as the live datastore, Supabase Auth, Storage bucket | **Not wired.** The app runs on a local permission-restricted file store with password auth |
| Reading your inbox for interview invitations / rejections | **Not implemented.** You record outcomes; no mailbox access is requested |
| LinkedIn and UAE job boards | **Not connected** by design (no scraping/automation). Use pasted jobs or forwarded alert emails |

## Quick start

Requires Node 20+.

```bash
npm install
cp .env.example .env.local     # set AGENT_ACCESS_PASSWORD and AGENT_SESSION_SECRET
npm run dev                    # http://localhost:3000/agent
```

1. **Settings → Profile & facts → Import CV.** Your file is stored unchanged. Everything parsed from it starts *unverified*.
2. Review the items (and any "please confirm" questions), then **Verify**. Only verified facts can appear in a CV.
3. **Sources → Add a published job board** (Greenhouse token, Lever slug or Ashby name), or paste a posting / alert email in **Discover Jobs**.
4. Run the pipeline (Overview) or `npm run worker`. Qualified jobs get a tailored CV, cover letter and prepared answers, then wait in **CV Studio** for your review.
5. Approve the CV, approve the application, answer anything marked *needs you*, then submit through the hand-off package (or an authorised integration if you set one up).

Try it without your data: `AGENT_DATA_DIR=./data-demo npm run seed:demo` loads a clearly fictional candidate and employers.

Your real data lives in `data/` (git-ignored; files are mode 0600/0700). Do not commit it.

## How the rules are applied

**Stage A (hard eligibility)** records PASS / FAIL / UNKNOWN with a reason per check: availability, duplicate application, salary, UAE or permitted-remote geography, employment type, seniority, years required, required degree, work authorisation / sponsorship / citizenship / clearance, mandatory-skill coverage, and posting content safety. UNKNOWN never becomes PASS or FAIL: unknown salary stays "UNKNOWN", a total-compensation figure is not treated as base, and any UNKNOWN caps the recommendation at *Review*.

**Salary** is normalised to AED per month (hourly/daily/weekly/monthly/annual; currency via editable reference rates in Settings, which are approximate). A missing currency or pay period is not guessed.

**Stage B (relevance)** uses your configurable weights (default 35 / 25 / 15 / 15 / 10). A skill shown in employment earns full credit, in a project 0.7, and only in a skills list 0.35, so keyword overlap alone is not qualification. Any hard failure forces the score to 0.

**Capability states** per provider: `DISCOVERY_ONLY`, `PREPARE_AND_HANDOFF` (default), `AUTHORIZED_API_SUBMISSION`, `DISABLED`. Automatic submission requires all of: no kill switch, a recorded authorisation basis in Settings, the provider credential in the environment, and an implemented adapter. Submission then requires an approved, fully-validated CV, complete mandatory answers, a still-open role, no duplicate, and rules still satisfied. SUBMITTED is set only after a confirmation reference. A timeout is "unconfirmed" (needs attention), never an automatic re-send.

## Security

- Password + HMAC-signed, HttpOnly, SameSite=Strict session cookie; middleware guards `/agent` and `/api/agent`; same-origin check on writes; per-route rate limits; login throttling.
- Zod validation on every route; file uploads validated by size and magic bytes; documents served with `nosniff`, `attachment`, a sandbox CSP and `no-store`.
- Job text, emails and pasted content are untrusted: markup is stripped at ingestion, shown only as plain text, instruction-like lines are excluded from requirement parsing and flagged, and the LLM interface has **no tools** (no DB, shell, network or submission access). Prompts wrap external text as quoted data, and outputs are schema- and evidence-validated.
- Audit log and application events are append-only; CV versions and stored documents are immutable (write-once blobs).
- Secrets are read only from the environment; logs, audit entries, notifications and generated files are scrubbed (tested).

## Tests

```bash
npm run check      # lint + typecheck + 112 tests
npm run build && npm run e2e   # real browser: login, every page, CV approval, PDF/DOCX download, hand-off, attestation, mobile width
```

| File | Covers |
| --- | --- |
| `tests/jobs.test.ts` | salary/currency/period normalisation, unknown salary, remote eligibility, dedupe, connectors, 429 backoff, HTML sanitising |
| `tests/match.test.ts` | every hard filter, score maths and weights, evidence vs keywords, prompt injection |
| `tests/cv.test.ts` | truthful generation, invented-claim rejection, tamper detection, PDF/DOCX content, versioning, immutability, approval rules, cover letters |
| `tests/apply.test.ts` | question classification, never-guess rules, capability registry, preflight, idempotent submission, retries, failures, duplicate prevention, hand-off |
| `tests/pipeline.test.ts` | ingestion, closing stale jobs, repeatability, end-to-end slice, de-duplicated notifications, scheduling, no secrets in output |
| `tests/profile.test.ts` | CV parsing, verification carry-over, upload validation |
| `tests/security.test.ts`, `tests/api.test.ts` | auth, middleware, rate limits, validation, cross-origin blocks, document headers, storage permissions |
| `tests/rls.test.ts` | Postgres RLS isolation, append-only audit, frozen CV versions, duplicate-application and double-success constraints |

## Configuration

See `.env.example`. Required: `AGENT_ACCESS_PASSWORD`, `AGENT_SESSION_SECRET`. Optional: an LLM key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`), `NOTIFY_WEBHOOK_URL`, `CRON_SECRET`, `GREENHOUSE_JOB_BOARD_API_KEY`, `AGENT_DISABLE_SUBMISSION`.

**Credentials and permissions still needed from you:** an LLM key if you want reworded bullets; employer-issued API keys plus documented permission for any provider you want auto-submission on; a webhook URL for push alerts; the board tokens of the companies you want to follow.

**Scheduling:** `npm run worker` (long-running process) or call `GET/POST /api/agent/cron` with `Authorization: Bearer $CRON_SECRET` from any scheduler. The file store is local, so run on a machine with a persistent disk (not a serverless filesystem).

## Known limitations

- PDFs use Helvetica (WinAnsi). Non-Latin characters are transliterated or replaced; embed a Unicode font before using names in other scripts.
- Deterministic tailoring selects and orders your own wording; it does not rewrite. Rewording needs an LLM and is validated bullet-by-bullet.
- "Original CV" in the comparison is your master content re-rendered from verified facts, plus a download of the unmodified upload.
- Custom employer questions are not fetched from ATS forms; paste them on the application page.
- Exchange rates are static and approximate. Postings that state pay in a currency or period the parser cannot read stay UNKNOWN.
- Single-process locking: do not run two workers against one data directory.

## Layout

```
app/agent/        dashboard pages (route group (app) holds the authenticated shell)
app/api/agent/    JSON routes, document download, cron
components/agent/ UI building blocks and client forms
lib/agent/        domain logic: connectors, jobs, matching, profile, cv, apply, ops, llm, store
supabase/         migration with RLS, constraints and immutability triggers
scripts/          worker, demo seed, browser smoke test
tests/            vitest suites and fixtures (fictional candidate and employers)
```

## Beyond the Code (essay at `/`)

An interactive essay on a simple idea: AI has made writing software much faster, but making all the pieces work together, and solving the right problem, is still hard.

It is written from my experience building business applications, integrating systems, and working with AI coding agents. The article is built to teach one thing well, using small interactive pieces instead of long explanation:

- **A form, a complicated system.** Tap a field in a tenant registration form to see which systems it depends on.
- **Follow the data.** An SVG system diagram. Select a component to see its role, how it fails, and how far the failure travels.
- **What does "working" mean?** A five-rung ladder from "it compiles" to "it delivers measurable value", showing what each rung proves and what it does not.
- **A hypothetical investigation.** A made-up tenant-to-unit mapping bug, walked through as symptom, root causes, evidence, smallest test and success criterion.

## About the content

The projects mentioned (a real-estate/ERP integration, Sanad, Tareeeq) are works in progress, and the essay says so. The tenant-mapping scenario is hypothetical and labelled as such. The page makes no claims about deployments, users or measured results.

## Stack

- Next.js 15 (App Router) and TypeScript, statically rendered
- Tailwind CSS v4 with a few custom styles
- Hand-written SVG and small React client components, no chart or animation libraries
- Geist and Fraunces fonts
- No backend, database, analytics, API keys or environment variables

## Local setup

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

Checks:

```bash
npm run lint
npm run typecheck
npm run build
```

## Deploy on Vercel

1. Push this repository to GitHub.
2. In Vercel, choose **Add New... > Project** and import the repository.
3. Keep the detected Next.js settings and deploy. No environment variables are needed.

Or with the CLI: `npx vercel` for a preview, `npx vercel --prod` for production.

On Vercel, the Open Graph image URL is built from `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets automatically.

## Structure

```
app/            page, layout, metadata, icon, Open Graph image
components/     TopNav (progress + navigation) and the four interactive figures
lib/            diagram data and layouts, section list
```
