/**
 * Adaptive Personal Baseline Engine (APBE) — pure statistics module.
 *
 * Compares a user's readings against THEIR OWN historical health instead of
 * only population ranges. This module is deliberately dependency-free of any
 * database/Supabase/React code — it only transforms the data it is given, so
 * it is trivially testable. It reuses the trend helpers from `src/lib/trends`
 * (single source of truth for direction/percentage-change logic).
 *
 * Conventions:
 * - `history` is assumed ordered oldest → newest (timeline.ts already returns
 *   it that way). The "rolling window" is the full available history; the
 *   standard deviation is the sample (n-1) standard deviation so it stays
 *   meaningful for small sample sizes.
 * - A "valid" reading is a finite number (`Number.isFinite`). NaN/Infinity
 *   and runtime nulls are treated as missing.
 * - All functions are total: they never throw, even for empty input.
 */

import {
  calculateTrend,
  type MetricHistoryPoint,
  type TrendDirection,
} from "@/lib/trends";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Five-way personal classification of the latest reading. */
export type PersonalClass =
  | "far_below"
  | "below"
  | "within"
  | "above"
  | "far_above";

/** Risk indicator tone (color-coded badge). */
export type RiskTone = "green" | "blue" | "amber" | "orange" | "red";

/** SD deviation severity for alerts: 0 = none, 1 = >1SD, 2 = >2SD, 3 = >3SD. */
export type SdLevel = 0 | 1 | 2 | 3;

/**
 * Full statistics computed for one metric from its chronological history.
 * Everything here is deterministic — no AI involved.
 */
export interface BaselineStats {
  metricName: string;
  unit: string | null;
  /** Arithmetic mean of all valid readings (the personal average). */
  rollingMean: number | null;
  /** Middle value of the sorted readings (median). */
  median: number | null;
  /** Smallest valid reading. */
  minimum: number | null;
  /** Largest valid reading. */
  maximum: number | null;
  /** Sample standard deviation (n-1). */
  stdDev: number | null;
  /** Sample variance (stdDev squared). */
  variance: number | null;
  /** Exponentially weighted moving average — emphasizes recent readings. */
  ema: number | null;
  /** Latest valid reading. */
  latestValue: number | null;
  /** latestValue - rollingMean (absolute deviation from personal average). */
  latestDifference: number | null;
  /**
   * Signed percentage difference between the latest reading and the personal
   * average: (latest - mean) / |mean| * 100. Null when it can't be computed
   * (missing values or a zero mean — divide-by-zero guard).
   */
  percentageDifference: number | null;
  /** (latest - mean) / stdDev — how far the latest reading sits from the user's normal. */
  latestZScore: number | null;
  /** Number of valid readings used. */
  sampleCount: number;
  /** Date of the latest reading (report/measurement date when known). */
  lastUpdatedDate: string | null;
  /** Five-way personal classification of the latest reading. */
  personalClass: PersonalClass;
  /** Color-coded risk indicator. */
  riskTone: RiskTone;
  /** SD deviation severity (>1 / >2 / >3 standard deviations). */
  sdLevel: SdLevel;
  /** Trend direction computed by the shared trends module. */
  direction: TrendDirection;
  /** Signed percentage change of the last two readings (from trends.ts). */
  percentageChange: number | null;
  /** Deterministic plain-language insight, when a rule applies. */
  insight: string | null;
}

/** Human label used inside deterministic insights. */
const METRIC_LABELS: Record<string, string> = {
  hemoglobin: "Hemoglobin",
  blood_glucose: "Blood Sugar",
  hba1c: "HbA1c",
  cholesterol_total: "Cholesterol",
  hdl: "HDL",
  ldl: "LDL",
  triglycerides: "Triglycerides",
  platelets: "Platelets",
  wbc: "WBC",
  rbc: "RBC",
  creatinine: "Creatinine",
  urea: "Urea",
  blood_pressure_systolic: "Blood Pressure",
  blood_pressure_diastolic: "Blood Pressure",
};

/**
 * For these metrics a LOWER value is the healthy direction (e.g. cholesterol,
 * glucose). Used to decide whether a falling trend is "improving".
 */
const LOWER_IS_BETTER = new Set([
  "blood_glucose",
  "hba1c",
  "cholesterol_total",
  "ldl",
  "triglycerides",
  "creatinine",
  "urea",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
]);

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                  */
/* ------------------------------------------------------------------ */

