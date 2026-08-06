-- ============================================================================
-- ArogyaOS – AI Health Memory
-- Migration 0003 · medical-reports storage bucket + storage RLS
-- ----------------------------------------------------------------------------
-- Backs Feature 1 (AI Medical Report → Action Plan) file uploads:
--   1. Creates the private `medical-reports` storage bucket (20 MB max,
--      PDF / JPG / JPEG / PNG only, public access disabled).
--   2. Adds storage.objects RLS policies so each authenticated user can
--      read / insert / update / delete ONLY files inside their own folder
--      (<user_id>/...). All other access is denied by default.
--
-- The application uploads to `medical-reports/<user_id>/<uuid>-<filename>`,
-- which matches the folder-scoped policies below exactly.
--
-- Idempotent (safe to re-run): bucket upserts, policies are dropped
-- before being recreated (same convention as migration 0002).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Bucket
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medical-reports',
  'medical-reports',
  false,
  20971520, -- 20 MB in bytes
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

-- ----------------------------------------------------------------------------
-- 2. Storage RLS — own-folder access only
-- ----------------------------------------------------------------------------
drop policy if exists "medical_reports_read_own" on storage.objects;
create policy "medical_reports_read_own"
  on storage.objects for select
  using (
    bucket_id = 'medical-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "medical_reports_insert_own" on storage.objects;
create policy "medical_reports_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'medical-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "medical_reports_update_own" on storage.objects;
create policy "medical_reports_update_own"
  on storage.objects for update
  using (
    bucket_id = 'medical-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'medical-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "medical_reports_delete_own" on storage.objects;
create policy "medical_reports_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'medical-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- Done. No application tables were touched — database RLS for medical_reports
-- was already defined in migration 0001.
-- ============================================================================
