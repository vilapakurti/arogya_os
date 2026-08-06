-- ============================================================================
-- ArogyaOS – AI Health Memory
-- Migration 0006 · ai_insights provider column
-- ----------------------------------------------------------------------------
-- Backs the AI provider fallback system (Gemini primary → OpenRouter fallback):
--   Adds ai_insights.provider, which records which provider actually produced
--   the analysis ("gemini" or "openrouter"). This is required for debugging
--   and monitoring — it complements the existing model_used column, which
--   records the specific model identifier.
--
-- No existing columns, indexes, or policies are modified.
--
-- Idempotent (safe to re-run): ADD COLUMN IF NOT EXISTS.
-- ============================================================================

alter table public.ai_insights
  add column if not exists provider text;

comment on column public.ai_insights.provider is
  'AI provider that produced this analysis: "gemini" or "openrouter". Used for debugging and monitoring (pairs with model_used, which stores the exact model identifier).';

-- ============================================================================
-- Done. RLS already scopes ai_insights rows to the report owner (migration
-- 0001), so the provider value is only readable by the report owner.
-- ============================================================================
