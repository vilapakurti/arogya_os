"use node";

/**
 * Doctor Copilot — "Ask Doctor Copilot" (conversational AI assistant).
 *
 * Secure Google Gemini action for the interactive chat panel on the Doctor
 * Copilot page. It answers a patient's questions using their OWN health data:
 * uploaded reports, extracted OCR text, parsed health metrics, previous AI
 * analyses, personal baselines, and the latest-report comparison.
 *
 * Security model (mirrors insights.ts / baselines.ts / copilot.ts):
 *  - The caller's Supabase access token is verified server-side against the
 *    Supabase Auth endpoint — the action never trusts the client identity.
 *  - The health snapshot is assembled client-side exclusively from existing
 *    RLS-scoped queries (the signed-in user's own reports/metrics/insights/
 *    baselines), so it can only ever contain that user's data.
 *  - Conversation history is session-scoped and never persisted anywhere.
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
const GEMINI_TIMEOUT_MS = 75_000;
const MAX_HISTORY_TURNS = 10;
const MAX_OCR_CHARS = 3_000;

const CHAT_SYSTEM_PROMPT = `You are "Arogya Copilot", a supportive preventive-health assistant inside ArogyaOS. You help a patient understand their own medical history and prepare for a doctor visit.

The patient provides a snapshot of their OWN health data: number of reports, latest report details, tracked metrics, improving/worsening metrics, an overall risk level (already computed deterministically), abnormal findings, milestones, per-metric comparisons (latest vs previous vs personal baseline vs population reference range), an excerpt of the latest report's extracted OCR text, and summaries of previous AI analyses.

Rules you must follow:
- Answer ONLY from the provided health snapshot. Never invent values, tests, medications, or findings that are not in the snapshot.
- If the snapshot lacks what they ask about, say so plainly, e.g. "I don't have data on that in your uploaded reports."
- Never diagnose disease or prescribe treatment. Frame everything as observations and always encourage confirming with a doctor.
- Be concise and reassuring: 2-6 short paragraphs or a few bullets.
- If the question is unrelated to their health data, gently bring the conversation back to their reports.`;

export type CopilotChatErrorCode =
  | "not_configured"
  | "model_error"
  | "unauthorized"
  | "empty_input"
  | "rate_limited"
  | "timeout"
  | "network"
  | "invalid_json"
  | "server";

export type CopilotChatOutcome =
  | {
      ok: true;
      reply: string;
      model: string;
      processingTimeMs: number;
    }
  | { ok: false; code: CopilotChatErrorCode; message: string };

export const chat = action({
  args: {
    accessToken: v.string(),
    question: v.string(),
    history: v.array(
      v.object({
        role: v.string(),
        content: v.string(),
      }),
    ),
    context: v.object({
      reportCount: v.number(),
      latestReportTitle: v.optional(v.union(v.string(), v.null())),
      latestReportDate: v.optional(v.union(v.string(), v.null())),
      metricsTracked: v.array(v.string()),
      improvingMetrics: v.array(v.string()),
      worseningMetrics: v.array(v.string()),
      overallRiskLevel: v.string(),
      abnormalFindings: v.array(v.string()),
      milestones: v.array(v.string()),
      metricComparisons: v.array(
        v.object({
          label: v.string(),
          unit: v.optional(v.union(v.string(), v.null())),
          latestValue: v.optional(v.union(v.number(), v.null())),
          previousValue: v.optional(v.union(v.number(), v.null())),
          personalBaseline: v.optional(v.union(v.number(), v.null())),
          populationMin: v.optional(v.union(v.number(), v.null())),
          populationMax: v.optional(v.union(v.number(), v.null())),
        }),
      ),
      latestOcrExcerpt: v.optional(v.union(v.string(), v.null())),
      previousSummaries: v.array(v.string()),
    }),
  },
  handler: async (_ctx, args): Promise<CopilotChatOutcome> => {
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    const fail = (code: CopilotChatErrorCode, message: string): CopilotChatOutcome => ({
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

    // 2. Empty question guard.
    const question = args.question.trim();
    if (!question) {
      return fail("empty_input", "Ask a question about your health data first.");
    }

    // 3. Call Gemini with the health snapshot + conversation history.
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const historyBlock = args.history
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => `${m.role === "user" ? "Patient" : "Arogya Copilot"}: ${m.content}`)
      .join("\n\n");

    const userMessage = [
      "The patient asks a question about their health. Answer using ONLY the snapshot below and the conversation so far.",
      "",
      "=== PATIENT'S HEALTH SNAPSHOT (from their own ArogyaOS records) ===",
      JSON.stringify(
        {
          ...args.context,
          latestOcrExcerpt: (args.context.latestOcrExcerpt ?? "").slice(0, MAX_OCR_CHARS),
        },
        null,
        1,
      ),
      "",
      "=== CONVERSATION SO FAR ===",
      historyBlock || "(no previous messages)",
      "",
      "=== PATIENT'S QUESTION ===",
      question,
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
            system_instruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 1024,
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
    const reply = rawContent.trim();
    if (!reply) {
      return fail("invalid_json", "The AI returned an empty response. Please try again.");
    }

    return { ok: true, reply, model, processingTimeMs };
  },
});
