/**
 * ArogyaOS — Clinical Decision Support Engine (CDSS)
 * Public entry point. AI modules import from "@/lib/clinical" only.
 *
 *   import { evaluateReport, evaluatePatient, ... } from "@/lib/clinical";
 */

export * from "./clinicalTypes";
export * from "./clinicalRules";
export * from "./referenceRanges";
export * from "./riskEngine";
export * from "./combinedFindings";
export {
  evaluateMetric,
  evaluateReport,
  evaluatePatient,
  evaluateTrend,
  evaluateEmergency,
  getClinicalMeaning,
} from "./clinicalEngine";

/* ------------------------------------------------------------------ */
/* Adapter: app Profile row → ClinicalProfile                          */
/* ------------------------------------------------------------------ */

/**
 * Structural subset of the app's `profiles` row (from the auth provider).
 * Declared structurally so this module stays free of component imports.
 */
export interface ProfileLike {
  age?: number | null;
  age_category?: string | null;
  gender?: string | null;
  pregnant?: boolean | null;
  trimester?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  bmi?: number | null;
  bmi_category?: string | null;
  known_conditions?: string[] | null;
  family_history?: string[] | null;
  smoking_status?: string | null;
  alcohol_status?: string | null;
  exercise_level?: string | null;
  blood_group?: string | null;
}

/**
 * Converts the stored patient profile into the engine's ClinicalProfile.
 * Missing values become null/[] so the engine safely uses population
 * defaults for anything the user hasn't filled in.
 */
export function toClinicalProfile(
  profile: ProfileLike | null | undefined,
): import("./clinicalTypes").ClinicalProfile {
  const p = profile ?? {};
  return {
    age: p.age ?? null,
    ageCategory: (p.age_category as "child" | "adult" | "senior" | null | undefined) ?? null,
    gender: (p.gender as "male" | "female" | "other" | null | undefined) ?? null,
    pregnant: p.pregnant ?? null,
    trimester: (p.trimester as "first" | "second" | "third" | null | undefined) ?? null,
    heightCm: p.height_cm ?? null,
    weightKg: p.weight_kg ?? null,
    bmi: p.bmi ?? null,
    bmiCategory: (p.bmi_category as
      | "underweight"
      | "normal"
      | "overweight"
      | "obese"
      | null
      | undefined) ?? null,
    knownConditions: Array.isArray(p.known_conditions)
      ? p.known_conditions.filter((c) => c !== "none")
      : [],
    familyHistory: Array.isArray(p.family_history)
      ? p.family_history.filter((c) => c !== "none")
      : [],
    smokingStatus: p.smoking_status ?? null,
    alcoholStatus: p.alcohol_status ?? null,
    exerciseLevel: p.exercise_level ?? null,
    bloodGroup: p.blood_group ?? null,
  };
}
