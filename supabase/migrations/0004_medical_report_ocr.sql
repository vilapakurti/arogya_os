-- ============================================================================
-- ArogyaOS – AI Health Memory
-- Migration 0004 · OCR output column
-- ----------------------------------------------------------------------------
-- Backs Feature 2 (Medical Report OCR):
--   Adds medical_reports.ocr_text, which stores the plain text extracted from
--   the uploaded document by the OCR pipeline. No existing columns, indexes,
--   or policies are modified.
--
-- Idempotent (safe to re-run): ADD COLUMN IF NOT EXISTS.
-- ============================================================================

alter table public.medical_reports
  add column if not exists ocr_text text;

comment on column public.medical_reports.ocr_text is
  'Plain text extracted from the uploaded document by the OCR pipeline. Null until the extracting stage completes successfully.';

-- ============================================================================
-- Done. RLS already scopes medical_reports rows to their owner (migration
-- 0001), so OCR text is only readable by the report owner.
-- ============================================================================
