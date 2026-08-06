"use node";

/**
 * Doctor Copilot (AI Visit Assistant) — secure Google Gemini action.
 *
 * Produces the "AI Consultation Brief": a plain-language briefing that helps a
 * patient prepare for a doctor visit, generated from their own health history.
 *
 * The deterministic analysis (latest vs previous report, personal baseline,
 * improving/worsening metrics, milestones, abnormal findings) is computed on
 * the client by src/lib/copilot.ts using the shared timeline/trends/APBE
 * modules. This action only receives those already-computed, non-sensitive
 * statistics plus the previous AI summaries, and asks Gemini for the
 * consultation narrative. It never touches ai_insights and never modifies any
 * table — it is read/stateless.
 *
 * Security model (mirrors insights.ts / baselines.ts):
 *  - The caller's Supabase access token is verified server-side against the
 *    Supabase Auth endpoint.
 *  - Only computed numeric statistics + short text summaries are sent — never
 *    raw report files or OCR text.
 *  - The Gemini API key lives only in process.env on the Convex server.
 *
 * Resilience: Gemini's free tier throttles with HTTP 429 (and capacity blips
 * with 503). `fetchWithGeminiRetry` retries those responses with the delay
 * Google itself suggests (capped); a genuinely exhausted DAILY quota still
 * returns `rate_limited` with an honest message.
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
const GEMINI_TIMEOUT_MS = 75_000;
const MAX_GEMINI_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 15_000;

/** Retries 429/503 Gemini responses, honoring Google's "retry in Xs" hint. */
async function fetchWithGeminiRetry(url: string, init: RequestInit): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= MAX_GEMINI_RETRIES; attempt += 1) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status !== 503) return res;
    lastRes = res;
    if (attempt < MAX_GEMINI_RETRIES) {
      const body = await res.clone().text().catch(() => "");
      const match = body.match(/retry in ([0-9.]+)s/i);
      const serverDelay = match ? Math.round(parseFloat(match[1]) * 1000) : 0;
      const delay = serverDelay > 0 ? serverDelay : 3_000 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, MAX_RETRY_DELAY_MS)));
    }
  }
  return lastRes as Response;
}

/** Human explanation for free-tier quota exhaustion (the common 429 cause). */
const QUOTA_EXHAUSTED_MESSAGE =
  "The AI service's free-tier request quota is used up for today (Gemini free keys allow ~20 requests/day). " +
  "It resets daily — try again later, or add a Gemini API key with billing enabled in the Keys tab.";

const SYSTEM_PROMPT = `You are a supportive preventive-health assistant helping a patient prepare for an upcoming doctor visit.

You are given the patient's computed health history: how many reports they have, the latest report date, metrics being tracked, improving and worsening metrics, an overall risk level (already derived deterministically), abnormal findings, notable milestones, per-metric comparisons (latest vs previous vs personal baseline vs population reference range), and brief summaries of previous AI analyses.

Rules:
- Write plainly and reassuringly; never diagnose disease.
- Always frame findings as observations and encourage confirming with a doctor.
- Suggested follow-up tests are EDUCATIONAL ONLY — never prescribe.
- Respond with ONLY a single JSON object. No markdown, no code fences, no commentary.

The JSON must match EXACTLY this schema:
{
  "overall_summary": "string — 2 to 4 sentences summarizing the patient's current health picture across reports",
  "health_progress": "string — 1 to 2 sentences describing progress or regression since previous reports",
  "important_changes": ["string — notable changes since the last report"],
  "doctor_discussion_points": ["string — concise discussion points for the visit, at most 6"],
  "recommended_questions": ["string — questions the patient should ask their doctor, at most 6"],
  "follow_up_tests": ["string — educational suggested follow-up tests, at most 5"],
  "risk_level": "LOW" | "MODERATE" | "ELEVATED" | "HIGH",
  "confidence": "integer 0-100"
}`;

export type CopilotErrorCode =
  | "not_configured"
  | "model_error"
  | "unauthorized"
  | "empty_input"
  | "rate_limited"
  | "timeout"
  | "network"
  | "invalid_json"
  | "server";

export type CopilotRiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH";

export interface CopilotBrief {
  overallSummary: string;
  healthProgress: string;
  importantChanges: string[];
  doctorDiscussionPoints: string[];
  recommendedQuestions: string[];
  followUpTests: string[];
  riskLevel: CopilotRiskLevel;
  confidence: number;
}

