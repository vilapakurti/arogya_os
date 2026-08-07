/**
 * ArogyaOS — Clinical Decision Support Engine (CDSS)
 * Combined findings (pattern recognition).
 *
 * Recognizes clinically meaningful multi-metric patterns (e.g. high HbA1c +
 * high blood sugar → possible diabetes progression). Patterns are declared as
 * data below; adding a pattern = adding an entry, no engine changes.
 */

import { getRule } from "./clinicalRules";
import type {
  ClinicalProfile,
  CombinedFinding,
  MetricEvaluation,
  PriorityLevel,
  StatusLevel,
} from "./clinicalTypes";

interface PatternMetricRequirement {
  metricName: string;
  /** Required status of the metric for the pattern to fire. */
  status: StatusLevel;
}

interface PatternDef {
  id: string;
  finding: string;
  priority: PriorityLevel;
  doctorReview: boolean;
  explanation: string;
  metrics: PatternMetricRequirement[];
  /** Optional extra conditions against the patient profile. */
  profileCondition?: (p: ClinicalProfile) => boolean;
}

const PATTERNS: PatternDef[] = [
  {
    id: "diabetes_progression",
    finding: "Possible Diabetes Progression",
    priority: "high",
    doctorReview: true,
    explanation:
      "Both long-term glucose (HbA1c) and current blood sugar are elevated, which together suggest progressing glucose dysregulation.",
    metrics: [
      { metricName: "hba1c", status: "high" },
      { metricName: "blood_glucose", status: "high" },
    ],
  },
  {
    id: "iron_deficiency_pattern",
    finding: "Possible Iron Deficiency Pattern",
    priority: "high",
    doctorReview: true,
    explanation:
      "Low hemoglobin with a low red-cell count is the classic red-cell pattern of iron-deficiency anemia; ferritin would confirm iron stores.",
    metrics: [
      { metricName: "hemoglobin", status: "low" },
      { metricName: "rbc", status: "low" },
    ],
  },
  {
    id: "kidney_dysfunction",
    finding: "Possible Kidney Dysfunction",
    priority: "high",
    doctorReview: true,
    explanation:
      "Creatinine and urea are both elevated — together this suggests reduced kidney filtration and warrants a clinician review.",
    metrics: [
      { metricName: "creatinine", status: "high" },
      { metricName: "urea", status: "high" },
    ],
  },
  {
    id: "elevated_cardiovascular_risk",
    finding: "Elevated Cardiovascular Risk Pattern",
    priority: "high",
    doctorReview: true,
    explanation:
      "LDL and triglycerides are both elevated, a lipid profile associated with higher cardiovascular risk.",
    metrics: [
      { metricName: "ldl", status: "high" },
      { metricName: "triglycerides", status: "high" },
    ],
  },
  {
    id: "possible_infection",
    finding: "Possible Infection",
    priority: "high",
    doctorReview: true,
    explanation:
      "A low white-cell count alongside an elevated temperature can accompany an infection; clinical correlation is essential.",
    metrics: [
      { metricName: "wbc", status: "low" },
      { metricName: "temperature", status: "high" },
    ],
  },
  {
    id: "liver_injury",
    finding: "Possible Liver Injury",
    priority: "high",
    doctorReview: true,
    explanation:
      "ALT and AST are both elevated, the standard enzyme pair suggesting hepatocellular stress or injury.",
    metrics: [
      { metricName: "alt", status: "high" },
      { metricName: "ast", status: "high" },
    ],
  },
  {
    id: "inflammatory_process",
    finding: "Inflammatory Process",
    priority: "high",
    doctorReview: true,
    explanation:
      "CRP and ESR are both elevated — together they indicate an ongoing inflammatory process.",
    metrics: [
      { metricName: "crp", status: "high" },
      { metricName: "esr", status: "high" },
    ],
  },
  {
    id: "hypertensive_pattern",
    finding: "Elevated Blood Pressure Pattern",
    priority: "high",
    doctorReview: true,
    explanation:
      "Both systolic and diastolic pressure are elevated, consistent with sustained blood-pressure elevation.",
    metrics: [
      { metricName: "blood_pressure_systolic", status: "high" },
      { metricName: "blood_pressure_diastolic", status: "high" },
    ],
  },
  {
    id: "metabolic_syndrome_pattern",
    finding: "Possible Metabolic Syndrome Pattern",
    priority: "medium",
    doctorReview: true,
    explanation:
      "Elevated glucose and triglycerides with low HDL — and in this patient an unfavorable BMI — cluster with the metabolic-syndrome picture.",
    metrics: [
      { metricName: "blood_glucose", status: "high" },
      { metricName: "triglycerides", status: "high" },
      { metricName: "hdl", status: "low" },
    ],
    profileCondition: (p) =>
      p.bmiCategory === "overweight" || p.bmiCategory === "obese",
  },
  {
    id: "cardio_metabolic_cluster",
    finding: "Cardio-Metabolic Risk Cluster",
    priority: "medium",
    doctorReview: true,
    explanation:
      "Elevated blood sugar with an elevated HbA1c in a patient who also carries cardiovascular risk factors.",
    metrics: [
      { metricName: "blood_glucose", status: "high" },
      { metricName: "hba1c", status: "high" },
    ],
    profileCondition: (p) =>
      p.knownConditions.includes("diabetes") ||
      p.knownConditions.includes("hypertension") ||
      p.smokingStatus === "daily",
  },
];

