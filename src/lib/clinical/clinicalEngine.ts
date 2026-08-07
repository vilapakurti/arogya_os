/**
 * ArogyaOS — Clinical Decision Support Engine (CDSS)
 * Orchestrator. This is the ONLY entry point AI modules import:
 *
 *   evaluateMetric / evaluateReport / evaluatePatient
 *   evaluateTrend / evaluateRisk / evaluateEmergency
 *   evaluateCombinedFindings / getReferenceRange / getClinicalMeaning
 *
 * The engine is pure and deterministic — no AI, no I/O. It applies the
 * clinical rules (clinicalRules.ts) and personalizes against the patient
 * profile (referenceRanges.ts). Performance: O(metrics) lookups; evaluating
 * 100 lab metrics completes in well under 1 ms.
 *
 * Clinical Decision Support, not diagnosis — every output is advisory and
 * must be confirmed by a qualified medical professional.
 */

import {
  getRule,
  lowerIsBetter,
  metricLabel,
} from "./clinicalRules";
import {
  combineWithPersonalBaseline,
  getReferenceRange,
} from "./referenceRanges";
import {
  evaluateRisk,
  overallRiskLevel,
} from "./riskEngine";
import { evaluateCombinedFindings } from "./combinedFindings";
import type {
  ClinicalProfile,
  CombinedFinding,
  EmergencyFinding,
  MetricEvaluation,
  MetricInput,
  PatientRiskSummary,
  PriorityLevel,
  ReferenceRange,
  ReportEvaluation,
  RiskCategory,
  RiskLevel,
  SeverityLevel,
  StatusLevel,
  TrendDirection,
  TrendEvaluation,
} from "./clinicalTypes";

/* ------------------------------------------------------------------ */
/* Severity / priority ranks                                           */
/* ------------------------------------------------------------------ */

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  unknown: -1,
  normal: 0,
  mild: 1,
  moderate: 2,
  severe: 3,
  critical: 4,
};

const PRIORITY_RANK: Record<PriorityLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const STATUS_SEVERITY: Record<StatusLevel, SeverityLevel> = {
  low: "mild",
  normal: "normal",
  high: "mild",
  critical: "critical",
};

/* ------------------------------------------------------------------ */
/* Trend interpretation                                                */
/* ------------------------------------------------------------------ */

function isImprovingTrend(
  direction: TrendDirection,
  metricName: string,
  status: StatusLevel,
): boolean {
  if (direction === "stable") return false;
  const healthy = lowerIsBetter(metricName) ? direction === "decreasing" : direction === "increasing";
  if (status === "normal") return healthy;
  // Abnormal value: moving toward the healthy direction = improving.
  return healthy;
}

/**
 * Enriches a raw trend (direction + % change) into a clinical interpretation.
 * The trend CALCULATION (trends.ts) is untouched — this only interprets it.
 */
export function evaluateTrend(
  input: {
    metricName: string;
    direction: TrendDirection | null | undefined;
    percentageChange: number | null | undefined;
    value?: number | null;
    referenceRange?: ReferenceRange | null;
    status?: StatusLevel | null;
  },
): TrendEvaluation {
  const rule = getRule(input.metricName);
  const direction: TrendDirection = input.direction ?? "stable";
  const status: StatusLevel = input.status ?? "normal";
  const change = input.percentageChange ?? null;
  const label = metricLabel(input.metricName);

  let clinicalInterpretation: string;
  let recommendation: string;
  let priority: PriorityLevel = "low";

  if (direction === "stable") {
    clinicalInterpretation = `${label} is stable — no meaningful change.`;
    recommendation = rule.trendRecommendation.stable;
  } else {
    const base = rule.trendMeaning[direction];
    const improving = isImprovingTrend(direction, input.metricName, status);
    if (status === "normal") {
      clinicalInterpretation = improving
        ? `${base} — a favorable direction for this metric.`
        : `${base}.`;
    } else {
      clinicalInterpretation = improving
        ? `${base} — improving towards the normal range.`
        : `${base} — moving further from the normal range.`;
    }
    recommendation = improving
      ? rule.trendRecommendation.improving
      : rule.trendRecommendation.worsening;
    if (!improving && status !== "normal") priority = "medium";
  }

  let confidence = 58;
  if (change !== null && Number.isFinite(change)) {
    confidence += Math.min(28, Math.abs(change));
  }
  if (direction === "stable") confidence += 10;
  confidence = Math.min(95, Math.round(confidence));

  return {
    direction,
    percentageChange: change,
    clinicalInterpretation,
    confidence,
    priority,
    recommendation,
  };
}

