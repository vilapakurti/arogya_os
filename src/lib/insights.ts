import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getSupabase } from "@/lib/supabase";

/**
 * AI Medical Report Analysis (Feature 3) — client side.
 *
 * The AI call itself happens in the Convex action `insights:generate`
 * (src/convex/insights.ts), which is the only place the AI keys exist. That
 * action transparently falls back between providers (Gemini primary,
 * OpenRouter secondary) — the client never knows or chooses the provider.
 * This module invokes that secure backend function and persists the result
 * into Supabase `ai_insights` (RLS-scoped to the report owner), including the
 * `provider` that produced the analysis for debugging/monitoring.
 */

export type AiSeverity = "LOW" | "MEDIUM" | "HIGH";

export interface AiAbnormalValue {
  metric: string;
  value: string | number;
  unit?: string | null;
  status?: string;
}

export interface AiInsight {
  summary: string;
  importantObservations: string[];
  abnormalValues: AiAbnormalValue[];
  lifestyleRecommendations: string[];
  dietRecommendations: string[];
  exerciseRecommendations: string[];
  doctorQuestions: string[];
  severity: AiSeverity;
  confidence: number;
}

export type AiErrorCode =
  | "not_configured"
  | "model_error"
  | "unauthorized"
  | "empty_ocr"
  | "rate_limited"
  | "timeout"
  | "network"
  | "invalid_json"
  | "server"
  | "not_found";

export type AiOutcome =
  | {
      ok: true;
      insight: AiInsight;
      raw: string;
      model: string;
      /** Which provider produced the analysis: "gemini" or "openrouter". */
      provider: string;
      processingTimeMs: number;
    }
  | { ok: false; code: AiErrorCode; message: string };

/** The exact headline shown when the AI service is unavailable. */
export const AI_UNAVAILABLE_MESSAGE = "AI Analysis currently unavailable.";

let convexClient: ConvexHttpClient | null = null;

function getConvexClient(): ConvexHttpClient {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) {
    throw new Error(
      "CONVEX_URL_MISSING: add VITE_CONVEX_URL in the Keys tab to enable AI analysis.",
    );
  }
  if (!convexClient) convexClient = new ConvexHttpClient(url);
  return convexClient;
}

/**
 * Invokes the secure AI action. The action verifies the caller's Supabase
 * session, re-reads the report's ocr_text + health_metrics through RLS, and
 * returns a validated analysis — or a structured { ok: false, code } outcome.
 */
export async function generateReportInsight(
  reportId: string,
  accessToken: string,
): Promise<AiOutcome> {
  const result = await getConvexClient().action(api.insights.generate, {
    reportId,
    accessToken,
  });
  return result as AiOutcome;
}

export interface SaveAiInsightParams {
  reportId: string;
  insight: AiInsight;
  raw: string;
  model: string;
  /** Which provider produced the analysis: "gemini" or "openrouter". */
  provider: string;
  processingTimeMs: number;
}

/**
 * Persists the analysis into ai_insights (upsert on report_id — the column is
 * UNIQUE, so re-analysis replaces the previous row). Includes the complete
 * raw AI response and the provider for debugging.
 *
 * The `provider` column is added by migration 0006. Until that migration is
 * applied, PostgREST rejects the unknown column — the save is retried without
 * it so existing functionality is never blocked.
 *
 * confidence_score: the action returns a 0..100 confidence, but the database
 * CHECK constraint (migration 0001) only accepts 0..1. Store the 0..1 ratio
 * (confidence / 100); the UI still displays the 0..100 value from the action
 * result, so nothing user-facing changes.
 */
export async function saveAiInsight(
  params: SaveAiInsightParams,
): Promise<void> {
  const supabase = getSupabase();
  const payload = {
    report_id: params.reportId,
    summary: params.insight.summary,
    abnormal_values: params.insight.abnormalValues,
    lifestyle_recommendations: params.insight.lifestyleRecommendations,
    doctor_questions: params.insight.doctorQuestions,
    confidence_score: params.insight.confidence / 100,
    model_used: params.model,
    provider: params.provider,
    processing_time_ms: params.processingTimeMs,
    raw_response: params.raw,
  };

  let { error } = await supabase
    .from("ai_insights")
    .upsert(payload, { onConflict: "report_id" });

  // Migration 0006 not applied yet — retry without the provider column so
  // saving the analysis always works.
  if (error && /provider/i.test(error.message) && /column/i.test(error.message)) {
    const { provider: _omit, ...payloadWithoutProvider } = payload;
    ({ error } = await supabase
      .from("ai_insights")
      .upsert(payloadWithoutProvider, { onConflict: "report_id" }));
  }

  if (error) {
    throw new Error(`Could not save the AI analysis: ${error.message}`);
  }
}
