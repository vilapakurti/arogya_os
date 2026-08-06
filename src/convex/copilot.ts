"use node";

/**
 * Doctor Copilot (AI Visit Assistant) — secure AI action.
 *
 * Produces the "AI Consultation Brief": a plain-language briefing that helps a
 * patient prepare for a doctor visit, generated from their own health history.
 *
 * The deterministic analysis (latest vs previous report, personal baseline,
 * improving/worsening metrics, milestones, abnormal findings) is computed on
 * the client by src/lib/copilot.ts using the shared timeline/trends/APBE
 * modules. This action only receives those already-computed, non-sensitive
 * statistics plus the previous AI summaries, and asks the LLM for the
 * consultation narrative. It never touches ai_insights and never modifies any
 * table — it is read/stateless.
 *
 * The LLM call goes through the shared `aiProvider` module
 * (src/convex/aiProvider.ts): Gemini primary, OpenRouter automatic fallback on
 * quota (429 / RESOURCE_EXHAUSTED), 5xx, timeout, network, or invalid
 * key/model. The response schema is identical regardless of provider.
 *
 * Security model (mirrors insights.ts / baselines.ts):
 *  - The caller's Supabase access token is verified server-side against the
 *    Supabase Auth endpoint.
 *  - Only computed numeric statistics + short text summaries are sent — never
 *    raw report files or OCR text.
 *  - The AI keys live only in process.env on the Convex server.
 *
 * Environment variables (Keys tab / Convex env):
 *   GEMINI_API_KEY       — Google AI Studio API key (primary provider)
 *   GEMINI_MODEL         — optional, default "gemini-3.6-flash"
 *   OPENROUTER_API_KEY   — OpenRouter API key (automatic fallback provider)
 *   OPENROUTER_MODEL     — optional, default "qwen/qwen3-235b-a22b:free"
 *   SUPABASE_URL         — e.g. https://<project>.supabase.co (required)
 *   SUPABASE_ANON_KEY    — publishable anon key (required, used with the user JWT)
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
import {
  generateWithProviderFallback,
  mapProviderFailure,
  type AiProvider,
} from "./aiProvider";

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
      provider: AiProvider;
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

    const fail = (code: CopilotErrorCode, message: string): CopilotOutcome => ({
      ok: false,
      code,
      message,
    });

    if (!process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY) {
      return fail(
        "not_configured",
        "No AI provider is configured. Add GEMINI_API_KEY or OPENROUTER_API_KEY in the Keys tab (Convex env).",
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

    // 3. Call the AI provider layer (Gemini → OpenRouter fallback).
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
    const result = await generateWithProviderFallback({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      temperature: 0.4,
      maxOutputTokens: 4096,
      jsonMode: true,
    });

    if (!result.ok) {
      const mapped = mapProviderFailure(result);
      return fail(mapped.code, mapped.message);
    }

    const rawContent = result.text;
    const model = result.model;
    const provider: AiProvider = result.provider;
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
      provider,
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
