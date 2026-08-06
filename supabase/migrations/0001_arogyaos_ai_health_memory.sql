-- ============================================================================
-- ArogyaOS – AI Health Memory
-- Migration 0001 · core schema
-- ----------------------------------------------------------------------------
-- Backs exactly five hackathon features:
--   1. AI Medical Report → Action Plan        (medical_reports, ai_insights)
--   2. AI Health Journey                      (medical_reports, health_metrics)
--   3. Adaptive Personal Baseline Engine      (health_metrics, personal_baselines)
--   4. AI Doctor Visit Copilot                (doctor_briefs)
--   5. Multilingual Voice Health Assistant    (profiles.preferred_language, health_metrics)
--
-- Security model: Supabase Auth owns identities (auth.users). `profiles`
-- extends auth.users 1:1. Every data table is user-scoped and protected by
-- Row Level Security — users can only touch their own rows.
--
-- Apply via the Supabase SQL Editor, or with the Supabase CLI:
--   supabase db push
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Shared helper: updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. profiles — public extension of auth.users (1:1, no separate users table)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text,
  age                integer check (age >= 0 and age <= 130),
  gender             text check (gender in ('female', 'male', 'non_binary', 'prefer_not_to_say')),
  preferred_language text not null default 'en',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.profiles is
  '1:1 public extension of auth.users. A row is auto-created on sign-up (see on_auth_user_created trigger).';
comment on column public.profiles.preferred_language is
  'BCP-47 language tag used by the Multilingual Voice Health Assistant (e.g. en, hi, ta, mr).';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- Auto-provision a profile row whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. medical_reports — every uploaded report
-- ----------------------------------------------------------------------------
create table public.medical_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  report_title  text not null,
  report_type   text not null,
  report_date   date,
  hospital_name text,
  file_url      text,
  upload_status text not null default 'pending'
                check (upload_status in ('pending', 'uploading', 'processed', 'failed')),
  created_at    timestamptz not null default now()
);

comment on column public.medical_reports.report_type is
  'Free-form classifier output, e.g. blood_test, pathology, imaging, prescription. Kept unconstrained so AI classification can extend it.';
comment on column public.medical_reports.file_url is
  'Storage object path (recommend a private "reports" bucket); the AI pipeline uses it for extraction.';

-- ----------------------------------------------------------------------------
-- 4. health_metrics — extracted lab values, one row per measured metric
-- ----------------------------------------------------------------------------
create table public.health_metrics (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.medical_reports (id) on delete cascade,
  metric_name     text not null,
  metric_value    numeric not null,
  metric_unit     text,
  population_min  numeric,
  population_max  numeric,
  measurement_date date,
  created_at      timestamptz not null default now()
);

comment on table public.health_metrics is
  'Extracted values that feed the Adaptive Personal Baseline Engine and AI Health Journey.';
comment on column public.health_metrics.population_min is
  'Reference range lower bound from the lab report, used to flag abnormal values.';
comment on column public.health_metrics.population_max is
  'Reference range upper bound from the lab report, used to flag abnormal values.';
comment on column public.health_metrics.metric_value is
  'Numeric value. Composite readings such as blood pressure "120/80" should be stored as two rows: blood_pressure_systolic and blood_pressure_diastolic.';

-- ----------------------------------------------------------------------------
-- 5. ai_insights — Grok AI analysis & action plan for a report
-- ----------------------------------------------------------------------------
create table public.ai_insights (
  id                       uuid primary key default gen_random_uuid(),
  report_id                uuid not null unique references public.medical_reports (id) on delete cascade,
  summary                  text,
  abnormal_values          jsonb not null default '[]'::jsonb,
  lifestyle_recommendations jsonb not null default '[]'::jsonb,
  doctor_questions         jsonb not null default '[]'::jsonb,
  confidence_score         numeric check (confidence_score >= 0 and confidence_score <= 1),
  created_at               timestamptz not null default now()
);

comment on column public.ai_insights.report_id is
  'UNIQUE: one analysis per report. Re-running the AI should UPSERT on report_id.';
comment on column public.ai_insights.abnormal_values is
  'JSON array of objects, e.g. [{"metric":"hemoglobin","value":9.8,"unit":"g/dL","status":"low"}].';
comment on column public.ai_insights.lifestyle_recommendations is
  'JSON array of strings; the actionable plan for feature 1.';
comment on column public.ai_insights.confidence_score is
  '0..1 confidence of the Grok analysis.';

-- ----------------------------------------------------------------------------
-- 6. personal_baselines — Adaptive Personal Baseline Engine (APBE)
-- ----------------------------------------------------------------------------
create table public.personal_baselines (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  metric_name       text not null,
  rolling_mean      numeric,
  rolling_std       numeric,
  exponential_average numeric,
  latest_z_score    numeric,
  personal_status   text not null default 'normal'
                    check (personal_status in ('normal', 'low', 'elevated', 'critical')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, metric_name)
);

