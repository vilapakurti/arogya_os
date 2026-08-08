/**
 * ArogyaOS — Clinical Decision Support Engine (CDSS)
 * Personalized reference ranges.
 *
 * Ranges are NEVER a single static value. They are derived from the metric's
 * base rule and then adjusted for the patient's age, gender, pregnancy &
 * trimester, exercise level, and known conditions. When the report provides a
 * lab reference range and the metric has no dedicated rule, the lab range is
 * used as-is.
 *
 * Unit safety: rules are written in one canonical unit (rule.unit). When a
 * report expresses a reading in a different unit (e.g. glucose in mmol/L,
 * creatinine in µmol/L), the rule's range is converted via the rule's
 * `unitConversions` table BEFORE any comparison. If no conversion exists for
 * the report's unit, the lab-provided range (already in the report's unit) is
 * preferred, and if neither exists the range is marked unavailable — the
 * engine never compares values expressed in different units without
 * conversion.
 */

import {
  getRule,
  type MetricRule,
} from "./clinicalRules";
import type {
  ClinicalProfile,
  MetricInput,
  ReferenceRange,
} from "./clinicalTypes";

const SENIOR_CREATININE_MIN = 0.6;
const SENIOR_CREATININE_MAX = 1.1;

/**
 * Normalizes a unit string into a lookup key: lowercase, no whitespace,
 * and "µ"/"μ" folded to "u" so "µmol/L" and "umol/L" resolve identically.
 */
