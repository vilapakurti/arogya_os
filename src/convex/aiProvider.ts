"use node";

/**
 * Shared AI provider layer with automatic fallback (ArogyaOS).
 *
 * Every AI feature (report analysis, Doctor Copilot brief, Ask Doctor
 * Copilot chat, Voice Assistant) routes its LLM call through this one module:
 *
 *   Request → try Gemini (primary) → on retryable failure → try OpenRouter
 *
 * Both providers are normalized into the exact same shape before the caller
 * sees them, so the frontend never knows (or cares) which provider produced
 * the response — and no provider-specific logic leaks into the actions.
 *
 * Provider priority + fallback triggers:
 *   1. Gemini (GEMINI_API_KEY / GEMINI_MODEL)
 *   2. OpenRouter (OPENROUTER_API_KEY / OPENROUTER_MODEL)
 *   Falls back on: HTTP 429 + RESOURCE_EXHAUSTED (quota), 500/502/503/504,
 *   timeouts, network failures, rejected/invalid API keys (401/403), and
 *   unknown/missing models (404 / invalid-model 400).
 *
 * Security: API keys are read from process.env ONLY — they live on the Convex
 * server and are never sent to the browser or included in any result.
 *
 * Environment variables (Keys tab / Convex env):
 *   GEMINI_API_KEY      — Google AI Studio API key (primary, optional if OpenRouter set)
 *   GEMINI_MODEL        — optional, default "gemini-3.6-flash"
 *   OPENROUTER_API_KEY  — OpenRouter API key (fallback, optional if Gemini set)
 *   OPENROUTER_MODEL    — optional, default "qwen/qwen3-235b-a22b:free"
 */

export type AiProvider = "gemini" | "openrouter";

/** Everything an AI action needs to make one LLM call (provider-agnostic). */
export interface AiProviderRequest {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the provider for strict JSON output. Both providers support it. */
  jsonMode?: boolean;
  timeoutMs?: number;
}

export type AiProviderErrorCode =
  | "not_configured"
  | "rate_limited"
  | "timeout"
  | "network"
  | "server"
  | "model_error";

export interface AiProviderSuccess {
  ok: true;
  /** Raw text response — identical schema regardless of provider. */
  text: string;
  provider: AiProvider;
  /** Effective model identifier actually used (for model_used / logs). */
  model: string;
  /** Gemini finishReason / OpenRouter finish_reason (e.g. "MAX_TOKENS"). */
  finishReason?: string;
}

export interface AiProviderFailure {
  ok: false;
  code: AiProviderErrorCode;
  message: string;
  /** Which provider produced this failure (undefined when none configured). */
  provider?: AiProvider;
}

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3-235b-a22b:free";

const DEFAULT_TIMEOUT_MS = 75_000;
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 15_000;

/** Honest explanation for quota exhaustion (the recurring 429 root cause). */
const QUOTA_EXHAUSTED_MESSAGE =
  "The AI service's free-tier request quota is used up for today (Gemini free keys allow ~20 requests/day). " +
  "It resets daily — try again later, or add a Gemini API key with billing enabled in the Keys tab.";

function fail(
  code: AiProviderErrorCode,
  message: string,
  provider?: AiProvider,
): AiProviderFailure {
  return { ok: false, code, message, provider };
}

function isTimeout(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return name === "TimeoutError" || name === "AbortError" || /timeout/i.test(String(err));
}

/** Waits using the server's own "retry in Xs" hint when present (capped). */
async function backoff(res: Response, attempt: number): Promise<void> {
  const body = await res.clone().text().catch(() => "");
  const match = body.match(/retry in ([0-9.]+)s/i);
  const serverDelay = match ? Math.round(parseFloat(match[1]) * 1000) : 0;
  const delay = serverDelay > 0 ? serverDelay : 3_000 * (attempt + 1);
  await new Promise((resolve) => setTimeout(resolve, Math.min(delay, MAX_RETRY_DELAY_MS)));
}

/* ------------------------------------------------------------------ */
/* Gemini (primary)                                                    */
/* ------------------------------------------------------------------ */