comment on table public.personal_baselines is
  'One rolling baseline per user per metric. APBE recomputes and UPSERTs on (user_id, metric_name).';
comment on column public.personal_baselines.personal_status is
  'Derived status of the latest reading relative to this user''s own baseline, not the lab range.';

create trigger personal_baselines_set_updated_at
  before update on public.personal_baselines
  for each row execute procedure public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. doctor_briefs — AI Doctor Visit Copilot summaries
-- ----------------------------------------------------------------------------
create table public.doctor_briefs (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  summary               text,
  medications           jsonb not null default '[]'::jsonb,
  health_changes        jsonb not null default '[]'::jsonb,
  recommended_questions jsonb not null default '[]'::jsonb,
  generated_at          timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

comment on column public.doctor_briefs.medications is
  'JSON array of {name, dosage, frequency} extracted for the visit.';
comment on column public.doctor_briefs.health_changes is
  'JSON array of strings describing changes since the last visit.';

-- ============================================================================
-- 8. Indexes (query patterns per feature)
-- ============================================================================

-- medical_reports
create index idx_medical_reports_user_created
  on public.medical_reports (user_id, created_at desc);
create index idx_medical_reports_user_type
  on public.medical_reports (user_id, report_type);
create index idx_medical_reports_pending
  on public.medical_reports (created_at)
  where upload_status in ('pending', 'uploading');

-- health_metrics (user scoping resolves through medical_reports)
create index idx_health_metrics_report_id
  on public.health_metrics (report_id);
create index idx_health_metrics_name_date
  on public.health_metrics (metric_name, measurement_date);

-- ai_insights
-- unique (report_id) above already provides the lookup index.

-- personal_baselines
create index idx_personal_baselines_user
  on public.personal_baselines (user_id);

-- doctor_briefs
create index idx_doctor_briefs_user_generated
  on public.doctor_briefs (user_id, generated_at desc);

-- ============================================================================
-- 9. Row Level Security — users can only access their own records
-- ============================================================================

alter table public.profiles           enable row level security;
alter table public.medical_reports    enable row level security;
alter table public.health_metrics     enable row level security;
alter table public.ai_insights        enable row level security;
alter table public.personal_baselines enable row level security;
alter table public.doctor_briefs      enable row level security;

-- profiles ----------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- medical_reports ----------------------------------------------------------
create policy "medical_reports_select_own" on public.medical_reports
  for select using (auth.uid() = user_id);

create policy "medical_reports_insert_own" on public.medical_reports
  for insert with check (auth.uid() = user_id);

create policy "medical_reports_update_own" on public.medical_reports
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "medical_reports_delete_own" on public.medical_reports
  for delete using (auth.uid() = user_id);

-- health_metrics (ownership inherited from the parent report) --------------
create policy "health_metrics_select_own" on public.health_metrics
  for select using (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

create policy "health_metrics_insert_own" on public.health_metrics
  for insert with check (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

create policy "health_metrics_update_own" on public.health_metrics
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

create policy "health_metrics_delete_own" on public.health_metrics
  for delete using (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

-- ai_insights (ownership inherited from the parent report) ------------------
create policy "ai_insights_select_own" on public.ai_insights
  for select using (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

create policy "ai_insights_insert_own" on public.ai_insights
  for insert with check (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

create policy "ai_insights_update_own" on public.ai_insights
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

create policy "ai_insights_delete_own" on public.ai_insights
  for delete using (
    exists (
      select 1 from public.medical_reports mr
      where mr.id = report_id and mr.user_id = auth.uid()
    )
  );

-- personal_baselines --------------------------------------------------------
create policy "personal_baselines_select_own" on public.personal_baselines
  for select using (auth.uid() = user_id);

create policy "personal_baselines_insert_own" on public.personal_baselines
  for insert with check (auth.uid() = user_id);

create policy "personal_baselines_update_own" on public.personal_baselines
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "personal_baselines_delete_own" on public.personal_baselines
  for delete using (auth.uid() = user_id);

-- doctor_briefs -------------------------------------------------------------
create policy "doctor_briefs_select_own" on public.doctor_briefs
  for select using (auth.uid() = user_id);

create policy "doctor_briefs_insert_own" on public.doctor_briefs
  for insert with check (auth.uid() = user_id);

create policy "doctor_briefs_update_own" on public.doctor_briefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "doctor_briefs_delete_own" on public.doctor_briefs
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- Done. Intentionally NOT included: appointments, clinics, billing, pharmacy,
-- doctors, or any hospital-management tables.
-- ============================================================================
