/**
 * ArogyaOS — Clinical Decision Support Engine (CDSS)
 * Risk engine.
 *
 * Produces seven risk categories (cardiovascular, kidney, diabetes, liver,
 * inflammation, anemia, metabolic). Each score is a 0–100 composite of:
 *  - metric contributions (rule-declared weights × status severity), and
 *  - patient profile factors (age, BMI, smoking, alcohol, exercise, known
 *    conditions, family history).
 *
 * Scores are advisory. Levels: < 25 low · < 50 moderate · < 65 high · ≥ 65
 * critical.
 */

import { SEVERITY_MULTIPLIER, getRule } from "./clinicalRules";
import type {
  ClinicalProfile,
  MetricEvaluation,
  RiskCategory,
  RiskCategoryKey,
  RiskLevel,
  StatusLevel,
} from "./clinicalTypes";

const CATEGORY_META: Record<RiskCategoryKey, { label: string }> = {
  cardiovascular: { label: "Cardiovascular Risk" },
  kidney: { label: "Kidney Risk" },
  diabetes: { label: "Diabetes Risk" },
  liver: { label: "Liver Risk" },
  inflammation: { label: "Inflammation Risk" },
  anemia: { label: "Anemia Risk" },
  metabolic: { label: "Metabolic Risk" },
};

/** Patient-profile factors that raise each risk category (weight, label). */
const PROFILE_FACTORS: Record<
  RiskCategoryKey,
  Array<(p: ClinicalProfile) => { weight: number; label: string } | null>
> = {
  cardiovascular: [
    (p) => (p.ageCategory === "senior" ? { weight: 12, label: "Senior age group" } : null),
    (p) => (p.smokingStatus === "daily" ? { weight: 15, label: "Smokes daily" } : p.smokingStatus === "occasionally" ? { weight: 7, label: "Smokes occasionally" } : null),
    (p) => (p.bmiCategory === "obese" ? { weight: 10, label: "Obese BMI" } : p.bmiCategory === "overweight" ? { weight: 5, label: "Overweight BMI" } : null),
    (p) => (hasCondition(p, "diabetes") ? { weight: 12, label: "Known diabetes" } : null),
    (p) => (hasCondition(p, "hypertension") ? { weight: 12, label: "Known hypertension" } : null),
    (p) => (hasCondition(p, "heart_disease") ? { weight: 20, label: "Known heart disease" } : null),
    (p) => (hasHistory(p, "heart_disease") ? { weight: 8, label: "Family history of heart disease" } : null),
  ],
  kidney: [
    (p) => (hasCondition(p, "kidney_disease") ? { weight: 25, label: "Known kidney disease" } : null),
    (p) => (hasCondition(p, "diabetes") ? { weight: 15, label: "Known diabetes" } : null),
    (p) => (hasCondition(p, "hypertension") ? { weight: 15, label: "Known hypertension" } : null),
    (p) => (p.ageCategory === "senior" ? { weight: 8, label: "Senior age group" } : null),
  ],
  diabetes: [
    (p) => (hasCondition(p, "diabetes") ? { weight: 25, label: "Known diabetes" } : null),
    (p) => (p.bmiCategory === "obese" ? { weight: 15, label: "Obese BMI" } : p.bmiCategory === "overweight" ? { weight: 8, label: "Overweight BMI" } : null),
    (p) => (hasHistory(p, "diabetes") ? { weight: 10, label: "Family history of diabetes" } : null),
    (p) => (hasCondition(p, "hypertension") ? { weight: 5, label: "Known hypertension" } : null),
  ],
  liver: [
    (p) => (hasCondition(p, "liver_disease") ? { weight: 25, label: "Known liver disease" } : null),
    (p) => (p.alcoholStatus === "daily" ? { weight: 15, label: "Daily alcohol" } : p.alcoholStatus === "weekly" ? { weight: 8, label: "Weekly alcohol" } : null),
    (p) => (p.bmiCategory === "obese" ? { weight: 8, label: "Obese BMI" } : null),
  ],
  inflammation: [
    (p) => (p.alcoholStatus === "daily" ? { weight: 5, label: "Daily alcohol" } : null),
    (p) => (p.smokingStatus === "daily" ? { weight: 5, label: "Smokes daily" } : null),
  ],
  anemia: [
    (p) => (p.gender === "female" ? { weight: 8, label: "Female (higher baseline anemia risk)" } : null),
    (p) => (p.pregnant === true ? { weight: 12, label: "Pregnancy" } : null),
  ],
  metabolic: [
    (p) => (p.bmiCategory === "obese" ? { weight: 20, label: "Obese BMI" } : p.bmiCategory === "overweight" ? { weight: 10, label: "Overweight BMI" } : null),
    (p) => (hasCondition(p, "diabetes") ? { weight: 12, label: "Known diabetes" } : null),
    (p) => (p.exerciseLevel === "sedentary" ? { weight: 8, label: "Sedentary lifestyle" } : null),
    (p) => (hasCondition(p, "hypertension") ? { weight: 8, label: "Known hypertension" } : null),
  ],
};