export type CopilotOutcome =
  | {
      ok: true;
      brief: CopilotBrief;
      raw: string;
      model: string;
      processingTimeMs: number;
    }
  | { ok: false; code: CopilotErrorCode; message: string };

export const generate = action({
  args: {
    accessToken: v.string(),
    input: v.object({
      reportCount: v.number(),
      latestReportDate: v.optional(v.union(v.string(), v.null())),
      metricsTracked: v.array(v.string()),
      improvingMetrics: v.array(v.string()),
      worseningMetrics: v.array(v.string()),
      overallRiskLevel: v.string(),
      abnormalFindings: v.array(v.string()),
      milestones: v.array(v.string()),
      metricComparisons: v.array(
        v.object({
          metricName: v.string(),
          label: v.string(),
          unit: v.optional(v.union(v.string(), v.null())),
          latestValue: v.optional(v.union(v.number(), v.null())),
          previousValue: v.optional(v.union(v.number(), v.null())),
          personalBaseline: v.optional(v.union(v.number(), v.null())),
          populationMin: v.optional(v.union(v.number(), v.null())),
          populationMax: v.optional(v.union(v.number(), v.null())),
        }),
      ),
      previousSummaries: v.array(v.string()),
    }),
  },
  handler: async (_ctx, args): Promise<CopilotOutcome> => {
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    const fail = (code: CopilotErrorCode, message: string): CopilotOutcome => ({
      ok: false,
      code,
      message,
    });

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

    // 2. Empty input guard — the deterministic analysis needs at least one report.
    if (args.input.reportCount < 1 || args.input.metricComparisons.length === 0) {
      return fail(
        "empty_input",
        "There is not enough health data yet. Upload at least one processed report first.",
      );
    }

    // 3. Call Gemini with the deterministic statistics.
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const userMessage = [
      "Here is the patient's computed health history. Please write the consultation brief.",
      "",
      "=== HEALTH OVERVIEW ===",
      JSON.stringify(
        {
          reportCount: args.input.reportCount,
          latestReportDate: args.input.latestReportDate ?? null,
          metricsTracked: args.input.metricsTracked,
          improvingMetrics: args.input.improvingMetrics,
          worseningMetrics: args.input.worseningMetrics,
          overallRiskLevel: args.input.overallRiskLevel,
        },
        null,
        1,
      ),
      "",
      "=== PER-METRIC COMPARISONS (latest / previous / personal baseline / population) ===",
      JSON.stringify(args.input.metricComparisons, null, 1),
      "",
      "=== ABNORMAL FINDINGS ===",
      JSON.stringify(args.input.abnormalFindings, null, 1),
      "",
      "=== MILESTONES ===",
      JSON.stringify(args.input.milestones, null, 1),
      "",
      "=== PREVIOUS AI SUMMARIES ===",
      JSON.stringify(args.input.previousSummaries, null, 1),
      "",
      "Return the JSON consultation brief exactly as instructed.",
    ].join("\n");

    const startedAt = Date.now();
    let rawContent = "";
    try {
      const res = await fetchWithGeminiRetry(
        `${GEMINI_ENDPOINT}/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 4096,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        },
      );

      if (res.status === 429) {
        return fail("rate_limited", QUOTA_EXHAUSTED_MESSAGE);
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
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
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

function stringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, max)
    .map((item) => item.trim());
}

function normalizeBrief(raw: Record<string, unknown>): CopilotBrief {
  const riskRaw = String(raw.risk_level ?? "").toUpperCase();
  const riskLevel: CopilotRiskLevel = ["LOW", "MODERATE", "ELEVATED", "HIGH"].includes(riskRaw)
    ? (riskRaw as CopilotRiskLevel)
    : "LOW";

  const confidenceRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
    : 0;

  return {
    overallSummary:
      typeof raw.overall_summary === "string" && raw.overall_summary.trim()
        ? raw.overall_summary.trim()
        : "",
    healthProgress:
      typeof raw.health_progress === "string" && raw.health_progress.trim()
        ? raw.health_progress.trim()
        : "",
    importantChanges: stringArray(raw.important_changes),
    doctorDiscussionPoints: stringArray(raw.doctor_discussion_points, 6),
    recommendedQuestions: stringArray(raw.recommended_questions, 6),
    followUpTests: stringArray(raw.follow_up_tests, 5),
    riskLevel,
    confidence,
  };
}
