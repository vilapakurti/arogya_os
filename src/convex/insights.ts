"use node";

/**
 * AI Medical Report Analysis (Feature 3) — secure Google Gemini integration.
 *
 * This action is the ONLY place the Gemini API key lives: it is read from
 * process.env.GEMINI_API_KEY on the Convex server and is never exposed to the
 * browser. The frontend never calls Gemini directly — it invokes this action.
 *
 * Security model:
 *  - The caller's Supabase access token is verified server-side against the
 *    Supabase Auth endpoint (never trusted from the client alone).
 *  - The report's OCR text and parsed metrics are re-read server-side through
 *    PostgREST using the caller's own JWT, so existing Row Level Security
 *    policies enforce ownership — a user can only analyze their own reports.
 *  - Only ocr_text + health_metrics are sent to Gemini. The original PDF/image
 *    is never transmitted.
 *
 * Environment variables (set in the Keys tab / Convex env):
 *   GEMINI_API_KEY       — Google AI Studio API key (required)
 *   SUPABASE_URL         — e.g. https://<project>.supabase.co (required)
 *   SUPABASE_ANON_KEY    — publishable anon key (required, used with the user JWT)
 *   GEMINI_MODEL         — optional, default "gemini-3.6-flash"
 */

import { action } from "./_generated/server";
import { v } from "convex/values";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_TIMEOUT_MS = 75_000;
const MAX_OCR_CHARS = 12_000;

const SYSTEM_PROMPT = `You are an experienced physician helping patients understand their medical reports.

Rules you must follow:
- Explain everything in simple, non-alarming language.
- Never diagnose diseases. Frame findings as observations and questions to explore with a doctor.
- Always recommend consulting a qualified doctor.
- If the data is insufficient or unclear, say so honestly and keep the severity LOW.
- Respond with ONLY a single JSON object. No markdown, no code fences, no commentary.

The JSON must match EXACTLY this schema:
{
  "summary": "string — 2 to 4 sentence plain-language overview of the report",
  "severity": "LOW" | "MEDIUM" | "HIGH",
  "confidence": "integer 0-100",
  "abnormal_values": [{"metric": "string", "value": "string or number", "unit": "string or null", "status": "low" | "high" | "normal"}],
  "lifestyle_recommendations": ["string — practical lifestyle improvements"],
  "diet_suggestions": ["string — simple diet suggestions"],
  "exercise_suggestions": ["string — safe exercise suggestions"],
  "doctor_questions": ["string — questions the patient should ask their doctor"]
}`;

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