function unitKey(unit: string | null | undefined): string | null {
  if (!unit || !unit.trim()) return null;
  return unit.trim().toLowerCase().replace(/\s+/g, "").replace(/[µμ]/g, "u");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Formats a conversion factor for a human-readable rationale. */
function fmtFactor(factor: number): string {
  const r = round2(factor);
  return Number.isInteger(r) ? String(r) : String(r);
}

/**
 * Resolves the reference range for a metric given a patient profile.
 *
 * @param metricName canonical metric name.
 * @param profile optional patient factors; null → population defaults.
 * @param input optional reading (used to fall back to the lab-provided range
 *        and to detect the unit the report actually used).
 */
export function getReferenceRange(
  metricName: string,
  profile?: ClinicalProfile | null,
  input?: MetricInput | null,
): ReferenceRange {
  const rule = getRule(metricName);
  const hasRule = rule.populationMin != null || rule.populationMax != null;

  // No dedicated rule → prefer the lab range written on the report.
  if (!hasRule) {
    const hasLab = input?.populationMin != null || input?.populationMax != null;
    if (hasLab) {
      return {
        min: input?.populationMin ?? null,
        max: input?.populationMax ?? null,
        source: "lab",
        rationale: ["Reference range as printed on the laboratory report."],
      };
    }
    return { min: null, max: null, source: "unavailable", rationale: [] };
  }

  const { min, max, rationale } = personalizeRange(rule, profile);
  let finalMin = min;
  let finalMax = max;
  const finalRationale = [...rationale];

  // Unit-aware resolution: if the report used a different unit than the
  // rule's canonical unit, convert the rule range into the report's unit.
  // Never compare rule-unit bounds against values expressed in another unit.
  const inputUnit = unitKey(input?.unit);
  const ruleUnit = unitKey(rule.unit);
  if (inputUnit && ruleUnit && inputUnit !== ruleUnit) {
    const factor = rule.unitConversions?.[inputUnit];
    if (factor !== undefined) {
      if (finalMin !== null) finalMin = round2(finalMin * factor);
      if (finalMax !== null) finalMax = round2(finalMax * factor);
      finalRationale.push(
        `Converted from ${rule.unit} to ${input?.unit} (×${fmtFactor(factor)}).`,
      );
    } else {
      // No conversion available for the report's unit — fall back to the lab
      // range (already in the report's unit), else mark unavailable.
      const hasLab = input?.populationMin != null || input?.populationMax != null;
      if (hasLab) {
        return {
          min: input?.populationMin ?? null,
          max: input?.populationMax ?? null,
          source: "lab",
          rationale: [
            `Reference range as printed on the report (${input?.unit}); no engine rule exists for this unit.`,
          ],
        };
      }
      return {
        min: null,
        max: null,
        source: "unavailable",
        rationale: [`No reference range available for unit ${input?.unit}.`],
      };
    }
  }

  if (finalMin == null && finalMax == null) {
    return { min: null, max: null, source: "unavailable", rationale: [] };
  }
  return {
    min: finalMin,
    max: finalMax,
    source: finalRationale.length > 0 ? "personalized" : "population",
    rationale: finalRationale,
  };
}

/** Applies all profile-based adjustments to a rule's base range. */
function personalizeRange(
  rule: MetricRule,
  profile?: ClinicalProfile | null,
): { min: number | null; max: number | null; rationale: string[] } {
  let min = rule.populationMin ?? null;
  let max = rule.populationMax ?? null;
  const rationale: string[] = [];
  const p = profile ?? null;
  if (!p) return { min, max, rationale };

  const adjust = (override: { min?: number; max?: number } | undefined, note: string) => {
    if (!override) return;
    if (override.min !== undefined) min = override.min;
    if (override.max !== undefined) max = override.max;
    rationale.push(note);
  };

  // Gender
  if (p.gender && rule.personalized?.byGender) {
    const g = rule.personalized.byGender[p.gender];
    if (g) adjust(g, `Adjusted for ${p.gender} physiology.`);
  }

  // Age category (adult is the population default; only child/senior adjust)
  if (p.ageCategory && p.ageCategory !== "adult" && rule.personalized?.byAgeCategory) {
    const a = rule.personalized.byAgeCategory[p.ageCategory];
    if (a) adjust(a, `Adjusted for ${p.ageCategory} age group.`);
  }

  // Pregnancy / trimester
  if (p.pregnant === true) {
    const pg = rule.personalized?.byPregnant;
    if (pg) adjust(pg, "Adjusted for pregnancy.");
    if (p.trimester && rule.personalized?.byTrimester) {
      const t = rule.personalized.byTrimester[p.trimester];
      if (t) adjust(t, `Adjusted for ${p.trimester} trimester.`);
    }
  }

  // Known conditions
  if (p.knownConditions.length > 0 && rule.personalized?.byCondition) {
    for (const condition of p.knownConditions) {
      const c = rule.personalized.byCondition[condition];
      if (c) {
        adjust(
          c,
          `Adjusted for known ${condition.replace(/_/g, " ")} (management target).`,
        );
      }
    }
  }

  // Exercise level (e.g. athletes) — currently no rule declares an athlete
  // override, and one should only be added with explicit clinical basis.
  if (p.exerciseLevel === "athlete" && rule.personalized?.byExercise?.athlete) {
    adjust(rule.personalized.byExercise.athlete, "Adjusted for athlete-level exercise.");
  }

  // Sensible senior-creatinine guard: seniors typically run lower creatinine.
  if (
    rule === getRule("creatinine") &&
    p.ageCategory === "senior" &&
    min !== null &&
    min > SENIOR_CREATININE_MIN
  ) {
    min = SENIOR_CREATININE_MIN;
    if (max !== null && max > SENIOR_CREATININE_MAX) max = SENIOR_CREATININE_MAX;
    if (!rationale.some((r) => r.includes("senior"))) {
      rationale.push("Adjusted for senior age group (lower typical creatinine).");
    }
  }

  return { min, max, rationale };
}

/**
 * Combines the population/personalized range with the APBE personal baseline.
 *
 * Returns an "early warning" string when the value sits inside the reference
 * range but is abnormal for THIS patient's own baseline — the classic
 * population-vs-personal divergence.
 */
export function combineWithPersonalBaseline(
  value: number | null,
  range: ReferenceRange,
  personalBaseline: number | null,
  zScore: number | null,
  personalClass: string | null,
): { range: ReferenceRange; earlyWarning: string | null } {
  if (
    value === null ||
    range.min === null ||
    range.max === null ||
    value < range.min ||
    value > range.max
  ) {
    return { range, earlyWarning: null };
  }
  const absZ = Math.abs(zScore ?? 0);
  const deviates = ["far_above", "above", "far_below", "below"].includes(
    personalClass ?? "",
  );
  if (deviates && absZ >= 1 && personalBaseline !== null) {
    const direction = (zScore ?? 0) >= 0 ? "above" : "below";
    return {
      range,
      earlyWarning:
        `Although still within the reference range, this value sits ${direction} ` +
        `this patient's own baseline average of ${round(personalBaseline)} — an early ` +
        "personal trend worth discussing with a doctor.",
    };
  }
  return { range, earlyWarning: null };
}

function round(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

/** Formats a range for display, e.g. "70–100". */
export function formatRange(range: ReferenceRange): string {
  if (range.min === null && range.max === null) return "Not available";
  if (range.min !== null && range.max !== null) return `${range.min}–${range.max}`;
  if (range.min !== null) return `> ${range.min}`;
  return `< ${range.max}`;
}
