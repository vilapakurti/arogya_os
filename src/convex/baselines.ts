"use node";

/**
 * APBE AI Enhancement (Feature: Adaptive Personal Baseline Engine) — secure
 * Google Gemini action.
 *
 * This action is separate from `insights:generate` (the report analysis) and
 * does NOT affect it. It takes the deterministic APBE statistics computed by
 * the client engine (historical values, personal baseline, current values,
 * trend statistics) and asks Gemini for a plain-language briefing:
 * overall trend, improving/declining metrics, important changes, recommended
 * actions, monitoring advice, and a confidence score.
 *
 * Security model (mirrors insights.ts):
 *  - The caller's Supabase access token is verified server-side against the
 *    Supabase Auth endpoint.
 *  - Only the already-computed numeric statistics are sent — never the raw
 *    report files or OCR text.
 *  - The Gemini API key lives only in process.env on the Convex server.
 *
 * Environment variables (Keys tab / Convex env):
 *   GEMINI_API_KEY       — Google AI Studio API key (required)
 *   SUPABASE_URL         — e.g. https://<project>.supabase.co (required)
 *   SUPABASE_ANON_KEY    — publishable anon key (required, used with the user JWT)
 *   GEMINI_MODEL         — optional, default "gemini-3.6-flash"
 */

import { action } from "./_generated/server";
import { v } from "convex/values";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are a preventive-health analyst helping a patient understand how their lab values compare to their OWN historical baseline (not population ranges).

The user provides, per metric: the chronological values, the personal rolling average, standard deviation, latest z-score, latest value, percentage difference from personal average, and the recent trend direction.

Rules:
- Write plainly and reassuringly; never diagnose disease.
- Always frame findings as observations and suggest confirming with a doctor when anything deviates more than 1 standard deviation from the personal baseline.
- Respond with ONLY a single JSON object. No markdown, no code fences, no commentary.

