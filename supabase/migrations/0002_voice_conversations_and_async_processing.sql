-- ============================================================================
-- ArogyaOS – AI Health Memory
-- Migration 0002 · voice conversations & asynchronous report processing
-- ----------------------------------------------------------------------------
-- Incremental changes on top of 0001. Existing architecture, foreign keys,
-- and Row Level Security policies are NOT modified. This migration only:
--   1. Adds  voice_conversations       (feature 5: Multilingual Voice Assistant)
--   2. Adds  report_processing_jobs    (async AI report pipeline)
--   3. Adds  medical_reports.processing_status
--   4. Adds  ai_insights.processing_time_ms, ai_insights.model_used
--   5. Adds  comments on every table and important column
--
-- Idempotent (safe to re-run in the SQL Editor): new tables/indexes use
-- IF NOT EXISTS, new columns use ADD COLUMN IF NOT EXISTS, and new RLS
-- policies are guarded with DROP POLICY IF EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. voice_conversations — Multilingual Voice Health Assistant
-- ----------------------------------------------------------------------------
create table if not exists public.voice_conversations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  language     text not null default 'en',
  user_message text not null,
  ai_response  text,
  created_at   timestamptz not null default now()
);

comment on table public.voice_conversations is
  'Transcript log of the Multilingual Voice Health Assistant. One row per spoken user turn and the assistant''s reply, tagged with the language used for the exchange.';
comment on column public.voice_conversations.language is
  'BCP-47 tag of the language the user spoke in for THIS exchange (e.g. hi, ta, mr) — overrides profiles.preferred_language when a session is language-switched.';
comment on column public.voice_conversations.user_message is
  'Transcript of what the user said (speech-to-text output), in the original language.';
comment on column public.voice_conversations.ai_response is
  'Assistant reply text. Null while the response is still being generated.';

