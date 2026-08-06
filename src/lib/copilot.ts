import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { computeBaseline, isImprovingDirection } from "@/lib/baselines";
import {
  fetchAllReports,
  fetchMetricsForUser,
  type TimelineMetric,
  type TimelineReport,
} from "@/lib/timeline";
import { getSupabase } from "@/lib/supabase";

/**
 * Doctor Copilot (AI Visit Assistant) — client data layer + deterministic
 * analysis.
 *
 * The feature reuses the existing modules instead of duplicating logic:
 *  - timeline.ts       → fetchAllReports / fetchMetricsForUser
 *  - baselines.ts      → computeBaseline (personal baseline, z-score, trend)
 *  - insights.ts / ai_insights → previous AI summaries
 *  - baseline-data.ts  → personal_baselines rows
 *
 * `buildCopilotAnalysis` is a pure function: it turns the raw rows into the
 * visit brief inputs (latest vs previous comparison, improving/worsening
 * metrics, milestones, abnormal findings, top-5 lists). `generateCopilotBrief`
 * sends those computed statistics to the secure Convex action
 * `copilot:generate` (src/convex/copilot.ts), which asks the AI layer for the
 * plain-language consultation narrative. The action transparently falls back
 * between providers (Gemini primary, OpenRouter secondary) — the client never
 * knows or chooses the provider.
 *
 * "Ask Doctor Copilot" (the interactive chat panel) reuses the same data:
 * `fetchLatestOcrExcerpt` + `buildCopilotChatContext` assemble a compact
 * health snapshot (reports, OCR, metrics, baselines, AI summaries,
 * comparisons) and `generateCopilotChat` sends it to the secure
 * `copilotChat:chat` action (src/convex/copilotChat.ts). All reads are
 * RLS-scoped to the signed-in user — no other user's data can enter the
 * snapshot.
 */

/* ------------------------------------------------------------------ */
/* Shared metric metadata                                              */
/* ------------------------------------------------------------------ */

const METRIC_LABELS: Record<string, string> = {
  hemoglobin: "Hemoglobin",
  blood_glucose: "Blood Sugar",
  hba1c: "HbA1c",
  cholesterol_total: "Total Cholesterol",
  hdl: "HDL",
  ldl: "LDL",
  triglycerides: "Triglycerides",
  platelets: "Platelets",
  wbc: "WBC",
  rbc: "RBC",
  creatinine: "Creatinine",
  urea: "Urea",
  blood_pressure_systolic: "Blood Pressure (Systolic)",
  blood_pressure_diastolic: "Blood Pressure (Diastolic)",
};