const STATUS_RANK: Record<StatusLevel, number> = {
  low: 1,
  normal: 0,
  high: 1,
  critical: 3,
};

/** Member confidence for a metric that satisfied the pattern (0–100). */
function memberConfidence(m: MetricEvaluation): number {
  const base = m.severity === "critical" ? 92 : m.severity === "severe" ? 84 : m.severity === "moderate" ? 76 : 68;
  return base;
}

/**
 * Evaluates all declared patterns against the evaluated metrics.
 *
 * @param metrics metric evaluations from evaluateReport.
 * @param profile optional patient profile (enables profile-gated patterns).
 */
export function evaluateCombinedFindings(
  metrics: MetricEvaluation[],
  profile?: ClinicalProfile | null,
): CombinedFinding[] {
  const byName = new Map<string, MetricEvaluation>();
  for (const m of metrics) byName.set(m.metricName, m);

  const findings: CombinedFinding[] = [];

  for (const pattern of PATTERNS) {
    if (pattern.profileCondition && !profile) continue;
    if (pattern.profileCondition && profile && !pattern.profileCondition(profile)) {
      continue;
    }

    const members: MetricEvaluation[] = [];
    let satisfied = true;
    for (const req of pattern.metrics) {
      const m = byName.get(req.metricName);
      if (!m || m.value === null) {
        satisfied = false;
        break;
      }
      if (STATUS_RANK[m.status] < STATUS_RANK[req.status]) {
        satisfied = false;
        break;
      }
      members.push(m);
    }
    if (!satisfied || members.length === 0) continue;

    const confidence = Math.min(
      98,
      Math.round(
        members.reduce((sum, m) => sum + memberConfidence(m), 0) / members.length,
      ),
    );

    findings.push({
      id: pattern.id,
      finding: pattern.finding,
      confidence,
      priority: pattern.priority,
      doctorReview: pattern.doctorReview,
      explanation: pattern.explanation,
      involvedMetrics: pattern.metrics.map((req) => req.metricName),
    });
  }

  // De-duplicate overlapping patterns: keep the higher-priority one.
  const rank: Record<PriorityLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const seenMetrics = new Map<string, CombinedFinding>();
  for (const f of findings) {
    const key = [...f.involvedMetrics].sort().join("+");
    const existing = seenMetrics.get(key);
    if (!existing || rank[f.priority] > rank[existing.priority]) {
      seenMetrics.set(key, f);
    }
  }

  return [...seenMetrics.values()].sort(
    (a, b) => rank[b.priority] - rank[a.priority] || b.confidence - a.confidence,
  );
}

/** Convenience label lookup for pattern findings. */
export function findingLabel(metricName: string): string {
  return getRule(metricName).label || metricName;
}