The JSON must match EXACTLY this schema:
{
  "overallTrend": "string — 1 to 3 sentence summary of the overall picture across all metrics",
  "improvingMetrics": ["string — metric name that is improving"],
  "decliningMetrics": ["string — metric name that is worsening"],
  "importantChanges": ["string — notable changes worth watching"],
  "recommendedActions": ["string — practical actions, at most 5"],
  "monitoringAdvice": ["string — how often/what to monitor, at most 3"],
  "confidence": "integer 0-100"
}`;

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

export interface BaselineAiBrief {
  overallTrend: string;
  improvingMetrics: string[];
  decliningMetrics: string[];
  importantChanges: string[];
  recommendedActions: string[];
  monitoringAdvice: string[];
  confidence: number;
}

export type BaselineAiOutcome =
  | {
      ok: true;
      brief: BaselineAiBrief;
      raw: string;
      model: string;
      processingTimeMs: number;
    }
  | { ok: false; code: BaselineAiErrorCode; message: string };

export const enhance = action({
  args: {
    accessToken: v.string(),
    metrics: v.array(
      v.object({
        metricName: v.string(),
        label: v.string(),
        unit: v.optional(v.union(v.string(), v.null())),
        values: v.array(v.number()),
        rollingMean: v.optional(v.union(v.number(), v.null())),
        stdDev: v.optional(v.union(v.number(), v.null())),
        latestZScore: v.optional(v.union(v.number(), v.null())),
        latestValue: v.optional(v.union(v.number(), v.null())),
        percentageDifference: v.optional(v.union(v.number(), v.null())),
        direction: v.string(),
        personalStatus: v.string(),
      }),
    ),
  },
  handler: async (_ctx, args): Promise<BaselineAiOutcome> => {
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    const fail = (
      code: BaselineAiErrorCode,
      message: string,
    ): BaselineAiOutcome => ({ ok: false, code, message });

    if (!geminiKey) {
      return fail(
        "not_configured",
        "GEMINI_API_KEY is not set. Add it in the Keys tab (Convex env).",
      );
    }
    if (!supabaseUrl || !supabaseAnonKey) {
      return fail(
        "not_configured",
        "SUPABASE_URL / SUPABASE_ANON_KEY are not set in the Convex environment.",
      );
    }

    // 1. Verify the caller's Supabase session server-side.
    try {
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${args.accessToken}`,
        },
      });
      if (!userRes.ok) {
        return fail("unauthorized", "Could not verify your session. Please sign in again.");
      }
    } catch {
      return fail("network", "Could not reach the authentication service.");
    }

    // 2. Empty input guard.
    if (args.metrics.length === 0) {
      return fail(
        "empty_input",
        "No metric data was provided. Upload at least three reports to build your baseline first.",
      );
    }

    // 3. Call Gemini with the deterministic APBE statistics.
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const userMessage = [
      "Here is the user's personal baseline analysis. Please provide the plain-language briefing.",
      "",
      "=== METRIC STATISTICS ===",
      JSON.stringify(args.metrics, null, 1),
      "",
      "Return the JSON briefing exactly as instructed.",
    ].join("\n");

    const startedAt = Date.now();
    let rawContent = "";
    try {
      const res = await fetch(
        `${GEMINI_ENDPOINT}/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 2048,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        },
      );

      if (res.status === 429) {
        return fail(
          "rate_limited",
          "The AI service is rate-limited right now. Please try again in a moment.",
        );
      }
      if (res.status === 404) {
        return fail(
          "model_error",
          `The Gemini model "${model}" was not found (HTTP 404). Set GEMINI_MODEL in the Keys tab to a model your key can use.`,
        );
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const errText = await res.text().catch(() => "");
        if (/not found|not supported|does not exist|not available|invalid model/i.test(errText)) {
          return fail(
            "model_error",
            `The Gemini model "${model}" was rejected (HTTP ${res.status}): ${errText.slice(0, 200)}`,
          );
        }
        return fail(
          "not_configured",
          "The Gemini API key was rejected. Please check GEMINI_API_KEY in the Keys tab.",
        );
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return fail(
          "server",
          `The AI service returned an error (HTTP ${res.status})${
            errText ? `: ${errText.slice(0, 200)}` : ""
          }.`,
        );
      }

      const body = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };

      const parts = body.candidates?.[0]?.content?.parts ?? [];
      rawContent = parts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError" || /timeout/i.test(String(err))) {
        return fail("timeout", "The AI took too long to respond. Please try again.");
      }
      return fail("network", "Could not reach the AI service. Check your connection.");
    }

    const processingTimeMs = Date.now() - startedAt;

    // 4. Parse + validate the JSON briefing.
    const parsed = extractJsonFromParts(rawContent.split("\n"));
    if (!parsed) {
      const snippet = rawContent.trim().slice(0, 300);
      return fail(
        "invalid_json",
        `The AI returned an unreadable response${
          snippet ? ` — body: ${snippet}` : ""
        }. Please try again.`,
      );
    }
    const brief = normalizeBrief(parsed);

    return {
      ok: true,
      brief,
      raw: rawContent,
      model,
      processingTimeMs,
    };
  },
});

/** Pulls the first balanced JSON object out of a possibly-noisy string. */
function extractJson(content: string): Record<string, unknown> | null {
  if (!content) return null;
  const cleaned = content.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Tries each response part (the JSON part is usually last), then the join. */
function extractJsonFromParts(parts: string[]): Record<string, unknown> | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const parsed = extractJson(parts[i]);
    if (parsed) return parsed;
  }
  return extractJson(parts.join("\n"));
}

function stringArray(value: unknown, max = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, max)
    .map((item) => item.trim());
}

function normalizeBrief(raw: Record<string, unknown>): BaselineAiBrief {
  const confidenceRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
    : 0;

  return {
    overallTrend:
      typeof raw.overallTrend === "string" && raw.overallTrend.trim()
        ? raw.overallTrend.trim()
        : "",
    improvingMetrics: stringArray(raw.improvingMetrics),
    decliningMetrics: stringArray(raw.decliningMetrics),
    importantChanges: stringArray(raw.importantChanges),
    recommendedActions: stringArray(raw.recommendedActions, 5),
    monitoringAdvice: stringArray(raw.monitoringAdvice, 3),
    confidence,
  };
}
