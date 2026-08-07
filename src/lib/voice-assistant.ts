import { fetchPersonalBaselines } from "@/lib/baseline-data";
import {
  buildCopilotAnalysis,
  buildCopilotChatContext,
  fetchCopilotData,
  fetchLatestOcrExcerpt,
  fetchPreviousAiSummaries,
  generateCopilotChat,
  type CopilotAnalysis,
  type CopilotChatContext,
  type PreviousAiSummary,
} from "@/lib/copilot";
import {
  evaluatePatient,
  toClinicalProfile,
  type ClinicalProfile,
  type ProfileLike,
} from "@/lib/clinical";

/**
 * AI Voice Health Assistant — client data layer.
 *
 * The voice assistant is a VOICE INTERFACE over the existing ArogyaOS AI
 * stack — it deliberately does not create a new Gemini endpoint or duplicate
 * any data logic:
 *
 *  - Context awareness: before any question reaches Gemini, the assistant
 *    auto-collects the user's latest report, health metrics, personal
 *    baselines (APBE), previous AI analyses, the health-journey timeline and
 *    the latest OCR excerpt — by reusing `fetchCopilotData`,
 *    `fetchPersonalBaselines`, `fetchPreviousAiSummaries`,
 *    `fetchLatestOcrExcerpt`, `buildCopilotAnalysis` and
 *    `buildCopilotChatContext` from the Doctor Copilot stack.
 *  - CDSS: every metric passes through the Clinical Decision Support Engine
 *    (via `buildCopilotAnalysis` → `evaluateReport`), and the patient profile
 *    is consumed through `evaluatePatient` so the assistant answers with
 *    interpreted clinical context (meaning, severity, risk, recommendations),
 *    not raw values.
 *  - AI: the compact snapshot is sent to the existing secure `copilotChat:chat`
 *    Convex action, which verifies the Supabase session server-side and calls
 *    Gemini with the project's existing configuration. No keys ever touch the
 *    client. Never another user's data: every read is RLS-scoped to the
 *    signed-in user.
 *  - Persistence: conversation history is kept for the current browser
 *    session only (component + sessionStorage) — never written to a database.
 */

export interface VoiceSnapshot {
  /** Deterministic visit analysis (latest vs previous, trends, baselines). */
  analysis: CopilotAnalysis;
  previousSummaries: PreviousAiSummary[];
  /** The health snapshot sent to the copilotChat:chat action. */
  chatContext: CopilotChatContext;
  reportCount: number;
}

/**
 * Loads everything the assistant needs in one shot, reusing the existing
 * Doctor Copilot queries (no new database reads). `reportCount === 0`
 * signals the empty state.
 *
 * `clinicalProfile` (optional) is the stored patient profile row. The CDSS
 * personalizes every interpretation against it — reference ranges by
 * age/gender/pregnancy/known conditions, plus a whole-person risk summary via
 * `evaluatePatient` — so the assistant speaks with clinical context rather
 * than raw values. Pass `null` (or omit) when the profile is unavailable;
 * the engine then falls back to population defaults, keeping the feature
 * fully backward compatible.
 */
export async function loadVoiceSnapshot(
  userId: string,
  clinicalProfile?: ProfileLike | null,
): Promise<VoiceSnapshot> {
  const [copilotData, baselineRows, summaries] = await Promise.all([
    fetchCopilotData(userId),
    fetchPersonalBaselines(userId).catch(() => []),
    fetchPreviousAiSummaries(userId).catch(() => [] as PreviousAiSummary[]),
  ]);
  const profile: ClinicalProfile = toClinicalProfile(clinicalProfile);
  const analysis = buildCopilotAnalysis(
    copilotData.reports,
    copilotData.metrics,
    baselineRows.length,
    profile,
  );
  const latestOcr = await fetchLatestOcrExcerpt(userId).catch(() => null);
  const chatContext = buildCopilotChatContext(analysis, summaries, latestOcr);
  // The Voice Assistant must also consume the CDSS patient evaluation before
  // generating speech: append the whole-person risk summary to the snapshot.
  const patient = evaluatePatient(profile, analysis.cdss);
  chatContext.clinicalHighlights = [chatContext.clinicalHighlights ?? "", `Patient risk summary: ${patient.summary}`]
    .filter(Boolean)
    .join("\n");
  return { analysis, previousSummaries: summaries, chatContext, reportCount: analysis.reportCount };
}

/** One bubble in the assistant conversation (session-scoped). */
export interface VoiceMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/** Clickable suggestions mapped to natural prompts. */
export const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: "Explain Latest Report", prompt: "Explain my latest report." },
  { label: "Health Journey Summary", prompt: "Summarize my health journey." },
  { label: "Doctor Visit Brief", prompt: "What should I ask my doctor?" },
  { label: "What changed?", prompt: "What changed since my last report?" },
  {
    label: "Diet Suggestions",
    prompt: "What should I eat or avoid based on my latest report?",
  },
  { label: "Exercise Advice", prompt: "What exercise would be safe for me right now?" },
  { label: "Health Score", prompt: "How is my overall health right now?" },
  { label: "Compare Reports", prompt: "Compare my latest report with my previous one." },
];

export type VoiceSendOutcome =
  | { ok: true; reply: string }
  | { ok: false; code: string; message: string };

/**
 * Sends one turn to the existing `copilotChat:chat` action. History is the
 * conversation BEFORE the new question (the user message is appended by the
 * caller). Never throws for AI failures — returns a structured outcome.
 */
export async function sendVoiceMessage(opts: {
  accessToken: string;
  question: string;
  history: VoiceMessage[];
  chatContext: CopilotChatContext;
}): Promise<VoiceSendOutcome> {
  const outcome = await generateCopilotChat(
    opts.accessToken,
    opts.question,
    opts.history.map((m) => ({ role: m.role, content: m.content })),
    opts.chatContext,
  );
  if (outcome.ok) return { ok: true, reply: outcome.reply };
  return { ok: false, code: outcome.code, message: outcome.message };
}

/** Maps structured error codes to friendly, non-alarming messages. */
export function friendlyAssistantError(code: string, message: string): string {
  switch (code) {
    case "not_configured":
      return "The AI isn’t configured on the server yet (GEMINI_API_KEY missing). Your data is still safe.";
    case "unauthorized":
      return "Your session could not be verified. Please sign in again.";
    case "rate_limited":
      return "The AI service’s free-tier request quota is used up for today. It resets daily — try again later, or add a Gemini API key with billing enabled in the Keys tab.";
    case "timeout":
      return "The AI took too long to answer. Please try again.";
    case "empty_input":
      return message;
    default:
      return message || "Something went wrong. Please try again.";
  }
}
