import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * APBE AI Enhancement — client side.
 *
 * Invokes the secure Convex action `baselines:enhance` (src/convex/baselines.ts)
 * which asks Gemini for a plain-language briefing over the user's personal
 * baseline statistics. Separate from the report analysis action — this never
 * touches ai_insights and does not affect the existing AI report analysis.
 */

export interface BaselineMetricInput {
  metricName: string;
  label: string;
  unit: string | null;
  /** Chronological (oldest → newest) values of this metric. */
  values: number[];
  rollingMean: number | null;
  stdDev: number | null;
  latestZScore: number | null;
  latestValue: number | null;
  percentageDifference: number | null;
  direction: string;
  personalStatus: string;
}

export interface BaselineAiBrief {
  overallTrend: string;
  improvingMetrics: string[];
  decliningMetrics: string[];
  importantChanges: string[];
  recommendedActions: string[];
  monitoringAdvice: string[];
  confidence: number;
}

export type BaselineAiErrorCode =
  | "not_configured"
  | "model_error"
  | "unauthorized"
  | "empty_input"
  | "rate_limited"
  | "timeout"
  | "network"
  | "invalid_json"
  | "server";

export type BaselineAiOutcome =
  | {
      ok: true;
      brief: BaselineAiBrief;
      raw: string;
      model: string;
      processingTimeMs: number;
    }
  | { ok: false; code: BaselineAiErrorCode; message: string };

let convexClient: ConvexHttpClient | null = null;

function getConvexClient(): ConvexHttpClient {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) {
    throw new Error(
      "CONVEX_URL_MISSING: add VITE_CONVEX_URL in the Keys tab to enable AI enhancement.",
    );
  }
  if (!convexClient) convexClient = new ConvexHttpClient(url);
  return convexClient;
}

/**
 * Asks Gemini for the personal-baseline briefing. The action verifies the
 * caller's Supabase session server-side and returns a validated briefing — or
 * a structured { ok: false, code } outcome. Never throws for AI failures.
 */
export async function generateBaselineBrief(
  accessToken: string,
  metrics: BaselineMetricInput[],
): Promise<BaselineAiOutcome> {
  try {
    const result = await getConvexClient().action(api.baselines.enhance, {
      accessToken,
      metrics,
    });
    return result as BaselineAiOutcome;
  } catch (err) {
    return {
      ok: false,
      code: "network",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