async function attemptGemini(
  req: AiProviderRequest,
  key: string,
): Promise<AiProviderSuccess | AiProviderFailure> {
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    system_instruction: { parts: [{ text: req.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: req.userMessage }] }],
    generationConfig: {
      temperature: req.temperature ?? 0.3,
      maxOutputTokens: req.maxOutputTokens ?? 2048,
      ...(req.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      if (isTimeout(err)) {
        return fail(
          "timeout",
          "The AI took too long to respond (Gemini timed out).",
          "gemini",
        );
      }
      return fail(
        "network",
        "Could not reach the AI service (Gemini network error).",
        "gemini",
      );
    }

    // Transient capacity / throttling — retry with the server's own delay.
    if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
      lastRes = res;
      if (attempt < MAX_RETRIES) {
        await backoff(res, attempt);
        continue;
      }
      const errText = await res.clone().text().catch(() => "");
      if (res.status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(errText)) {
        return fail("rate_limited", QUOTA_EXHAUSTED_MESSAGE, "gemini");
      }
      return fail(
        "server",
        `The AI service returned an error (Gemini HTTP ${res.status}).`,
        "gemini",
      );
    }

    // Invalid / expired key → fall back (never leak the key in the message).
    if (res.status === 401 || res.status === 403) {
      return fail(
        "not_configured",
        "The Gemini API key was rejected. Check GEMINI_API_KEY in the Keys tab.",
        "gemini",
      );
    }

    // Missing / unsupported model → fall back.
    if (res.status === 404) {
      return fail(
        "model_error",
        `The Gemini model "${model}" was not found (HTTP 404). Set GEMINI_MODEL in the Keys tab to a model your key can use.`,
        "gemini",
      );
    }

    if (res.status === 400) {
      const errText = await res.text().catch(() => "");
      if (/not found|not supported|does not exist|not available|invalid model/i.test(errText)) {
        return fail(
          "model_error",
          `The Gemini model "${model}" was rejected (HTTP 400): ${errText.slice(0, 200)}`,
          "gemini",
        );
      }
      return fail(
        "server",
        `The AI service rejected the request (Gemini HTTP 400): ${errText.slice(0, 200)}`,
        "gemini",
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return fail(
        "server",
        `The AI service returned an error (Gemini HTTP ${res.status})${
          errText ? `: ${errText.slice(0, 200)}` : ""
        }.`,
        "gemini",
      );
    }

    // Success — extract every part (thinking models emit a thought part first).
    const parsed = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };
    const candidates = parsed.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      const blockReason = parsed.promptFeedback?.blockReason;
      return fail(
        "server",
        `The AI returned no content${
          blockReason ? ` (blocked by safety filter: ${blockReason})` : ""
        }.`,
        "gemini",
      );
    }
    const parts = candidates[0]?.content?.parts ?? [];
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n");
    if (!text.trim()) {
      return fail("server", "The AI returned an empty response.", "gemini");
    }
    return {
      ok: true,
      text,
      provider: "gemini",
      model,
      finishReason: candidates[0]?.finishReason ?? undefined,
    };
  }
  return fail("server", "The AI service is temporarily unavailable (Gemini).", "gemini");
}

/* ------------------------------------------------------------------ */
/* OpenRouter (fallback)                                               */
/* ------------------------------------------------------------------ */

