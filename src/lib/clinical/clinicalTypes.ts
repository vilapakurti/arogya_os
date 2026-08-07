/**
 * ArogyaOS — Clinical Decision Support Engine (CDSS)
 * Shared types. The engine is pure TypeScript (no React / Supabase / Convex
 * imports) so it can run anywhere: browser, node, or inside a Convex action.
 *
 * This is a CLINICAL DECISION SUPPORT SYSTEM, not a diagnostic system.
 * Every output is advisory and must be confirmed by a qualified clinician.
 */

export type Gender = "male" | "female" | "other";
export type AgeCategory = "child" | "adult" | "senior";
export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";
export type Trimester = "first" | "second" | "third";
export type TrendDirection = "increasing" | "decreasing" | "stable";

/** Patient factors the engine personalizes against (from the Patient Profile). */
export interface ClinicalProfile {
  age: number | null;
  ageCategory: AgeCategory | null;
  gender: Gender | null;
  pregnant: boolean | null;
  trimester: Trimester | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  bmiCategory: BmiCategory | null;
  knownConditions: string[];
  familyHistory: string[];
  /** never | former | occasionally | daily */
  smokingStatus: string | null;
  /** never | occasionally | weekly | daily */
  alcoholStatus: string | null;
  /** sedentary | light | moderate | active | athlete */
  exerciseLevel: string | null;
  bloodGroup: string | null;
}

export const EMPTY_CLINICAL_PROFILE: ClinicalProfile = {
  age: null,
  ageCategory: null,
  gender: null,
  pregnant: null,
  trimester: null,
  heightCm: null,
  weightKg: null,
  bmi: null,
  bmiCategory: null,
  knownConditions: [],
  familyHistory: [],
  smokingStatus: null,
  alcoholStatus: null,
  exerciseLevel: null,
  bloodGroup: null,
};

/** One metric reading plus everything the engine may use to interpret it. */
export interface MetricInput {
  metricName: string;
  value: number | null;
  unit?: string | null;
  /** Lab-provided reference range from the report (population). */
  populationMin?: number | null;
  populationMax?: number | null;
  /** APBE personal rolling average. */
  personalBaseline?: number | null;
  /** APBE latest z-score (vs the user's own baseline). */
  zScore?: number | null;
  /** APBE five-way personal classification. */
  personalClass?: string | null;
  direction?: TrendDirection | null;
  percentageChange?: number | null;
  /** Chronological readings for this metric (oldest → newest). */
  history?: number[];
}

export type StatusLevel = "low" | "normal" | "high" | "critical";
export type SeverityLevel =
  | "unknown"
  | "normal"
  | "mild"
  | "moderate"
  | "severe"
  | "critical";
export type PriorityLevel = "low" | "medium" | "high" | "critical";
export type RiskLevel = "low" | "moderate" | "high" | "critical";

export interface ReferenceRange {
  min: number | null;
  max: number | null;
  /** Where the range came from: the lab report, the engine's personalized
   *  rules, the generic population default, or nothing usable. */
  source: "lab" | "personalized" | "population" | "unavailable";
  /** Human-readable list of applied personalization factors. */
  rationale?: string[];
}

export interface TrendEvaluation {
  direction: TrendDirection;
  percentageChange: number | null;
  clinicalInterpretation: string;
  /** 0–100 deterministic confidence in the trend reading. */
  confidence: number;
  priority: PriorityLevel;
  recommendation: string;
}

export interface EmergencyFlag {
  isEmergency: boolean;
  flag?: string;
  message?: string;
}

/** The full per-metric clinical output every AI module consumes. */
export interface MetricEvaluation {
  metricName: string;
  label: string;
  value: number | null;
  unit: string | null;
  referenceRange: ReferenceRange;
  populationRange: { min: number | null; max: number | null } | null;
  personalBaseline: number | null;
  status: StatusLevel;
  severity: SeverityLevel;
  priority: PriorityLevel;
  trend: TrendEvaluation;
  clinicalMeaning: string;
  possibleCauses: string[];
  possibleRisks: string[];
  recommendations: string[];
  doctorReviewRequired: boolean;
  emergency: EmergencyFlag;
  /** 0–100 deterministic confidence in this evaluation. */
  confidence: number;
  source: "engine";
}

export interface EmergencyFinding {
  metricName: string;
  label: string;
  value: number | null;
  flag: string;
  message: string;
  immediateDoctorReview: boolean;
  seekMedicalAttention: boolean;
  priority: "critical";
}

export type RiskCategoryKey =
  | "cardiovascular"
  | "kidney"
  | "diabetes"
  | "liver"
  | "inflammation"
  | "anemia"
  | "metabolic";

export interface RiskCategory {
  key: RiskCategoryKey;
  label: string;
  level: RiskLevel;
  /** 0–100 composite score. */
  score: number;
  contributors: string[];
}

export interface CombinedFinding {
  id: string;
  finding: string;
  /** 0–100 confidence the pattern is present. */
  confidence: number;
  priority: PriorityLevel;
  doctorReview: boolean;
  explanation: string;
  involvedMetrics: string[];
}

export interface ReportEvaluation {
  metrics: MetricEvaluation[];
  combinedFindings: CombinedFinding[];
  riskProfile: RiskCategory[];
  emergencies: EmergencyFinding[];
  overallSeverity: SeverityLevel;
  overallPriority: PriorityLevel;
  /** Plain-language one-paragraph summary. */
  summary: string;
  generatedAt: number;
}

export interface PatientRiskSummary {
  riskProfile: RiskCategory[];
  riskFlags: string[];
  overallLevel: RiskLevel;
  lifestyleAdvice: string[];
  summary: string;
}

/** Shown verbatim anywhere AI output is displayed. */
export const CDSS_DISCLAIMER =
  "ArogyaOS is a clinical decision support system, not a diagnostic system. " +
  "All findings are advisory, educational, and must be confirmed by a qualified medical professional.";

/** Standard medical-condition keys used by the Patient Profile. */
export const CONDITION_KEYS = [
  "diabetes",
  "hypertension",
  "kidney_disease",
  "liver_disease",
  "heart_disease",
  "thyroid_disorder",
  "asthma",
  "cancer",
] as const;
