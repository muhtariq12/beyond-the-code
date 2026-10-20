-- Personal job-search agent: schema, constraints, immutability triggers and Row Level Security.
-- Every row belongs to one auth user (owner_id). Nothing is readable without an authenticated session.

create table candidate_profiles (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null,
  headline text,
  email text,
  phone text,
  location text,
  links jsonb not null default '[]',
  original_cv_document_id text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profile_entries (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('EMPLOYMENT','PROJECT','EDUCATION','CERTIFICATION','PUBLICATION','AWARD')),
  title text not null,
  org text not null default '',
  location text,
  start_date text,
  end_date text,
  is_current boolean not null default false,
  source jsonb not null,
  verified boolean not null default false,
  sort_order int not null default 0
);

-- Verified fact registry: every CV claim must cite one of these rows.
create table verified_facts (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_id text references profile_entries(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 700),
  skills text[] not null default '{}',
  metrics text[] not null default '{}',
  source jsonb not null,
  verified boolean not null default false,
  verified_at timestamptz
);

create table profile_skills (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  label text not null,
  grp text not null,
  source jsonb not null,
  verified boolean not null default false
);

create table master_cvs (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id text not null,
  filename text not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);

create table job_sources (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('greenhouse','lever','ashby','manual','email','sandbox')),
  name text not null,
  token text check (token is null or token ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  enabled boolean not null default true,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_job_count int,
  retry_after timestamptz,
  created_at timestamptz not null default now()
);

create table jobs (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_id text not null references job_sources(id) on delete cascade,
  source_type text not null,
  external_id text,
  url text not null,
  canonical_url text not null,
  apply_url text,
  employer text not null,
  title text not null,
  description text not null default '',
  location text not null default '',
  remote text not null check (remote in ('REMOTE','HYBRID','ONSITE','UNKNOWN')),
  remote_regions text[] not null default '{}',
  salary jsonb,
  employment_type text not null default 'UNKNOWN',
  experience_years_min int,
  required_skills text[] not null default '{}',
  preferred_skills text[] not null default '{}',
  required_degree text not null default 'NONE',
  posted_at timestamptz,
  expires_at timestamptz,
  availability text not null check (availability in ('OPEN','CLOSED','UNKNOWN')),
  retrieved_at timestamptz not null,
  fingerprint text not null,
  also_seen jsonb not null default '[]',
  injection_signals text[] not null default '{}',
  description_missing boolean not null default false,
  unique (owner_id, canonical_url)
);
create index jobs_fingerprint_idx on jobs (owner_id, fingerprint);
create unique index jobs_source_external_idx on jobs (owner_id, source_id, external_id) where external_id is not null;

create table job_matches (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  eligibility text not null check (eligibility in ('ELIGIBLE','UNCERTAIN','INELIGIBLE')),
  score int,
  recommendation text not null check (recommendation in ('APPLY','REVIEW','SKIP')),
  data jsonb not null,           -- checks, breakdown, matched evidence, gaps, salary/geo confidence, explanation
  computed_at timestamptz not null,
  unique (owner_id, job_id)
);

create table generated_documents (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ORIGINAL_CV','CV_PDF','CV_DOCX','COVER_LETTER_PDF','COVER_LETTER_DOCX')),
  filename text not null check (filename ~ '^[A-Za-z0-9._-]+$'),
  mime text not null,
  bytes int not null check (bytes > 0 and bytes <= 5242880),
  sha256 text not null,
  job_id text references jobs(id) on delete set null,
  cv_version_id text,
  storage_path text not null,   -- private bucket path: <owner_id>/<id>
  created_at timestamptz not null default now()
);

create table cv_versions (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  version int not null check (version > 0),
  parent_id text references cv_versions(id),
  origin text not null check (origin in ('GENERATED','REGENERATED','MANUAL_EDIT')),
  generator text not null,
  status text not null check (status in ('DRAFT','APPROVED','REJECTED','SUPERSEDED')),
  content_hash text not null,
  doc jsonb not null,
  validation jsonb not null,
  ats jsonb not null,
  change_summary text[] not null default '{}',
  questions text[] not null default '{}',
  emphasis text[] not null default '{}',
  match_score int,
  pdf_document_id text references generated_documents(id),
  docx_document_id text references generated_documents(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  notes text,
  unique (owner_id, job_id, version),
  -- a version whose claims are not all verified can never be approved
  constraint approved_requires_validation check (status <> 'APPROVED' or (validation ->> 'pass')::boolean)
);

create table cover_letters (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  text text not null,
  fact_ids text[] not null default '{}',
  validation jsonb not null,
  pdf_document_id text references generated_documents(id),
  docx_document_id text references generated_documents(id),
  created_at timestamptz not null default now()
);

create table applications (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  fingerprint text not null,
  status text not null check (status in ('DISCOVERED','SCREENED','QUALIFIED','CV_GENERATED','READY_FOR_REVIEW','APPROVED','SUBMISSION_PENDING','SUBMITTED','SUBMISSION_FAILED','NEEDS_ATTENTION','INTERVIEW','REJECTED','WITHDRAWN','OFFER')),
  cv_version_id text references cv_versions(id),
  cover_letter_id text references cover_letters(id),
  provider text not null,
  confirmation jsonb,
  follow_up_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, job_id),
  -- SUBMITTED must carry a confirmation (provider reference or explicit user attestation)
  constraint submitted_has_confirmation check (status not in ('SUBMITTED','INTERVIEW','OFFER') or confirmation is not null)
);
-- Duplicate-application prevention enforced by the database, across sources, via the posting fingerprint.
create unique index applications_one_sent_per_posting on applications (owner_id, fingerprint)
  where status in ('SUBMISSION_PENDING','SUBMITTED','INTERVIEW','OFFER');