async function attemptOpenRouter(
  req: AiProviderRequest,
  key: string,
): Promise<AiProviderSuccess | AiProviderFailure> {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const baseBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.userMessage },
    ],
    temperature: req.temperature ?? 0.3,
    max_tokens: req.maxOutputTokens ?? 2048,
  };
  const withJson = req.jsonMode ? { ...baseBody, response_format: { type: "json_object" } } : baseBody;

  // Some models reject response_format — retry the same request without it.
  const attempts: Array<Record<string, unknown>> = req.jsonMode
    ? [withJson, baseBody]
    : [baseBody];

  for (const attemptBody of attempts) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let res: Response;
      try {
        res = await fetch(OPENROUTER_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            "HTTP-Referer": "https://arogyaos.app",
            "X-Title": "ArogyaOS",
          },
          body: JSON.stringify(attemptBody),
          signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (err) {
        if (isTimeout(err)) {
          return fail(
            "timeout",
            "The AI took too long to respond (OpenRouter timed out).",
            "openrouter",
          );
        }
        return fail(
          "network",
          "Could not reach the AI service (OpenRouter network error).",
          "openrouter",
        );
      }

      if (res.status === 429) {
        if (attempt < MAX_RETRIES) {
          await backoff(res, attempt);
          continue;
        }
        return fail(
          "rate_limited",
          "OpenRouter is rate-limited right now. Try again in a moment.",
          "openrouter",
        );
      }
      if (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
        if (attempt < MAX_RETRIES) {
          await backoff(res, attempt);
          continue;
        }
        return fail(
          "server",
          `The AI service returned an error (OpenRouter HTTP ${res.status}).`,
          "openrouter",
        );
      }

      if (res.status === 401 || res.status === 403) {
        return fail(
          "not_configured",
          "The OpenRouter API key was rejected. Check OPENROUTER_API_KEY in the Keys tab.",
          "openrouter",
        );
      }
      if (res.status === 404) {
        return fail(
          "model_error",
          `The OpenRouter model "${model}" was not found (HTTP 404). Set OPENROUTER_MODEL in the Keys tab to a model your key can use.`,
          "openrouter",
        );
      }
      if (res.status === 400) {
        const errText = await res.text().catch(() => "");
        // The model may not support JSON mode — drop response_format and retry.
        if (/response_format|json.?object/i.test(errText) && attemptBody !== baseBody) {
          break;
        }
        if (/model|not found|not supported/i.test(errText)) {
          return fail(
            "model_error",
            `The OpenRouter model "${model}" was rejected (HTTP 400): ${errText.slice(0, 200)}`,
            "openrouter",
          );
        }
        return fail(
          "server",
          `OpenRouter rejected the request (HTTP 400): ${errText.slice(0, 200)}`,
          "openrouter",
        );
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return fail(
          "server",
          `OpenRouter returned an error (HTTP ${res.status})${
            errText ? `: ${errText.slice(0, 200)}` : ""
          }.`,
          "openrouter",
        );
      }

      const parsed = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string | Array<{ text?: string }> };
          finish_reason?: string;
        }>;
      };
      const content = parsed.choices?.[0]?.message?.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        text = content
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .join("");
      }
      if (!text.trim()) {
        return fail("server", "OpenRouter returned an empty response.", "openrouter");
      }
      return {
        ok: true,
        text,
        provider: "openrouter",
        model,
        finishReason: parsed.choices?.[0]?.finish_reason ?? undefined,
      };
    }
  }
  return fail("server", "The AI service is temporarily unavailable (OpenRouter).", "openrouter");
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Runs the request against Gemini first, then OpenRouter if Gemini fails with
 * a retryable/fallback-eligible error. Returns the normalized result — the
 * caller cannot tell which provider produced it from the schema alone.
 */
export async function generateWithProviderFallback(
  req: AiProviderRequest,
): Promise<AiProviderSuccess | AiProviderFailure> {
  const startedAt = Date.now();
  const geminiKey = process.env.GEMINI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  let lastFailure: AiProviderFailure | null = null;

  // 1. Gemini — primary provider.
  if (geminiKey) {
    const result = await attemptGemini(req, geminiKey);
    if (result.ok) {
      console.log(
        `[ai-provider] Successful provider: gemini (model=${result.model}, textBytes=${Buffer.byteLength(
          result.text,
          "utf8",
        )}, elapsedMs=${Date.now() - startedAt})`,
      );
      return result;
    }
    lastFailure = result;
    console.warn(
      `[ai-provider] Gemini failed (code=${result.code}) — trying OpenRouter fallback.`,
    );
  } else {
    console.log("[ai-provider] GEMINI_API_KEY not set — starting with OpenRouter.");
  }

  // 2. OpenRouter — fallback provider.
  if (openRouterKey) {
    const result = await attemptOpenRouter(req, openRouterKey);
    if (result.ok) {
      console.log(
        `[ai-provider] Successful provider: openrouter (model=${result.model}, textBytes=${Buffer.byteLength(
          result.text,
          "utf8",
        )}, elapsedMs=${Date.now() - startedAt})`,
      );
      return result;
    }
    lastFailure = result;
    console.warn(
      `[ai-provider] OpenRouter also failed (code=${result.code}) — both providers exhausted.`,
    );
  }

  if (lastFailure) return lastFailure;

  return fail(
    "not_configured",
    "No AI provider is configured. Add GEMINI_API_KEY or OPENROUTER_API_KEY in the Keys tab (Convex env).",
  );
}

/**
 * Maps a provider failure onto the action-level error codes the frontend
 * already understands, so all three actions handle failures identically.
 */
export function mapProviderFailure(
  failure: AiProviderFailure,
): { code: AiProviderErrorCode; message: string } {
  switch (failure.code) {
    case "rate_limited":
      return { code: "rate_limited", message: failure.message };
    case "timeout":
      return { code: "timeout", message: "The AI took too long to respond. Please try again." };
    case "network":
      return { code: "network", message: "Could not reach the AI service. Check your connection." };
    case "model_error":
      return { code: "model_error", message: failure.message };
    case "server":
      return { code: "server", message: failure.message };
    case "not_configured":
    default:
      return { code: "not_configured", message: failure.message };
  }
}