export const generate = action({
  args: {
    reportId: v.string(),
    accessToken: v.string(),
  },
  handler: async (_ctx, args) => {
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    const fail = (
      code: AiErrorCode,
      message: string,
    ): AiActionResult => ({ ok: false, code, message });

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
    let userId: string | undefined;
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
      const userData = (await userRes.json()) as { id?: string };
      userId = userData.id;
    } catch {
      return fail("network", "Could not reach the authentication service.");
    }
    if (!userId) {
      return fail("unauthorized", "Could not verify your session. Please sign in again.");
    }

    // 2. Read the report data server-side. PostgREST + the user's own JWT
    //    means RLS scopes every read to reports the user owns.
    const authHeaders = {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${args.accessToken}`,
    };
    let ocrText = "";
    let metrics: unknown[] = [];
    try {
      const [reportRes, metricsRes] = await Promise.all([
        fetch(
          `${supabaseUrl}/rest/v1/medical_reports?select=ocr_text&id=eq.${args.reportId}`,
          { headers: authHeaders },
        ),
        fetch(
          `${supabaseUrl}/rest/v1/health_metrics?select=metric_name,metric_value,metric_unit,population_min,population_max&report_id=eq.${args.reportId}&order=metric_name.asc`,
          { headers: authHeaders },
        ),
      ]);

      if (!reportRes.ok || !metricsRes.ok) {
        return fail(
          "not_found",
          "The report could not be read. It may not exist or the schema may not be applied.",
        );
      }
      const reports = (await reportRes.json()) as Array<{ ocr_text: string | null }>;
      if (reports.length === 0) {
        return fail("not_found", "The report could not be found or is not yours to analyze.");
      }
      ocrText = reports[0]?.ocr_text ?? "";
      metrics = (await metricsRes.json()) as unknown[];
    } catch {
      return fail("network", "Could not read the report data.");
    }

    // 3. Empty OCR guard.
    if (!ocrText || !ocrText.trim()) {
      return fail(
        "empty_ocr",
        "The report has no extracted text, so it cannot be analyzed. Try uploading a clearer scan.",
      );
    }

    // 4. Call Gemini with both the OCR text and the structured metrics.
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const userMessage = [
      "Please analyze this medical report.",
      "",
      "=== STRUCTURED METRICS (from health_metrics) ===",
      JSON.stringify(metrics, null, 1),
      "",
      "=== EXTRACTED TEXT (OCR of the document) ====",
      ocrText.slice(0, MAX_OCR_CHARS),
      "",
      "Return the JSON analysis exactly as instructed.",
    ].join("\n");

    const startedAt = Date.now();
    let rawContent = "";
    let finishReason = "";
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
              temperature: 0.3,
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
        // A 400 can mean an invalid model name rather than an invalid key —
        // report that distinctly so the two are never conflated.
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
          finishReason?: string;
        }>;
        promptFeedback?: { blockReason?: string };
      };

      const candidates = body.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        const blockReason = body.promptFeedback?.blockReason;
        return fail(
          "invalid_json",
          `The AI returned no content${
            blockReason ? ` (blocked by safety filter: ${blockReason})` : ""
          }. Please try again.`,
        );
      }

      // Thinking models return a "thought" part BEFORE the JSON part, so we
      // must read every part — never just parts[0].
      const parts = candidates[0]?.content?.parts ?? [];
      rawContent = parts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n");
      finishReason = candidates[0]?.finishReason ?? "";
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError" || /timeout/i.test(String(err))) {
        return fail("timeout", "The AI took too long to respond. Please try again.");
      }
      return fail("network", "Could not reach the AI service. Check your connection.");
    }

    const processingTimeMs = Date.now() - startedAt;

    // 5. Parse + validate the JSON analysis. Extract from each part in turn
    //    (the JSON part is usually last), then fall back to the joined text.
    const parsed = extractJsonFromParts(rawContent.split("\n"));
    if (!parsed) {
      const snippet = rawContent.trim().slice(0, 300);
      return fail(
        "invalid_json",
        `The AI returned an unreadable response${
          snippet ? ` — body: ${snippet}` : ""
        }. Please try again.${finishReason === "MAX_TOKENS" ? " (response was truncated)" : ""}`,
      );
    }
    const insight = normalizeInsight(parsed);

    return {
      ok: true,
      insight,
      raw: rawContent,
      model,
      processingTimeMs,
    };
  },
});

export interface AiActionResult {
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
  insight?: AiInsight;
  raw?: string;
  model?: string;
  processingTimeMs?: number;
}

export interface AiAbnormalValue {
  metric: string;
  value: string | number;
  unit?: string | null;
  status?: "low" | "high" | "normal" | string;
}

export interface AiInsight {
  summary: string;
  importantObservations: string[];
  abnormalValues: AiAbnormalValue[];
  lifestyleRecommendations: string[];
  dietRecommendations: string[];
  exerciseRecommendations: string[];
  doctorQuestions: string[];
  severity: "LOW" | "MEDIUM" | "HIGH";
  confidence: number;
}

/** Pulls the first balanced JSON object out of a possibly-noisy string. */
function extractJson(content: string): Record<string, unknown> | null {
  if (!content) return null;
  // Strip markdown code fences if present.
  const cleaned = content
    .replace(/```(?:json)?/gi, "")
    .trim();
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

function normalizeInsight(raw: Record<string, unknown>): AiInsight {
  const severityRaw = String(raw.severity ?? "").toUpperCase();
  const severity: AiInsight["severity"] = ["LOW", "MEDIUM", "HIGH"].includes(severityRaw)
    ? (severityRaw as AiInsight["severity"])
    : "LOW";

  const confidenceRaw = Number(raw.confidence ?? raw.confidence_score);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
    : 0;

  let abnormalValues: AiAbnormalValue[] = [];
  if (Array.isArray(raw.abnormal_values)) {
    abnormalValues = raw.abnormal_values
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        metric: String(item.metric ?? "Unknown"),
        value: typeof item.value === "number" ? item.value : String(item.value ?? ""),
        unit: typeof item.unit === "string" ? item.unit : null,
        status: typeof item.status === "string" ? item.status.toLowerCase() : "normal",
      }))
      .filter((item) => item.metric && item.value !== "")
      .slice(0, 12);
  }

  return {
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : "",
    importantObservations: stringArray(raw.important_observations),
    abnormalValues,
    lifestyleRecommendations: stringArray(raw.lifestyle_recommendations),
    dietRecommendations: stringArray(raw.diet_suggestions),
    exerciseRecommendations: stringArray(raw.exercise_suggestions),
    doctorQuestions: stringArray(raw.doctor_questions),
    severity,
    confidence,
  };
}