/* ------------------------------------------------------------------ */
/* Emergency detection (raw thresholds)                                */
/* ------------------------------------------------------------------ */

/**
 * Detects immediately critical values (potassium, sodium, glucose,
 * creatinine, troponin, hemoglobin, platelets, oxygen saturation, …).
 */
export function evaluateEmergency(inputs: MetricInput[]): EmergencyFinding[] {
  const findings: EmergencyFinding[] = [];
  for (const input of inputs) {
    if (input.value === null || !Number.isFinite(input.value)) continue;
    const rule = getRule(input.metricName);
    const em = rule.emergency;
    if (!em) continue;
    const value = input.value;
    let triggered = false;
    if (em.min !== undefined && value < em.min) triggered = true;
    if (em.max !== undefined && value > em.max) triggered = true;
    if (!triggered) continue;
    findings.push({
      metricName: input.metricName,
      label: metricLabel(input.metricName),
      value,
      flag: em.flag,
      message: em.message,
      immediateDoctorReview: true,
      seekMedicalAttention: true,
      priority: "critical",
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Per-metric evaluation                                               */
/* ------------------------------------------------------------------ */

/**
 * Full clinical evaluation of one metric reading.
 * This is the single source of severity / clinical meaning / priority /
 * recommendation / reference range for a metric across ALL modules.
 */
export function evaluateMetric(
  input: MetricInput,
  profile?: ClinicalProfile | null,
): MetricEvaluation {
  const metricName = input.metricName;
  const label = metricLabel(metricName);
  const rule = getRule(metricName);
  const unit = input.unit ?? rule.unit ?? null;
  const value = input.value !== null && Number.isFinite(input.value) ? input.value : null;

  const referenceRange = getReferenceRange(metricName, profile, input);
  const populationRange =
    input.populationMin != null || input.populationMax != null
      ? { min: input.populationMin ?? null, max: input.populationMax ?? null }
      : null;
  const personalBaseline = input.personalBaseline ?? null;

  // ---- status ----
  let status: StatusLevel = "normal";
  if (value === null) {
    status = "normal";
  } else {
    const min = referenceRange.min;
    const max = referenceRange.max;
    if (min !== null && value < min) status = "low";
    else if (max !== null && value > max) status = "high";
  }
  if (rule.emergency && value !== null) {
    const em = rule.emergency;
    if ((em.min !== undefined && value < em.min) || (em.max !== undefined && value > em.max)) {
      status = "critical";
    }
  }

  // ---- severity ----
  let severity: SeverityLevel = value === null ? "unknown" : STATUS_SEVERITY[status];
  if (status === "critical") severity = "critical";
  else if ((status === "low" || status === "high") && value !== null) {
    severity = severityFromDeviation(value, referenceRange);
  }
  if (input.zScore !== null && input.zScore !== undefined) {
    const absZ = Math.abs(input.zScore);
    const zSeverity: SeverityLevel =
      absZ > 3 ? "severe" : absZ > 2 ? "moderate" : absZ > 1 ? "mild" : "normal";
    if (SEVERITY_RANK[zSeverity] > SEVERITY_RANK[severity]) severity = zSeverity;
  }

  // ---- personal baseline early warning ----
  const { earlyWarning } = combineWithPersonalBaseline(
    value,
    referenceRange,
    personalBaseline,
    input.zScore ?? null,
    input.personalClass ?? null,
  );

  // ---- clinical meaning ----
  const baseMeaning =
    rule.meanings[status] ??
    (value === null
      ? "No reading available for this metric."
      : `Value ${value} ${unit ?? ""} — ${status} relative to the reference range.`);
  const clinicalMeaning =
    baseMeaning + (earlyWarning ? ` ${earlyWarning}` : "");

  // ---- causes / risks / recommendations ----
  const possibleCauses = value === null ? [] : (rule.causes[status] ?? []);
  const possibleRisks = value === null ? [] : (rule.risks[status] ?? []);
  const recommendations =
    value === null
      ? []
      : rule.recommendations[status] ?? [
          status === "normal"
            ? "Continue monitoring."
            : "Discuss this reading with your doctor.",
        ];

  // ---- trend ----
  const trend = evaluateTrend({
    metricName,
    direction: input.direction ?? null,
    percentageChange: input.percentageChange ?? null,
    value,
    referenceRange,
    status,
  });

  // ---- priority ----
  let priority: PriorityLevel = priorityFromSeverity(severity);
  if (status === "critical") priority = "critical";
  if (trend.priority === "medium" && PRIORITY_RANK[priority] < PRIORITY_RANK.medium) {
    priority = "medium";
  }
  if (earlyWarning && PRIORITY_RANK[priority] < PRIORITY_RANK.medium) {
    priority = "medium";
  }

  // ---- doctor review ----
  const doctorReviewRequired =
    value !== null &&
    (SEVERITY_RANK[severity] >= SEVERITY_RANK.severe ||
      status === "critical" ||
      Boolean(earlyWarning));

  // ---- confidence ----
  let confidence = 70;
  if (value !== null) confidence += 4;
  if (referenceRange.source === "personalized") confidence += 6;
  else if (referenceRange.source === "lab") confidence += 3;
  if (personalBaseline !== null) confidence += 6;
  if (status === "critical") confidence += 8;
  if (SEVERITY_RANK[severity] >= SEVERITY_RANK.moderate) confidence += 4;
  confidence = Math.min(98, Math.round(confidence));

  return {
    metricName,
    label,
    value,
    unit,
    referenceRange,
    populationRange,
    personalBaseline,
    status,
    severity,
    priority,
    trend,
    clinicalMeaning,
    possibleCauses,
    possibleRisks,
    recommendations,
    doctorReviewRequired,
    emergency: {
      isEmergency: status === "critical",
      flag: status === "critical" ? rule.emergency?.flag : undefined,
      message: status === "critical" ? rule.emergency?.message : undefined,
    },
    confidence,
    source: "engine",
  };
}

function severityFromDeviation(
  value: number,
  range: ReferenceRange,
): SeverityLevel {
  const min = range.min;
  const max = range.max;
  const width = max !== null && min !== null ? max - min : null;
  let distance = 0;
  if (min !== null && value < min) distance = min - value;
  if (max !== null && value > max) distance = value - max;
  if (distance <= 0) return "normal";
  const denom = width && width > 0 ? width : Math.abs(value) * 0.1 || 1;
  const ratio = distance / denom;
  if (ratio >= 0.5) return "critical";
  if (ratio >= 0.25) return "severe";
  if (ratio >= 0.1) return "moderate";
  return "mild";
}

function priorityFromSeverity(severity: SeverityLevel): PriorityLevel {
  switch (severity) {
    case "critical":
      return "critical";
    case "severe":
      return "high";
    case "moderate":
      return "medium";
    default:
      return "low";
  }
}

/* ------------------------------------------------------------------ */
/* Report evaluation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Evaluates a whole report: every metric passes through evaluateMetric, then
 * combined findings, risk profile, and emergencies are derived. AI modules
 * consume this instead of interpreting raw metric/value pairs themselves.
 */
export function evaluateReport(
  inputs: MetricInput[],
  profile?: ClinicalProfile | null,
): ReportEvaluation {
  const metrics = inputs.map((input) => evaluateMetric(input, profile));
  const emergencies = evaluateEmergency(inputs);
  const combinedFindings = evaluateCombinedFindings(metrics, profile);
  const riskProfile = evaluateRisk(metrics, profile);

  let overallSeverity: SeverityLevel = "normal";
  let overallPriority: PriorityLevel = "low";
  for (const m of metrics) {
    if (SEVERITY_RANK[m.severity] > SEVERITY_RANK[overallSeverity]) {
      overallSeverity = m.severity;
    }
    if (PRIORITY_RANK[m.priority] > PRIORITY_RANK[overallPriority]) {
      overallPriority = m.priority;
    }
  }

  const summary = buildReportSummary(metrics, combinedFindings, emergencies, overallSeverity);

  return {
    metrics,
    combinedFindings,
    riskProfile,
    emergencies,
    overallSeverity,
    overallPriority,
    summary,
    generatedAt: Date.now(),
  };
}

function buildReportSummary(
  metrics: MetricEvaluation[],
  combinedFindings: CombinedFinding[],
  emergencies: EmergencyFinding[],
  overallSeverity: SeverityLevel,
): string {
  const outside = metrics.filter((m) => m.status !== "normal" && m.status !== "critical");
  const critical = metrics.filter((m) => m.status === "critical");
  const review = metrics.filter((m) => m.doctorReviewRequired);
  const parts: string[] = [];
  parts.push(
    `Evaluated ${metrics.length} metric${metrics.length === 1 ? "" : "s"}: ${
      outside.length + critical.length
    } outside the reference range${critical.length > 0 ? `, ${critical.length} critical` : ""}.`,
  );
  if (review.length > 0) {
    parts.push(
      `${review.length} reading${review.length === 1 ? "" : "s"} warrant${
        review.length === 1 ? "s" : ""
      } clinical review.`,
    );
  }
  if (combinedFindings.length > 0) {
    parts.push(
      `Recognized pattern${combinedFindings.length === 1 ? "" : "s"}: ${combinedFindings
        .slice(0, 3)
        .map((f) => f.finding)
        .join(", ")}.`,
    );
  }
  if (emergencies.length > 0) {
    parts.push(
      `${emergencies.length} emergency-level value${emergencies.length === 1 ? "" : "s"} detected — seek medical attention.`,
    );
  }
  if (outside.length === 0 && critical.length === 0) {
    parts.push("All readings are within the expected range.");
  }
  parts.push(`Overall severity: ${overallSeverity}.`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* Patient-level evaluation                                            */
/* ------------------------------------------------------------------ */

/**
 * Patient-level risk summary from the profile (and optionally a report
 * evaluation). Used by the Voice Assistant and any module that needs a
 * whole-person risk picture before generating language.
 */
export function evaluatePatient(
  profile: ClinicalProfile | null,
  report?: ReportEvaluation | null,
): PatientRiskSummary {
  const p = profile ?? null;
  const profileRisk = evaluateRisk([], p);
  const riskProfile: RiskCategory[] = report
    ? report.riskProfile.map((c) => {
        const merged = profileRisk.find((x) => x.key === c.key);
        const score = Math.max(c.score, merged?.score ?? 0);
        const contributors = [...new Set([...(merged?.contributors ?? []), ...c.contributors])];
        return { ...c, score, contributors: contributors.slice(0, 8) };
      })
    : profileRisk;

  const riskFlags: string[] = [];
  if (p) {
    if (p.ageCategory === "senior") riskFlags.push("Senior age group (60+)");
    if (p.ageCategory === "child") riskFlags.push("Child (<18)");
    if (p.bmiCategory === "obese") riskFlags.push("Obese BMI");
    else if (p.bmiCategory === "overweight") riskFlags.push("Overweight BMI");
    if (p.smokingStatus === "daily") riskFlags.push("Smokes daily");
    else if (p.smokingStatus === "occasionally") riskFlags.push("Smokes occasionally");
    if (p.alcoholStatus === "daily") riskFlags.push("Daily alcohol intake");
    else if (p.alcoholStatus === "weekly") riskFlags.push("Weekly alcohol intake");
    if (p.pregnant === true) riskFlags.push(`Pregnant (${p.trimester ?? "unknown"} trimester)`);
    for (const condition of p.knownConditions) {
      riskFlags.push(`Known ${condition.replace(/_/g, " ")}`);
    }
    for (const condition of p.familyHistory) {
      if (condition !== "none") riskFlags.push(`Family history of ${condition.replace(/_/g, " ")}`);
    }
  }

  const lifestyleAdvice: string[] = [];
  if (p) {
    if (p.smokingStatus === "daily" || p.smokingStatus === "occasionally") {
      lifestyleAdvice.push("Consider a plan to reduce smoking — your doctor can help.");
    }
    if (p.alcoholStatus === "daily" || p.alcoholStatus === "weekly") {
      lifestyleAdvice.push("Moderating alcohol intake may support liver and metabolic health.");
    }
    if (p.bmiCategory === "obese" || p.bmiCategory === "overweight") {
      lifestyleAdvice.push("Small, sustainable activity and dietary changes can improve metabolic risk.");
    }
    if (p.exerciseLevel === "sedentary") {
      lifestyleAdvice.push("Gradually increasing daily activity is a good first step.");
    }
    if (p.pregnant === true) {
      lifestyleAdvice.push("Keep your prenatal check-ups and share this report with your obstetrician.");
    }
  }
  if (lifestyleAdvice.length === 0) {
    lifestyleAdvice.push("Maintain your current healthy routines and regular check-ups.");
  }

  const overallLevel = overallRiskLevel(riskProfile);
  const summary =
    `Patient-level risk is ${overallLevel}. ` +
    (riskFlags.length > 0
      ? `Relevant factors: ${riskFlags.slice(0, 5).join("; ")}. `
      : "No major profile-level risk factors recorded. ") +
    "This summary is advisory and not a diagnosis — confirm with a qualified medical professional.";

  return { riskProfile, riskFlags, overallLevel, lifestyleAdvice, summary };
}

/* ------------------------------------------------------------------ */
/* Clinical meaning helper                                             */
/* ------------------------------------------------------------------ */

/**
 * Plain-language meaning for a metric + value + status, personalized to the
 * patient. Status is computed from the range when not supplied.
 */
export function getClinicalMeaning(
  metricName: string,
  value: number | null,
  status?: StatusLevel | null,
  profile?: ClinicalProfile | null,
): string {
  const rule = getRule(metricName);
  let resolvedStatus = status;
  if (!resolvedStatus && value !== null) {
    const range = getReferenceRange(metricName, profile, {
      metricName,
      value,
      populationMin: undefined,
      populationMax: undefined,
    });
    if (range.min !== null && value < range.min) resolvedStatus = "low";
    else if (range.max !== null && value > range.max) resolvedStatus = "high";
    else resolvedStatus = "normal";
  }
  return (
    rule.meanings[resolvedStatus ?? "normal"] ??
    `Value ${value ?? "—"} relative to the reference range.`
  );
}

/* ------------------------------------------------------------------ */
/* Re-exports — one import surface for every AI module                 */
/* ------------------------------------------------------------------ */

export { getReferenceRange, evaluateRisk, evaluateCombinedFindings };
export type {
  ClinicalProfile,
  CombinedFinding,
  EmergencyFinding,
  MetricEvaluation,
  MetricInput,
  PatientRiskSummary,
  PriorityLevel,
  ReferenceRange,
  ReportEvaluation,
  RiskCategory,
  RiskLevel,
  SeverityLevel,
  StatusLevel,
  TrendDirection,
  TrendEvaluation,
};
export { EMPTY_CLINICAL_PROFILE, CDSS_DISCLAIMER } from "./clinicalTypes";