/** Human label for a canonical metric name, with a friendly fallback. */
export function metricLabel(metricName: string): string {
  return (
    METRIC_LABELS[metricName] ??
    metricName
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CopilotRiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH";

export type CopilotTrend = "Improving" | "Stable" | "Mixed" | "Worsening";

/** One row of the "Compare Latest Report" table. */
export interface CopilotMetricComparison {
  metricName: string;
  label: string;
  unit: string | null;
  latestValue: number | null;
  previousValue: number | null;
  /** Personal rolling average from the APBE engine. */
  personalBaseline: number | null;
  populationMin: number | null;
  populationMax: number | null;
  /** Signed percentage change vs the previous reading (null when unknown). */
  changePct: number | null;
  /** True when the movement is in the healthy direction; null when stable. */
  improving: boolean | null;
  /** True when the latest reading sits outside the lab reference range. */
  outsidePopulation: boolean;
}

export interface PreviousAiSummary {
  reportTitle: string;
  reportDate: string | null;
  summary: string;
  createdAt: string;
}

/** Everything the Doctor Copilot page needs, computed deterministically. */
export interface CopilotAnalysis {
  reportCount: number;
  latestReport: TimelineReport | null;
  previousReport: TimelineReport | null;
  /** Human labels of every metric with at least one reading. */
  metricsTracked: string[];
  /** Labels of metrics moving in the healthy direction. */
  improvingMetrics: string[];
  /** Labels of metrics moving away from the healthy direction. */
  worseningMetrics: string[];
  overallRiskLevel: CopilotRiskLevel;
  healthTrend: CopilotTrend;
  currentSummary: string;
  abnormalFindings: string[];
  milestones: string[];
  comparisons: CopilotMetricComparison[];
  /** Last 5 reports, newest first. */
  timeline: TimelineReport[];
  topObservations: string[];
  topQuestions: string[];
  topMonitor: string[];
  followUpTests: string[];
}

/** Shape of the payload accepted by the copilot:generate action. */
export interface CopilotInput {
  reportCount: number;
  latestReportDate: string | null;
  metricsTracked: string[];
  improvingMetrics: string[];
  worseningMetrics: string[];
  overallRiskLevel: string;
  abnormalFindings: string[];
  milestones: string[];
  metricComparisons: Array<{
    metricName: string;
    label: string;
    unit: string | null;
    latestValue: number | null;
    previousValue: number | null;
    personalBaseline: number | null;
    populationMin: number | null;
    populationMax: number | null;
  }>;
  previousSummaries: string[];
}

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

export type CopilotOutcome =
  | {
      ok: true;
      brief: CopilotBrief;
      raw: string;
      model: string;
      /** Which provider produced the brief: "gemini" or "openrouter". */
      provider: string;
      processingTimeMs: number;
    }
  | { ok: false; code: CopilotErrorCode; message: string };

/** One turn of the Ask Doctor Copilot conversation (session-scoped). */
export interface CopilotChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Compact health snapshot sent to the copilotChat:chat action. */
export interface CopilotChatContext {
  reportCount: number;
  latestReportTitle: string | null;
  latestReportDate: string | null;
  metricsTracked: string[];
  improvingMetrics: string[];
  worseningMetrics: string[];
  overallRiskLevel: string;
  abnormalFindings: string[];
  milestones: string[];
  metricComparisons: Array<{
    label: string;
    unit: string | null;
    latestValue: number | null;
    previousValue: number | null;
    personalBaseline: number | null;
    populationMin: number | null;
    populationMax: number | null;
  }>;
  /** Excerpt of the latest report's extracted OCR text (RLS-scoped). */
  latestOcrExcerpt: string | null;
  previousSummaries: string[];
}

export type CopilotChatOutcome =
  | {
      ok: true;
      reply: string;
      model: string;
      /** Which provider produced the reply: "gemini" or "openrouter". */
      provider: string;
      processingTimeMs: number;
    }
  | { ok: false; code: CopilotErrorCode; message: string };

/* ------------------------------------------------------------------ */
/* Data layer                                                          */
/* ------------------------------------------------------------------ */

/** Throws the well-known marker when the underlying tables are missing. */
function throwIfSchemaMissing(error: { message?: string }): void {
  if (error?.message && /relation .* does not exist|PGRST205/i.test(error.message)) {
    throw new Error("SCHEMA_NOT_APPLIED");
  }
}

/**
 * Reads the previous AI report analyses for this user (ai_insights joined to
 * medical_reports for ownership + dating). RLS scopes every row to reports the
 * user owns; the embedded parent's user_id is additionally checked, matching
 * the timeline.ts convention.
 */
export async function fetchPreviousAiSummaries(
  userId: string,
  limit = 5,
): Promise<PreviousAiSummary[]> {
  const { data, error } = await getSupabase()
    .from("ai_insights")
    .select(
      "report_id, summary, model_used, created_at, medical_reports(user_id, report_title, report_date)",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throwIfSchemaMissing(error);
    throw error;
  }

  const rows = (data ?? []) as unknown as Array<{
    report_id: string;
    summary: string | null;
    created_at: string;
    medical_reports:
      | { user_id: string; report_title: string; report_date: string | null }
      | Array<{ user_id: string; report_title: string; report_date: string | null }>
      | null;
  }>;

  const out: PreviousAiSummary[] = [];
  for (const row of rows) {
    const parent = Array.isArray(row.medical_reports)
      ? row.medical_reports[0]
      : row.medical_reports;
    if (!parent || parent.user_id !== userId) continue;
    if (!row.summary || !row.summary.trim()) continue;
    out.push({
      reportTitle: parent.report_title,
      reportDate: parent.report_date ?? null,
      summary: row.summary.trim(),
      createdAt: row.created_at,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export interface CopilotData {
  reports: TimelineReport[];
  metrics: TimelineMetric[];
}

/**
 * Loads the user's reports + metrics in one call (two existing queries, no new
 * database reads beyond the previous-AI-summaries lookup).
 */
export async function fetchCopilotData(userId: string): Promise<CopilotData> {
  const [reports, metrics] = await Promise.all([
    fetchAllReports(userId),
    fetchMetricsForUser(userId),
  ]);
  return { reports, metrics };
}

/**
 * Returns an excerpt of the OCR text of the most recent report that has
 * extracted text (RLS-scoped to the signed-in user's own reports). Used by the
 * "Ask Doctor Copilot" chat so the assistant can ground answers in the actual
 * document contents.
 */
export async function fetchLatestOcrExcerpt(
  userId: string,
  maxChars = 2000,
): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("medical_reports")
    .select("report_title, report_date, ocr_text")
    .eq("user_id", userId)
    .order("report_date", { ascending: false, nullsFirst: false })
    .limit(5);

  if (error) {
    throwIfSchemaMissing(error);
    throw error;
  }

  const rows = (data ?? []) as Array<{
    report_title: string;
    report_date: string | null;
    ocr_text: string | null;
  }>;
  for (const row of rows) {
    if (row.ocr_text && row.ocr_text.trim()) {
      const text = row.ocr_text.trim();
      return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)` : text;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Deterministic analysis                                              */
/* ------------------------------------------------------------------ */

const TOP_N = 5;

/** Rounds to two decimals for display strings. */
function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatDate(iso: string | null): string {
  if (!iso) return "unknown date";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Groups metrics by name, preserving chronological order. */
function groupByName(metrics: TimelineMetric[]): Map<string, TimelineMetric[]> {
  const grouped = new Map<string, TimelineMetric[]>();
  for (const metric of metrics) {
    const list = grouped.get(metric.metricName) ?? [];
    list.push(metric);
    grouped.set(metric.metricName, list);
  }
  return grouped;
}

/** Reports dated (non-null report_date), ascending. */
function datedReports(reports: TimelineReport[]): TimelineReport[] {
  return reports
    .filter((report) => report.reportDate !== null)
    .sort((a, b) => (a.reportDate ?? "").localeCompare(b.reportDate ?? ""));
}

/**
 * Computes the full deterministic visit analysis. Pure — no network, no AI.
 *
 * @param reports every report owned by the user (from fetchAllReports).
 * @param metrics every metric reading (from fetchMetricsForUser).
 * @param baselineCount number of personal baselines persisted (for a milestone).
 */
export function buildCopilotAnalysis(
  reports: TimelineReport[],
  metrics: TimelineMetric[],
  baselineCount = 0,
): CopilotAnalysis {
  const dated = datedReports(reports);
  const latestReport = dated[dated.length - 1] ?? null;
  const previousReport = dated[dated.length - 2] ?? null;
  const grouped = groupByName(metrics);

  /* ---- per-metric statistics + latest-report comparisons ---- */
  const comparisons: CopilotMetricComparison[] = [];
  const improving: string[] = [];
  const worsening: string[] = [];
  const abnormal: string[] = [];

  for (const [metricName, history] of grouped) {
    if (history.length === 0) continue;
    const label = metricLabel(metricName);
    const stats = computeBaseline(
      history.map((m) => ({
        reportId: m.reportId,
        reportDate: m.reportDate,
        metricName: m.metricName,
        metricValue: m.metricValue,
        metricUnit: m.metricUnit,
        populationMin: m.populationMin,
        populationMax: m.populationMax,
        measurementDate: m.measurementDate,
      })),
      metricName,
      history[0].metricUnit,
    );

    // Only metrics present in the LATEST report belong in the comparison table.
    const latestPoint = history[history.length - 1];
    const belongsToLatest = latestReport !== null && latestPoint.reportId === latestReport.id;
    if (belongsToLatest) {
      const previousPoint = history[history.length - 2] ?? null;
      const prevValue = previousPoint?.metricValue ?? null;
      const changePct = stats.percentageChange;
      const improvingDir =
        stats.direction === "stable"
          ? null
          : isImprovingDirection(stats.direction, metricName);
      const outside =
        stats.latestValue !== null &&
        ((latestPoint.populationMin !== null && stats.latestValue < latestPoint.populationMin) ||
          (latestPoint.populationMax !== null && stats.latestValue > latestPoint.populationMax));

      comparisons.push({
        metricName,
        label,
        unit: history[0].metricUnit,
        latestValue: stats.latestValue,
        previousValue: prevValue,
        personalBaseline: stats.rollingMean,
        populationMin: latestPoint.populationMin,
        populationMax: latestPoint.populationMax,
        changePct,
        improving: improvingDir,
        outsidePopulation: outside,
      });

      if (outside) {
        abnormal.push(
          `${label} is ${fmt(stats.latestValue)} ${history[0].metricUnit ?? ""}${
            latestPoint.populationMin !== null || latestPoint.populationMax !== null
              ? ` (lab range ${fmt(latestPoint.populationMin)}–${fmt(latestPoint.populationMax)})`
              : ""
          }`.trim(),
        );
      }
    }

    // Improving/worsening is judged across the full history.
    if (stats.direction === "increasing" || stats.direction === "decreasing") {
      if (isImprovingDirection(stats.direction, metricName)) improving.push(label);
      else worsening.push(label);
    }
  }

  /* ---- risk level (deterministic, from z-score severity) ---- */
  let maxSdLevel = 0;
  for (const history of grouped.values()) {
    if (history.length === 0) continue;
    const stats = computeBaseline(
      history.map((m) => ({
        reportId: m.reportId,
        reportDate: m.reportDate,
        metricName: m.metricName,
        metricValue: m.metricValue,
        metricUnit: m.metricUnit,
        populationMin: m.populationMin,
        populationMax: m.populationMax,
        measurementDate: m.measurementDate,
      })),
      history[0].metricName,
      history[0].metricUnit,
    );
    maxSdLevel = Math.max(maxSdLevel, stats.sdLevel);
  }

  let overallRiskLevel: CopilotRiskLevel = "LOW";
  if (maxSdLevel >= 3) overallRiskLevel = "HIGH";
  else if (maxSdLevel === 2) overallRiskLevel = "ELEVATED";
  else if (maxSdLevel === 1 || abnormal.length > 0) overallRiskLevel = "MODERATE";

  /* ---- health trend ---- */
  let healthTrend: CopilotTrend;
  if (improving.length > 0 && worsening.length === 0) healthTrend = "Improving";
  else if (worsening.length > 0 && improving.length === 0) healthTrend = "Worsening";
  else if (improving.length > 0 && worsening.length > 0) healthTrend = "Mixed";
  else healthTrend = "Stable";

  /* ---- milestones ---- */
  const milestones: string[] = [];
  if (dated.length > 0) {
    milestones.push(`First report — ${formatDate(dated[0].reportDate)}`);
    milestones.push(`Most recent report — ${formatDate(latestReport?.reportDate ?? null)}`);
  }
  if (baselineCount > 0) {
    milestones.push(`Personal baselines built for ${baselineCount} metrics`);
  }
  const largestChange = comparisons
    .filter((c) => c.changePct !== null)
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))[0];
  if (largestChange && previousReport) {
    milestones.push(
      `${largestChange.label} moved ${fmt(largestChange.changePct)}% between ${formatDate(
        previousReport.reportDate,
      )} and ${formatDate(latestReport?.reportDate ?? null)}`,
    );
  }

  /* ---- top-5 deterministic lists ---- */
  const byDeviation = [...comparisons].sort(
    (a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0),
  );

  const topObservations: string[] = [];
  for (const c of byDeviation) {
    if (topObservations.length >= TOP_N) break;
    if (c.changePct !== null && c.previousValue !== null) {
      topObservations.push(
        `${c.label} ${fmt(c.latestValue)} ${c.unit ?? ""} (${fmt(c.changePct)}% vs last report)`.trim(),
      );
    }
  }
  for (const finding of abnormal) {
    if (topObservations.length >= TOP_N) break;
    if (!topObservations.includes(finding)) topObservations.push(finding);
  }
  if (latestReport && topObservations.length < TOP_N) {
    topObservations.push(
      `Latest report "${latestReport.title}" covers ${comparisons.length} tracked metric${
        comparisons.length === 1 ? "" : "s"
      }.`,
    );
  }
  if (topObservations.length < TOP_N && reports.length > 0) {
    topObservations.push(
      `${reports.length} report${reports.length === 1 ? "" : "s"} analyzed across your history.`,
    );
  }

  const topQuestions: string[] = [];
  for (const c of byDeviation) {
    if (topQuestions.length >= TOP_N) break;
    if (c.changePct !== null && c.previousValue !== null) {
      topQuestions.push(
        `Why has ${c.label} changed from ${fmt(c.previousValue)} to ${fmt(
          c.latestValue,
        )} ${c.unit ?? ""} since my last report?`.trim(),
      );
    }
  }
  for (const c of byDeviation) {
    if (topQuestions.length >= TOP_N) break;
    if (c.outsidePopulation) {
      topQuestions.push(
        `Is ${c.label} at ${fmt(c.latestValue)} ${c.unit ?? ""} a concern given the lab range ${fmt(
          c.populationMin,
        )}–${fmt(c.populationMax)}?`.trim(),
      );
    }
  }
  if (topQuestions.length < TOP_N && byDeviation.length > 0) {
    const top = byDeviation[0];
    if (top.personalBaseline !== null) {
      topQuestions.push(
        `How should I interpret ${top.label} relative to my personal average of ${fmt(
          top.personalBaseline,
        )} ${top.unit ?? ""}?`.trim(),
      );
    }
  }
  const genericQuestions = [
    "Are there lifestyle, diet, or medication changes I should consider before my next visit?",
    "Which of my current medications could affect these lab values?",
    "How often should I repeat these tests to track progress?",
  ];
  for (const question of genericQuestions) {
    if (topQuestions.length >= TOP_N) break;
    topQuestions.push(question);
  }

  const topMonitor: string[] = [];
  for (const c of byDeviation) {
    if (topMonitor.length >= TOP_N) break;
    if (c.changePct !== null) {
      topMonitor.push(
        `Monitor ${c.label} — it moved ${fmt(c.changePct)}% since your last report.`,
      );
    }
  }
  for (const c of byDeviation) {
    if (topMonitor.length >= TOP_N) break;
    if (c.outsidePopulation && !topMonitor.some((m) => m.includes(c.label))) {
      topMonitor.push(`Keep an eye on ${c.label} while it is outside the lab range.`);
    }
  }
  if (topMonitor.length === 0) {
    topMonitor.push("No metric moved significantly since your last report.");
  }

  const followUpTests: string[] = [];
  for (const finding of abnormal) {
    if (followUpTests.length >= TOP_N) break;
    const label = finding.split(" is ")[0] ?? "this metric";
    followUpTests.push(
      `Discuss a re-check of ${label} with your doctor (educational only).`,
    );
  }
  if (followUpTests.length < TOP_N) {
    followUpTests.push(
      "Ask your doctor whether repeating your usual panel in 3–6 months is appropriate (educational only).",
    );
  }
  if (followUpTests.length < TOP_N && latestReport) {
    followUpTests.push(
      "A follow-up blood test after any medication change is worth discussing with your doctor.",
    );
  }

  /* ---- summary sentence ---- */
  const topMetric = comparisons[0];
  const currentSummaryParts: string[] = [
    `Across ${reports.length} report${reports.length === 1 ? "" : "s"}, your latest reading for ${
      topMetric ? topMetric.label : "your tracked metrics"
    } is ${topMetric ? fmt(topMetric.latestValue) + " " + (topMetric.unit ?? "") : "not available"}.`,
  ];
  if (topMetric?.outsidePopulation) {
    currentSummaryParts.push(`This value is outside the lab reference range.`);
  } else if (topMetric?.personalBaseline !== null && topMetric) {
    currentSummaryParts.push(
      `It sits near your personal average of ${fmt(topMetric.personalBaseline)} ${
        topMetric.unit ?? ""
      }.`,
    );
  }
  currentSummaryParts.push(
    `${improving.length} metric${improving.length === 1 ? "" : "s"} improving, ${worsening.length} worsening.`,
  );
  currentSummaryParts.push(`Overall risk is ${overallRiskLevel.toLowerCase()}.`);

  return {
    reportCount: reports.length,
    latestReport,
    previousReport,
    metricsTracked: [...grouped.keys()].map(metricLabel),
    improvingMetrics: improving,
    worseningMetrics: worsening,
    overallRiskLevel,
    healthTrend,
    currentSummary: currentSummaryParts.join(" "),
    abnormalFindings: abnormal,
    milestones,
    comparisons,
    timeline: [...dated].reverse().slice(0, 5),
    topObservations: topObservations.slice(0, TOP_N),
    topQuestions: topQuestions.slice(0, TOP_N),
    topMonitor: topMonitor.slice(0, TOP_N),
    followUpTests: followUpTests.slice(0, TOP_N),
  };
}

/** Builds the action payload from the deterministic analysis. */
export function buildCopilotInput(
  analysis: CopilotAnalysis,
  previousSummaries: PreviousAiSummary[],
): CopilotInput {
  return {
    reportCount: analysis.reportCount,
    latestReportDate: analysis.latestReport?.reportDate ?? null,
    metricsTracked: analysis.metricsTracked,
    improvingMetrics: analysis.improvingMetrics,
    worseningMetrics: analysis.worseningMetrics,
    overallRiskLevel: analysis.overallRiskLevel,
    abnormalFindings: analysis.abnormalFindings,
    milestones: analysis.milestones,
    metricComparisons: analysis.comparisons.map((c) => ({
      metricName: c.metricName,
      label: c.label,
      unit: c.unit,
      latestValue: c.latestValue,
      previousValue: c.previousValue,
      personalBaseline: c.personalBaseline,
      populationMin: c.populationMin,
      populationMax: c.populationMax,
    })),
    previousSummaries: previousSummaries.map((s) => s.summary),
  };
}

/**
 * Builds the compact health snapshot for the Ask Doctor Copilot chat from the
 * page's already-loaded analysis + previous AI summaries + the latest OCR
 * excerpt. Pure — no additional database queries beyond the OCR read that
 * produced `latestOcrExcerpt`.
 */
export function buildCopilotChatContext(
  analysis: CopilotAnalysis,
  previousSummaries: PreviousAiSummary[],
  latestOcrExcerpt: string | null,
): CopilotChatContext {
  return {
    reportCount: analysis.reportCount,
    latestReportTitle: analysis.latestReport?.title ?? null,
    latestReportDate: analysis.latestReport?.reportDate ?? null,
    metricsTracked: analysis.metricsTracked,
    improvingMetrics: analysis.improvingMetrics,
    worseningMetrics: analysis.worseningMetrics,
    overallRiskLevel: analysis.overallRiskLevel,
    abnormalFindings: analysis.abnormalFindings,
    milestones: analysis.milestones,
    metricComparisons: analysis.comparisons.map((c) => ({
      label: c.label,
      unit: c.unit,
      latestValue: c.latestValue,
      previousValue: c.previousValue,
      personalBaseline: c.personalBaseline,
      populationMin: c.populationMin,
      populationMax: c.populationMax,
    })),
    latestOcrExcerpt,
    previousSummaries: previousSummaries.map((s) => s.summary),
  };
}

/* ------------------------------------------------------------------ */
/* AI consultation brief                                               */
/* ------------------------------------------------------------------ */

let convexClient: ConvexHttpClient | null = null;

function getConvexClient(): ConvexHttpClient {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) {
    throw new Error(
      "CONVEX_URL_MISSING: add VITE_CONVEX_URL in the Keys tab to enable the AI consultation brief.",
    );
  }
  if (!convexClient) convexClient = new ConvexHttpClient(url);
  return convexClient;
}

/**
 * Asks the AI layer (via the secure `copilot:generate` action) for the
 * consultation narrative. The action verifies the caller's Supabase session
 * server-side and returns a validated brief — or a structured
 * { ok: false, code } outcome. Never throws for AI failures.
 */
export async function generateCopilotBrief(
  accessToken: string,
  input: CopilotInput,
): Promise<CopilotOutcome> {
  try {
    const result = await getConvexClient().action(api.copilot.generate, {
      accessToken,
      input,
    });
    return result as CopilotOutcome;
  } catch (err) {
    return {
      ok: false,
      code: "network",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Asks the AI layer (via the secure `copilotChat:chat` action) to answer a
 * question grounded in the user's own health snapshot + conversation history.
 * The action verifies the caller's Supabase session server-side. Never throws
 * for AI failures — returns a structured { ok: false, code } outcome instead.
 */
export async function generateCopilotChat(
  accessToken: string,
  question: string,
  history: CopilotChatMessage[],
  context: CopilotChatContext,
): Promise<CopilotChatOutcome> {
  try {
    const result = await getConvexClient().action(api.copilotChat.chat, {
      accessToken,
      question,
      history,
      context,
    });
    return result as CopilotChatOutcome;
  } catch (err) {
    return {
      ok: false,
      code: "network",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
