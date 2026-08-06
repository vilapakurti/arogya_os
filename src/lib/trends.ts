/**
 * Health trends — pure utility library.
 *
 * Calculates trend direction and change metrics from a chronological list of
 * metric readings. This module is intentionally dependency-free: no database
 * access, no Supabase, no React, no AI — it only transforms the data it is
 * given, so it is trivially testable and safe to use anywhere.
 *
 * Conventions:
 * - `history` is assumed to be ordered oldest → newest (callers like
 *   `fetchMetricHistory` in src/lib/timeline.ts already return it that way).
 *   Trend math compares the last two finite readings, so duplicate dates in
 *   the input do not affect the result (no deduplication is performed here).
 * - A "valid" reading is a finite number (`Number.isFinite`). `NaN`,
 *   `Infinity`, and runtime null/undefined values are treated as missing.
 * - All functions are total: they never throw, even for empty input.
 */

export interface MetricHistoryPoint {
  /** owning medical_reports row. */
  reportId: string;
  /** report_date of the parent report (null when the report has no date). */
  reportDate: string | null;
  metricName: string;
  /** numeric reading from the report. */
  metricValue: number;
  metricUnit: string | null;
  /** reference range lower bound from the lab report, when provided. */
  populationMin: number | null;
  /** reference range upper bound from the lab report, when provided. */
  populationMax: number | null;
  /** measurement date written on the report itself, when provided. */
  measurementDate: string | null;
}

export type TrendDirection = "increasing" | "decreasing" | "stable";

export interface TrendResult {
  /** Most recent valid reading, or null when there are none. */
  latestValue: number | null;
  /** Reading before the latest, or null when there is only one point. */
  previousValue: number | null;
  /**
   * Signed percentage change from previous to latest
   * (`(latest - previous) / |previous| * 100`), or null when it cannot be
   * computed (missing values, or a previous value of zero).
   */
  percentageChange: number | null;
  /** Classified direction: increasing / decreasing / stable. */
  direction: TrendDirection;
  /** Absolute difference `latest - previous`, or null when unavailable. */
  changeAmount: number | null;
  /** Number of points in the input history (including invalid ones). */
  sampleSize: number;
}

/** Returns true only for real, finite numbers (excludes NaN, ±Infinity, null). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Scans the history from the end and returns the most recent valid reading.
 *
 * @param history chronological metric readings (oldest → newest).
 * @returns the latest finite `metricValue`, or `null` for empty history or
 *          when every value is missing/non-finite.
 */
export function latestValue(history: MetricHistoryPoint[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (isFiniteNumber(history[i]?.metricValue)) {
      return history[i].metricValue as number;
    }
  }
  return null;
}

/**
 * Returns the valid reading immediately before the latest one.
 *
 * @param history chronological metric readings (oldest → newest).
 * @returns the second-most-recent finite `metricValue`, or `null` when there
 *          is no earlier valid reading (empty history or a single point).
 */
export function previousValue(history: MetricHistoryPoint[]): number | null {
  // Find the index of the latest valid value first.
  let latestIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (isFiniteNumber(history[i]?.metricValue)) {
      latestIndex = i;
      break;
    }
  }
  if (latestIndex < 0) return null;

  // Scan backwards from just before it for the previous valid value.
  for (let i = latestIndex - 1; i >= 0; i--) {
    if (isFiniteNumber(history[i]?.metricValue)) {
      return history[i].metricValue as number;
    }
  }
  return null;
}

/**
 * Computes the signed percentage change between two readings.
 *
 * Formula: `((current - previous) / |previous|) * 100`. Using the absolute
 * value of `previous` as the denominator keeps the sign of the change
 * meaningful for negative baselines (e.g. -2 → -1 is a +50% change).
 *
 * @param current the newer reading (may be null/NaN — treated as missing).
 * @param previous the older reading (may be null/NaN — treated as missing).
 * @returns the percentage as a number, or `null` when either value is
 *          missing/non-finite or when `previous` is zero (divide-by-zero:
 *          a percentage relative to zero is undefined).
 */
export function percentageChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous)) return null;
  if (previous === 0) return null; // divide-by-zero guard
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Classifies whether two readings count as "stable".
 *
 * Stable means the readings are exactly equal OR their difference is smaller
 * than 1% of the previous value. When a percentage cannot be computed
 * (previous is zero), only an exact match counts as stable.
 *
 * @param current the newer reading.
 * @param previous the older reading.
 * @returns true when the pair satisfies the stability rule.
 */
function isStablePair(current: number, previous: number): boolean {
  if (current === previous) return true;
  const percent = percentageChange(current, previous);
  return percent !== null && Math.abs(percent) < 1;
}

/**
 * Calculates the full trend summary for a metric history.
 *
 * - Empty history        → all values null, direction "stable", sampleSize 0.
 * - Single point         → `latestValue` set, previous/percentage null,
 *                          direction "stable", sampleSize 1.
 * - Two or more points   → pairwise comparison of the last two finite
 *                          readings; direction is "stable" when the values
 *                          are equal or within 1% of each other, otherwise
 *                          "increasing" / "decreasing" by raw comparison.
 * - Null / non-finite values are skipped when locating latest/previous.
 *
 * @param history chronological metric readings (oldest → newest).
 * @returns a `TrendResult` — never throws.
 */
export function calculateTrend(history: MetricHistoryPoint[]): TrendResult {
  const latest = latestValue(history);
  const previous = previousValue(history);

  let direction: TrendDirection = "stable";
  if (latest !== null && previous !== null) {
    if (isStablePair(latest, previous)) {
      direction = "stable";
    } else if (latest > previous) {
      direction = "increasing";
    } else {
      direction = "decreasing";
    }
  }

  return {
    latestValue: latest,
    previousValue: previous,
    percentageChange: percentageChange(latest, previous),
    direction,
    changeAmount:
      latest !== null && previous !== null ? latest - previous : null,
    sampleSize: history.length,
  };
}

/**
 * Returns true when the latest reading is greater than the previous one by
 * more than the 1% stability threshold.
 *
 * @param history chronological metric readings (oldest → newest).
 * @returns false for empty history or a single point (not enough data).
 */
export function isIncreasing(history: MetricHistoryPoint[]): boolean {
  return calculateTrend(history).direction === "increasing";
}

/**
 * Returns true when the latest reading is lower than the previous one by
 * more than the 1% stability threshold.
 *
 * @param history chronological metric readings (oldest → newest).
 * @returns false for empty history or a single point (not enough data).
 */
export function isDecreasing(history: MetricHistoryPoint[]): boolean {
  return calculateTrend(history).direction === "decreasing";
}

/**
 * Returns true when the readings show no meaningful change: exactly equal or
 * within 1% of each other. Empty and single-point histories count as stable
 * (there is no evidence of change).
 *
 * @param history chronological metric readings (oldest → newest).
 * @returns true when the trend is not increasing or decreasing.
 */
export function isStable(history: MetricHistoryPoint[]): boolean {
  return calculateTrend(history).direction === "stable";
}
