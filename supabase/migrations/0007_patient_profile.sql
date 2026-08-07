-- ============================================================================
-- ArogyaOS – Patient Profile
-- Migration 0007 · extends public.profiles with demographic + health fields
-- ----------------------------------------------------------------------------
-- Adds the demographic / lifestyle / medical-history fields consumed by the
-- Patient Profile module. Derived fields (age, age_category, bmi,
-- bmi_category) are written by the app whenever the source values change —
-- they are stored so future AI modules (report analysis, health journey,
-- doctor copilot, voice assistant) can read them directly without
-- recomputation.
--
-- Idempotent-friendly: columns use ADD COLUMN IF NOT EXISTS; the gender check
-- is dropped and re-created to include 'other' (existing values preserved).
--
-- Apply via the Supabase SQL Editor, or with the CLI:  supabase db push
-- ============================================================================

-- gender gains 'other' (previous values kept for compatibility)
alter table public.profiles
  drop constraint if exists profiles_gender_check;

alter table public.profiles
  add constraint profiles_gender_check
  check (gender in ('female', 'male', 'other', 'non_binary', 'prefer_not_to_say'));

-- demographic
alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists blood_group text,
  add column if not exists height_cm numeric check (height_cm >= 50 and height_cm <= 250),
  add column if not exists weight_kg numeric check (weight_kg >= 2 and weight_kg <= 300);

-- derived (computed by the app on save; stored for direct AI reads)
alter table public.profiles
  add column if not exists bmi numeric check (bmi > 0 and bmi < 100),
  add column if not exists bmi_category text
    check (bmi_category in ('underweight', 'normal', 'overweight', 'obese')),
  add column if not exists age_category text
    check (age_category in ('child', 'adult', 'senior'));

-- pregnancy (relevant only when gender = 'female')
alter table public.profiles
  add column if not exists pregnant boolean,
  add column if not exists trimester text
    check (trimester in ('first', 'second', 'third'));

-- lifestyle
alter table public.profiles
  add column if not exists smoking_status text
    check (smoking_status in ('never', 'former', 'occasionally', 'daily')),
  add column if not exists alcohol_status text
    check (alcohol_status in ('never', 'occasionally', 'weekly', 'daily')),
  add column if not exists exercise_level text
    check (exercise_level in ('sedentary', 'light', 'moderate', 'active', 'athlete'));

-- medical history (JSON arrays)
alter table public.profiles
  add column if not exists known_conditions jsonb not null default '[]'::jsonb,
  add column if not exists family_history jsonb not null default '[]'::jsonb,
  add column if not exists allergies text,
  add column if not exists current_medications jsonb not null default '[]'::jsonb;

-- emergency contact
alter table public.profiles
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text;