/** Returns the array of finite readings (NaN/Infinity/null skipped). */
function validValues(history: MetricHistoryPoint[]): number[] {
  const out: number[] = [];
  for (const point of history) {
    if (Number.isFinite(point.metricValue)) out.push(point.metricValue);
  }
  return out;
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample variance (n-1 denominator). Returns null for fewer than 2 values. */
function varianceOf(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = meanOf(values) as number;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0);
  return sumSq / (values.length - 1);
}

/**
 * Exponential moving average — standard smoothing factor alpha = 2/(n+1),
 * seeded with the first value, applied in chronological order.
 */
function emaOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const alpha = 2 / (values.length + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = alpha * values[i] + (1 - alpha) * ema;
  }
  return ema;
}

/**
 * EMA at every index, in chronological order. The final element equals the
 * single-value `emaOf` result, so the chart's EMA line and the stored
 * `exponential_average` always agree.
 */
export function emaSeries(values: number[]): number[] {
  if (values.length === 0) return [];
  const alpha = 2 / (values.length + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

/** Z-score of `value` against `mean` / `stdDev` (0 when std is 0 or missing). */
export function zScoreOf(
  value: number | null,
  mean: number | null,
  stdDev: number | null,
): number | null {
  if (value === null || mean === null || stdDev === null || stdDev === 0) {
    return null;
  }
  return (value - mean) / stdDev;
}

/** Five-way classification from an absolute z-score. */
export function classifyPersonalClass(z: number | null): PersonalClass {
  if (z === null) return "within";
  if (z <= -2) return "far_below";
  if (z < -1) return "below";
  if (z <= 1) return "within";
  if (z < 2) return "above";
  return "far_above";
}

/** SD severity level for alerts: >1, >2, >3 standard deviations. */
export function sdLevelOf(z: number | null): SdLevel {
  if (z === null) return 0;
  const abs = Math.abs(z);
  if (abs > 3) return 3;
  if (abs > 2) return 2;
  if (abs > 1) return 1;
  return 0;
}

/**
 * Risk indicator tone.
 *
 * - green  → within baseline
 * - blue   → improving (moving in the healthy direction while within normal)
 * - amber  → slight deviation (>1 SD)
 * - orange → moderate deviation (>2 SD)
 * - red    → significant deviation (>3 SD)
 */
export function riskToneOf(
  personalClass: PersonalClass,
  sdLevel: SdLevel,
  direction: TrendDirection,
  metricName: string,
): RiskTone {
  if (sdLevel === 3) return "red";
  if (sdLevel === 2) return "orange";
  if (personalClass === "within") {
    return isImprovingDirection(direction, metricName) ? "blue" : "green";
  }
  return "amber";
}

/** True when a trend direction means the user's health is improving. */
export function isImprovingDirection(
  direction: TrendDirection,
  metricName: string,
): boolean {
  if (direction === "stable") return false;
  if (LOWER_IS_BETTER.has(metricName)) return direction === "decreasing";
  return direction === "increasing";
}

/** Friendly human status label for the five-way class. */
export function personalClassLabel(personalClass: PersonalClass): string {
  switch (personalClass) {
    case "far_below":
      return "Far below your normal";
    case "below":
      return "Below your normal";
    case "within":
      return "Within your normal";
    case "above":
      return "Slightly above your normal";
    case "far_above":
      return "Far above your normal";
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic insights                                              */
/* ------------------------------------------------------------------ */

/** Number of recent readings used for the "continuously improved" rule. */
const IMPROVEMENT_WINDOW = 4;

function isContinuousImprovement(
  values: number[],
  metricName: string,
): boolean {
  if (values.length < IMPROVEMENT_WINDOW) return false;
  const window = values.slice(-IMPROVEMENT_WINDOW);
  for (let i = 1; i < window.length; i++) {
    const better =
      LOWER_IS_BETTER.has(metricName)
        ? window[i] < window[i - 1]
        : window[i] > window[i - 1];
    if (!better) return false;
  }
  return true;
}

/** True when the most recent half of readings is tighter than the earlier half. */
function isBecomingMoreStable(values: number[]): boolean {
  if (values.length < 6) return false;
  const half = Math.floor(values.length / 2);
  const earlier = values.slice(0, half);
  const recent = values.slice(half);
  const earlyVariance = varianceOf(earlier);
  const recentVariance = varianceOf(recent);
  if (earlyVariance === null || recentVariance === null) return false;
  return recentVariance < earlyVariance * 0.7;
}

/**
 * Generates ONE deterministic insight per metric when a rule applies,


[FILE_TOO_LARGE]: The combined read_files output exceeded the 100,000 character hard limit. This file was truncated after 10,391 characters. Read it separately or use code_search for the relevant section.