create index if not exists idx_voice_conversations_user_created
  on public.voice_conversations (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. report_processing_jobs — asynchronous AI report pipeline
-- ----------------------------------------------------------------------------
create table if not exists public.report_processing_jobs (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references public.medical_reports (id) on delete cascade,
  processing_stage  text not null default 'extracting'
                    check (processing_stage in ('extracting', 'analyzing', 'complete')),
  processing_status text not null default 'pending'
                    check (processing_status in ('pending', 'running', 'completed', 'failed')),
  error_message     text,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  check (completed_at is null or processing_status in ('completed', 'failed'))
);

comment on table public.report_processing_jobs is
  'One job per report for the async pipeline (upload → extract → analyze → complete). Workers poll for pending jobs and advance processing_stage; medical_reports.processing_status mirrors the aggregate state.';
comment on column public.report_processing_jobs.processing_stage is
  'Current pipeline stage: extracting (OCR/parsing), analyzing (Grok AI), or complete.';
comment on column public.report_processing_jobs.processing_status is
  'Lifecycle status of the job: pending → running → completed | failed.';
comment on column public.report_processing_jobs.error_message is
  'Human-readable failure reason; populated when processing_status = failed.';
comment on column public.report_processing_jobs.started_at is
  'When a worker picked the job up (pending → running). Null while still queued.';
comment on column public.report_processing_jobs.completed_at is
  'When the job reached completed or failed. Null otherwise (see table check).';

create index if not exists idx_report_processing_jobs_report
  on public.report_processing_jobs (report_id, created_at);
create index if not exists idx_report_processing_jobs_queued
  on public.report_processing_jobs (created_at)
  where processing_status in ('pending', 'running');

-- ----------------------------------------------------------------------------
-- 3. medical_reports.processing_status
-- ----------------------------------------------------------------------------
alter table public.medical_reports
  add column if not exists processing_status text not null default 'uploaded'
  check (processing_status in ('uploaded', 'extracting', 'analyzing', 'completed', 'failed'));

comment on column public.medical_reports.processing_status is
  'Aggregate AI processing state, kept in sync with report_processing_jobs: uploaded → extracting → analyzing → completed | failed. Defaults to uploaded for new reports.';

create index if not exists idx_medical_reports_processing
  on public.medical_reports (created_at)
  where processing_status in ('uploaded', 'extracting', 'analyzing');

-- ----------------------------------------------------------------------------
-- 4. ai_insights: processing_time_ms & model_used
-- ----------------------------------------------------------------------------
alter table public.ai_insights
  add column if not exists processing_time_ms integer,
  add column if not exists model_used text;

comment on column public.ai_insights.processing_time_ms is
  'Wall-clock duration of the Grok analysis in milliseconds. Used for demo analytics and pipeline debugging.';
comment on column public.ai_insights.model_used is
  'Model identifier that produced this analysis (e.g. grok-3-mini), for debugging and cost attribution.';

-- ============================================================================
-- 5. Row Level Security for the two NEW tables
--    (existing policies are left untouched)
-- ============================================================================

alter table public.voice_conversations     enable row level security;
alter table public.report_processing_jobs enable row level security;

-- voice_conversations (direct user ownership) --------------------------------
drop policy if exists "voice_conversations_select_own" on public.voice_conversations;
create policy "voice_conversations_select_own" on public.voice_conversations
  for select using (auth.uid() = user_id);

drop policy if exists "voice_conversations_insert_own" on public.voice_conversations;
create policy "voice_conversations_insert_own" on public.voice_conversations
  for insert with check (auth.uid() = user_id);

drop policy if exists "voice_conversations_update_own" on public.voice_conversations;
create policy "voice_conversations_update_own" on public.voice_conversations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "voice_conversations_delete_own" on public.voice_conversations;
create policy "voice_conversations_delete_own" on public.voice_conversations
  for delete using (auth.uid() = user_id);

-- report_processing_jobs (ownership inherited from the parent report) --------
drop policy if exists "report_processing_jobs_select_own" on public.report_processing_jobs;
create policy "report_processing_jobs_select_own" on public.report_processing_jobs
  for select using (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

drop policy if exists "report_processing_jobs_insert_own" on public.report_processing_jobs;
create policy "report_processing_jobs_insert_own" on public.report_processing_jobs
  for insert with check (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

drop policy if exists "report_processing_jobs_update_own" on public.report_processing_jobs;
create policy "report_processing_jobs_update_own" on public.report_processing_jobs
  for update using (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

drop policy if exists "report_processing_jobs_delete_own" on public.report_processing_jobs;
create policy "report_processing_jobs_delete_own" on public.report_processing_jobs
  for delete using (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 6. Documentation — comment on every table and important column
-- ============================================================================

-- profiles -------------------------------------------------------------------
comment on table public.profiles is
  '1:1 public extension of auth.users. A row is auto-created on sign-up (see on_auth_user_created trigger).';
comment on column public.profiles.id is
  'Primary key, 1:1 with auth.users.id (no separate users table).';
comment on column public.profiles.full_name is
  'Display name, captured from raw_user_meta_data at sign-up.';
comment on column public.profiles.age is
  'Age in years; used to contextualize metrics against population ranges.';
comment on column public.profiles.gender is
  'Self-reported gender, optional.';
comment on column public.profiles.preferred_language is
  'BCP-47 default language for the Multilingual Voice Health Assistant (e.g. en, hi, ta, mr).';
comment on column public.profiles.created_at is
  'Row creation time (equals sign-up time).';
comment on column public.profiles.updated_at is
  'Last profile update, maintained by the profiles_set_updated_at trigger.';

-- medical_reports ------------------------------------------------------------
comment on table public.medical_reports is
  'Every uploaded medical report and the source for features 1 and 2. A report advances through upload_status (transfer) and processing_status (AI pipeline).';
comment on column public.medical_reports.id is
  'Primary key.';
comment on column public.medical_reports.user_id is
  'Owner (FK to auth.users). All RLS scoping for this row and its children keys off this column.';
comment on column public.medical_reports.report_title is
  'User-visible title of the report.';
comment on column public.medical_reports.report_type is
  'Free-form classifier output, e.g. blood_test, pathology, imaging, prescription. Kept unconstrained so AI classification can extend it.';
comment on column public.medical_reports.report_date is
  'Date the report was issued (from the document), distinct from created_at.';
comment on column public.medical_reports.hospital_name is
  'Facility that issued the report, when present on the document.';
comment on column public.medical_reports.file_url is
  'Storage object path (recommend a private "reports" bucket); the AI pipeline uses it for extraction.';
comment on column public.medical_reports.upload_status is
  'File transfer lifecycle: pending → uploading → processed | failed.';
comment on column public.medical_reports.processing_status is
  'Aggregate AI processing state, kept in sync with report_processing_jobs: uploaded → extracting → analyzing → completed | failed.';
comment on column public.medical_reports.created_at is
  'Row creation time.';

-- health_metrics -------------------------------------------------------------
comment on table public.health_metrics is
  'Extracted lab values that feed the Adaptive Personal Baseline Engine and AI Health Journey.';
comment on column public.health_metrics.id is
  'Primary key.';
comment on column public.health_metrics.report_id is
  'Parent report (FK, cascade delete). Ownership for RLS resolves through this link.';
comment on column public.health_metrics.metric_name is
  'Normalized metric identifier (e.g. hemoglobin, hba1c, blood_pressure_systolic).';
comment on column public.health_metrics.metric_value is
  'Numeric value. Composite readings such as blood pressure "120/80" should be stored as two rows: blood_pressure_systolic and blood_pressure_diastolic.';
comment on column public.health_metrics.metric_unit is
  'Unit of measurement (e.g. g/dL, mmol/L, mmHg).';
comment on column public.health_metrics.population_min is
  'Reference range lower bound from the lab report, used to flag abnormal values.';
comment on column public.health_metrics.population_max is
  'Reference range upper bound from the lab report, used to flag abnormal values.';
comment on column public.health_metrics.measurement_date is
  'When the sample was taken (from the report), used for time-series and APBE ordering.';
comment on column public.health_metrics.created_at is
  'Row creation time.';

-- ai_insights ----------------------------------------------------------------
comment on table public.ai_insights is
  'Grok AI analysis and actionable plan for one report (feature 1: AI Medical Report → Action Plan).';
comment on column public.ai_insights.id is
  'Primary key.';
comment on column public.ai_insights.report_id is
  'UNIQUE: one analysis per report. Re-running the AI should UPSERT on report_id.';
comment on column public.ai_insights.summary is
  'Plain-language summary of the report and its findings.';
comment on column public.ai_insights.abnormal_values is
  'JSON array of objects, e.g. [{"metric":"hemoglobin","value":9.8,"unit":"g/dL","status":"low"}].';
comment on column public.ai_insights.lifestyle_recommendations is
  'JSON array of strings; the actionable plan for feature 1.';
comment on column public.ai_insights.doctor_questions is
  'JSON array of questions the user should ask their doctor.';
comment on column public.ai_insights.confidence_score is
  '0..1 confidence of the Grok analysis.';
comment on column public.ai_insights.processing_time_ms is
  'Wall-clock duration of the Grok analysis in milliseconds. Used for demo analytics and pipeline debugging.';
comment on column public.ai_insights.model_used is
  'Model identifier that produced this analysis (e.g. grok-3-mini), for debugging and cost attribution.';
comment on column public.ai_insights.created_at is
  'Row creation time.';

-- personal_baselines ---------------------------------------------------------
comment on table public.personal_baselines is
  'One rolling baseline per user per metric. APBE recomputes and UPSERTs on (user_id, metric_name).';
comment on column public.personal_baselines.id is
  'Primary key.';
comment on column public.personal_baselines.user_id is
  'Owner (FK to auth.users).';
comment on column public.personal_baselines.metric_name is
  'Metric this baseline describes; pairs with health_metrics.metric_name.';
comment on column public.personal_baselines.rolling_mean is
  'Rolling window mean of the user''s recent readings for this metric.';
comment on column public.personal_baselines.rolling_std is
  'Rolling window standard deviation, used to normalize z-scores.';
comment on column public.personal_baselines.exponential_average is
  'Exponentially weighted moving average — emphasizes recent readings.';
comment on column public.personal_baselines.latest_z_score is
  'Z-score of the latest reading against this user''s own baseline.';
comment on column public.personal_baselines.personal_status is
  'Derived status of the latest reading relative to this user''s own baseline, not the lab range.';
comment on column public.personal_baselines.created_at is
  'When the baseline row was first created.';
comment on column public.personal_baselines.updated_at is
  'Last recomputation, maintained by the personal_baselines_set_updated_at trigger.';

-- doctor_briefs --------------------------------------------------------------
comment on table public.doctor_briefs is
  'AI-generated, patient-owned summary for the next doctor visit (feature 4: AI Doctor Visit Copilot).';
comment on column public.doctor_briefs.id is
  'Primary key.';
comment on column public.doctor_briefs.user_id is
  'Owner (FK to auth.users).';
comment on column public.doctor_briefs.summary is
  'Narrative summary of health status since the last visit.';
comment on column public.doctor_briefs.medications is
  'JSON array of {name, dosage, frequency} extracted for the visit.';
comment on column public.doctor_briefs.health_changes is
  'JSON array of strings describing changes since the last visit.';
comment on column public.doctor_briefs.recommended_questions is
  'JSON array of questions the user should raise with the doctor.';
comment on column public.doctor_briefs.generated_at is
  'When this brief was generated for a visit (may predate created_at on regeneration).';
comment on column public.doctor_briefs.created_at is
  'Row creation time.';

-- ============================================================================
-- Done. Existing foreign keys and RLS policies are unchanged.
-- ============================================================================