function hasCondition(p: ClinicalProfile, key: string): boolean {
  return p.knownConditions.includes(key);
}

function hasHistory(p: ClinicalProfile, key: string): boolean {
  return p.familyHistory.includes(key);
}

/** Maps a metric status to a severity weight multiplier (0–2.5). */
function statusWeight(status: StatusLevel): number {
  return SEVERITY_MULTIPLIER[status] ?? 0;
}

/**
 * Evaluates the seven risk categories.
 *
 * @param metrics metric evaluations (from evaluateReport/evaluateMetric).
 * @param profile optional patient profile (adds demographic/lifestyle factors).
 */
export function evaluateRisk(
  metrics: MetricEvaluation[],
  profile?: ClinicalProfile | null,
): RiskCategory[] {
  const p = profile ?? null;
  const scores: Record<RiskCategoryKey, { score: number; contributors: string[] }> = {
    cardiovascular: { score: 0, contributors: [] },
    kidney: { score: 0, contributors: [] },
    diabetes: { score: 0, contributors: [] },
    liver: { score: 0, contributors: [] },
    inflammation: { score: 0, contributors: [] },
    anemia: { score: 0, contributors: [] },
    metabolic: { score: 0, contributors: [] },
  };

  // Metric contributions.
  for (const m of metrics) {
    const rule = getRule(m.metricName);
    const weight = statusWeight(m.status);
    if (weight <= 0) continue;
    for (const key of Object.keys(rule.riskContributions ?? {}) as RiskCategoryKey[]) {
      const base = rule.riskContributions?.[key] ?? 0;
      if (base <= 0) continue;
      const contribution = Math.round(base * weight);
      scores[key].score += contribution;
      scores[key].contributors.push(
        `${m.label} ${m.value ?? "—"} ${m.unit ?? ""} (${m.severity})`,
      );
    }
  }

  // Profile contributions.
  if (p) {
    for (const key of Object.keys(PROFILE_FACTORS) as RiskCategoryKey[]) {
      for (const factorFn of PROFILE_FACTORS[key]) {
        const factor = factorFn(p);
        if (!factor) continue;
        scores[key].score += factor.weight;
        scores[key].contributors.push(factor.label);
      }
    }
  }

  return (Object.keys(scores) as RiskCategoryKey[]).map((key) => {
    const { score, contributors } = scores[key];
    const capped = Math.min(100, Math.round(score));
    return {
      key,
      label: CATEGORY_META[key].label,
      level: riskLevelOf(capped),
      score: capped,
      contributors: dedupe(contributors).slice(0, 8),
    };
  });
}

export function riskLevelOf(score: number): RiskLevel {
  if (score >= 65) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "moderate";
  return "low";
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Highest risk level across a set of categories. */
export function overallRiskLevel(categories: RiskCategory[]): RiskLevel {
  const rank: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, critical: 3 };
  let worst: RiskLevel = "low";
  for (const c of categories) {
    if (rank[c.level] > rank[worst]) worst = c.level;
  }
  return worst;
}
