-- ============================================================================
-- ArogyaOS – AI Health Memory
-- Migration 0005 · ai_insights raw response
-- ----------------------------------------------------------------------------
-- Backs Feature 3 (AI Medical Report Analysis with Grok):
--   Adds ai_insights.raw_response, which stores the complete raw Grok AI
--   response (JSON) for debugging and audit. No existing columns, indexes,
--   or policies are modified.
--
-- Idempotent (safe to re-run): ADD COLUMN IF NOT EXISTS.
-- ============================================================================

alter table public.ai_insights
  add column if not exists raw_response jsonb;

comment on column public.ai_insights.raw_response is
  'Complete raw Grok AI response (JSON) for this report, stored verbatim for debugging and audit.';

-- ============================================================================
-- Done. RLS already scopes ai_insights rows to the report owner (migration
-- 0001), so the raw AI response is only readable by the report owner.
-- ============================================================================