create table application_answers (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id text not null,
  key text not null,
  question text not null,
  category text not null,
  required boolean not null default true,
  status text not null check (status in ('ANSWERED','NEEDS_USER')),
  answer text,
  source text not null check (source in ('PROFILE','PREFERENCE','USER','NONE')),
  fact_ids text[] not null default '{}',
  reused_from text,
  draft text,
  updated_at timestamptz not null default now(),
  check (status <> 'ANSWERED' or answer is not null)
);

create table submission_attempts (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id text not null references applications(id) on delete cascade,
  idempotency_key text not null,
  attempt_no int not null,
  provider text not null,
  outcome text not null check (outcome in ('PENDING','SUCCEEDED','FAILED','UNKNOWN')),
  retriable boolean not null default false,
  provider_reference text,
  response_meta jsonb not null default '{}',
  error text,
  started_at timestamptz not null,
  finished_at timestamptz,
  unique (owner_id, idempotency_key, attempt_no),
  constraint succeeded_has_reference check (outcome <> 'SUCCEEDED' or provider_reference is not null)
);
-- Idempotency: at most one confirmed success per idempotency key.
create unique index submission_one_success on submission_attempts (owner_id, idempotency_key) where outcome = 'SUCCEEDED';

create table application_events (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id text,
  type text not null,
  actor text not null check (actor in ('SYSTEM','USER','PROVIDER')),
  from_status text,
  to_status text,
  detail text not null default '',
  at timestamptz not null default now()
);

create table user_preferences (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table notifications (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dedupe_key text not null,
  type text not null,
  title text not null,
  body text not null,
  entity_id text,
  read boolean not null default false,
  delivered_webhook boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, dedupe_key)   -- the same event can never notify twice
);

create table audit_logs (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null,
  actor text not null,
  entity text,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);

/* ---------- immutability ---------- */

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only/write-once', tg_table_name using errcode = 'restrict_violation';
end $$;

create trigger audit_append_only before update or delete on audit_logs for each row execute function forbid_change();
create trigger events_append_only before update or delete on application_events for each row execute function forbid_change();
create trigger documents_write_once before update or delete on generated_documents for each row execute function forbid_change();

-- CV versions: content is frozen; only review status, notes and the attached document ids may change.
create function cv_versions_freeze() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'cv_versions cannot be deleted' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.owner_id, new.job_id, new.version, new.parent_id, new.origin, new.generator, new.content_hash, new.doc, new.validation, new.ats, new.change_summary, new.questions, new.emphasis, new.match_score, new.created_at)
     is distinct from
     (old.id, old.owner_id, old.job_id, old.version, old.parent_id, old.origin, old.generator, old.content_hash, old.doc, old.validation, old.ats, old.change_summary, old.questions, old.emphasis, old.match_score, old.created_at) then
    raise exception 'cv_versions content is immutable; create a new version' using errcode = 'restrict_violation';
  end if;
  if old.status = 'APPROVED' and new.status = 'DRAFT' then
    raise exception 'an approved CV cannot silently return to draft' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger cv_versions_freeze_trg before update or delete on cv_versions for each row execute function cv_versions_freeze();

/* ---------- Row Level Security ---------- */

revoke all on all tables in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'candidate_profiles','profile_entries','verified_facts','profile_skills','master_cvs','job_sources','jobs',
    'job_matches','generated_documents','cv_versions','cover_letters','applications','application_answers',
    'submission_attempts','application_events','user_preferences','notifications','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    if t in ('audit_logs','application_events','generated_documents') then
      -- append-only: owners may read and insert, never update or delete
      execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', t || '_select', t);
      execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())', t || '_insert', t);
      execute format('grant select, insert on public.%I to authenticated', t);
    else
      execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_owner', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

/* ---------- private document storage (Supabase only) ---------- */

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('private-docs', 'private-docs', false, 5242880,
            array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
    on conflict (id) do nothing;
    create policy private_docs_owner_read on storage.objects for select to authenticated
      using (bucket_id = 'private-docs' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy private_docs_owner_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'private-docs' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
