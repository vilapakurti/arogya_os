import type { Profile } from "@/components/auth/supabase-auth-provider";
import { getSupabase } from "@/lib/supabase";

/**
 * Patient Profile — data layer for ArogyaOS.
 *
 * Pure helpers (age/BMI/category calculators, completion scoring) plus the
 * Supabase persistence wrapper. Derived fields (age, age_category, bmi,
 * bmi_category) are stored on the row so future AI modules can read them
 * directly without recomputation.
 */

/* ------------------------------------------------------------------ */
/* Option lists                                                        */
/* ------------------------------------------------------------------ */

export interface Option {
  value: string;
  label: string;
}

export const GENDER_OPTIONS: Option[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

export const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const TRIMESTER_OPTIONS: Option[] = [
  { value: "first", label: "1st" },
  { value: "second", label: "2nd" },
  { value: "third", label: "3rd" },
];

export const SMOKING_OPTIONS: Option[] = [
  { value: "never", label: "Never" },
  { value: "former", label: "Former" },
  { value: "occasionally", label: "Occasionally" },
  { value: "daily", label: "Daily" },
];

export const ALCOHOL_OPTIONS: Option[] = [
  { value: "never", label: "Never" },
  { value: "occasionally", label: "Occasionally" },
  { value: "weekly", label: "Weekly" },
  { value: "daily", label: "Daily" },
];

export const EXERCISE_OPTIONS: Option[] = [
  { value: "sedentary", label: "Sedentary" },
  { value: "light", label: "Light" },
  { value: "moderate", label: "Moderate" },
  { value: "active", label: "Active" },
  { value: "athlete", label: "Athlete" },
];

export const KNOWN_CONDITION_OPTIONS: Option[] = [
  { value: "diabetes", label: "Diabetes" },
  { value: "hypertension", label: "Hypertension" },
  { value: "kidney_disease", label: "Kidney Disease" },
  { value: "liver_disease", label: "Liver Disease" },
  { value: "heart_disease", label: "Heart Disease" },
  { value: "thyroid_disorder", label: "Thyroid Disorder" },
  { value: "asthma", label: "Asthma" },
  { value: "cancer", label: "Cancer" },
  { value: "none", label: "None" },
];

export const FAMILY_HISTORY_OPTIONS: Option[] = [
  { value: "diabetes", label: "Diabetes" },
  { value: "hypertension", label: "Hypertension" },
  { value: "heart_disease", label: "Heart Disease" },
  { value: "kidney_disease", label: "Kidney Disease" },
  { value: "cancer", label: "Cancer" },
  { value: "stroke", label: "Stroke" },
  { value: "none", label: "None" },
];

/* ------------------------------------------------------------------ */
/* Display labels                                                      */
/* ------------------------------------------------------------------ */

export const AGE_CATEGORY_LABELS: Record<string, string> = {
  child: "Child (<18)",
  adult: "Adult (18–59)",
  senior: "Senior (60+)",
};

export const BMI_CATEGORY_LABELS: Record<string, string> = {
  underweight: "Underweight",
  normal: "Normal",
  overweight: "Overweight",
  obese: "Obese",
};

export const EXERCISE_LABELS: Record<string, string> = {
  sedentary: "Sedentary",
  light: "Lightly Active",
  moderate: "Moderately Active",
  active: "Active",
  athlete: "Athlete",
};

export const TRIMESTER_LABELS: Record<string, string> = {
  first: "1st Trimester",
  second: "2nd Trimester",
  third: "3rd Trimester",
};

/** Human-readable summary of a stored multi-select (e.g. known conditions). */
export function describeSelections(
  values: string[] | null | undefined,
  options: Option[],
): string {
  const list = values ?? [];
  if (list.length === 0) return "None recorded";
  if (list.includes("none")) return "None";
  return list
    .map((v) => options.find((o) => o.value === v)?.label ?? v)
    .join(", ");
}

/* ------------------------------------------------------------------ */
/* Derived-field calculators                                           */
/* ------------------------------------------------------------------ */

export type AgeCategory = "child" | "adult" | "senior";
export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";

/** Whole years between a date of birth and today. Null when unset/invalid. */
export function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function ageCategoryOf(age: number | null): AgeCategory | null {
  if (age === null) return null;
  if (age < 18) return "child";
  if (age <= 59) return "adult";
  return "senior";
}

/** BMI = kg / (m^2), rounded to 1 decimal. Null when inputs are missing. */
export function calculateBmi(
  weightKg: number | null,
  heightCm: number | null,
): number | null {
  if (!weightKg || !heightCm || heightCm <= 0) return null;
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  if (!Number.isFinite(bmi) || bmi <= 0) return null;
  return Math.round(bmi * 10) / 10;
}

export function bmiCategoryOf(bmi: number | null): BmiCategory | null {
  if (bmi === null) return null;
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

/** Accepts optional leading +, spaces, dashes, parens, dots; 7–15 digits. */
export function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone || !phone.trim()) return true;
  const trimmed = phone.trim();
  if (!/^[+\d\s\-().]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/* ------------------------------------------------------------------ */
/* Field validators (UI-level)                                         */
/* ------------------------------------------------------------------ */

export function validateHeight(value: string): string | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 50 || n > 250) return "Height must be between 50 and 250 cm.";
  return null;
}

export function validateWeight(value: string): string | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 2 || n > 300) return "Weight must be between 2 and 300 kg.";
  return null;
}

export function validatePhone(value: string): string | null {
  if (value.trim() === "") return null;
  if (!isValidPhone(value)) return "Enter a valid phone number (7–15 digits).";
  return null;
}

/* ------------------------------------------------------------------ */
/* Form model                                                          */
/* ------------------------------------------------------------------ */

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
}

/** The editable draft state of the Patient Profile page. */
export interface PatientForm {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  heightCm: string;
  weightKg: string;
  pregnant: "" | "yes" | "no";
  trimester: string;
  smokingStatus: string;
  alcoholStatus: string;
  exerciseLevel: string;
  knownConditions: string[];
  familyHistory: string[];
  allergies: string;
  medications: Medication[];
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
}

export const EMPTY_PATIENT_FORM: PatientForm = {
  fullName: "",
  dateOfBirth: "",
  gender: "",
  bloodGroup: "",
  heightCm: "",
  weightKg: "",
  pregnant: "",
  trimester: "",
  smokingStatus: "",
  alcoholStatus: "",
  exerciseLevel: "",
  knownConditions: [],
  familyHistory: [],
  allergies: "",
  medications: [],
  emergencyName: "",
  emergencyRelationship: "",
  emergencyPhone: "",
};

/** Converts a stored profile row into the editable form draft. */
export function profileToForm(p: Partial<Profile> | null | undefined): PatientForm {
  const conditions = p?.known_conditions;
  const history = p?.family_history;
  const meds = p?.current_medications;
  return {
    fullName: p?.full_name ?? "",
    dateOfBirth: p?.date_of_birth ?? "",
    gender: p?.gender ?? "",
    bloodGroup: p?.blood_group ?? "",
    heightCm: p?.height_cm != null ? String(p.height_cm) : "",
    weightKg: p?.weight_kg != null ? String(p.weight_kg) : "",
    pregnant: p?.pregnant === true ? "yes" : p?.pregnant === false ? "no" : "",
    trimester: p?.trimester ?? "",
    smokingStatus: p?.smoking_status ?? "",
    alcoholStatus: p?.alcohol_status ?? "",
    exerciseLevel: p?.exercise_level ?? "",
    knownConditions: Array.isArray(conditions) ? conditions : [],
    familyHistory: Array.isArray(history) ? history : [],
    allergies: p?.allergies ?? "",
    medications: Array.isArray(meds) ? (meds as Medication[]) : [],
    emergencyName: p?.emergency_contact_name ?? "",
    emergencyRelationship: p?.emergency_contact_relationship ?? "",
    emergencyPhone: p?.emergency_contact_phone ?? "",
  };
}

/** Converts the editable draft into a Partial<Profile> for completion scoring. */
export function formToProfile(p: PatientForm): Partial<Profile> {
  const height = Number(p.heightCm);
  const weight = Number(p.weightKg);
  return {
    full_name: p.fullName.trim() || null,
    date_of_birth: p.dateOfBirth || null,
    gender: p.gender || null,
    blood_group: p.bloodGroup || null,
    height_cm: p.heightCm.trim() !== "" && Number.isFinite(height) ? height : null,
    weight_kg: p.weightKg.trim() !== "" && Number.isFinite(weight) ? weight : null,
    pregnant:
      p.gender === "female"
        ? p.pregnant === "yes"
          ? true
          : p.pregnant === "no"
            ? false
            : null
        : null,
    trimester:
      p.gender === "female" && p.pregnant === "yes" ? p.trimester || null : null,
    smoking_status: p.smokingStatus || null,
    alcohol_status: p.alcoholStatus || null,
    exercise_level: p.exerciseLevel || null,
    known_conditions: p.knownConditions,
    family_history: p.familyHistory,
    allergies: p.allergies.trim() || null,
    current_medications: p.medications,
    emergency_contact_name: p.emergencyName.trim() || null,
    emergency_contact_relationship: p.emergencyRelationship.trim() || null,
    emergency_contact_phone: p.emergencyPhone.trim() || null,
  };
}

/**
 * Builds the upsert payload for the profiles row.
 * Invalid (out-of-range) height/weight/phone values are skipped entirely so
 * the previously saved value is preserved; empty fields are cleared to null.
 */
export function formToPatch(form: PatientForm): Record<string, unknown> {
  const heightRaw = form.heightCm.trim();
  const weightRaw = form.weightKg.trim();
  const heightNum = Number(heightRaw);
  const weightNum = Number(weightRaw);
  const heightValid =
    heightRaw !== "" && Number.isFinite(heightNum) && heightNum >= 50 && heightNum <= 250;
  const weightValid =
    weightRaw !== "" && Number.isFinite(weightNum) && weightNum >= 2 && weightNum <= 300;
  const canComputeBmi = heightValid && weightValid;
  const bothEmpty = heightRaw === "" && weightRaw === "";
  const bmi = canComputeBmi ? calculateBmi(weightNum, heightNum) : null;
  const phoneRaw = form.emergencyPhone.trim();

  const patch: Record<string, unknown> = {
    full_name: form.fullName.trim() || null,
    date_of_birth: form.dateOfBirth || null,
    gender: form.gender || null,
    blood_group: form.bloodGroup || null,
    smoking_status: form.smokingStatus || null,
    alcohol_status: form.alcoholStatus || null,
    exercise_level: form.exerciseLevel || null,
    known_conditions: form.knownConditions,
    family_history: form.familyHistory,
    allergies: form.allergies.trim() || null,
    current_medications: form.medications
      .map((m) => ({
        name: m.name.trim(),
        dosage: m.dosage.trim(),
        frequency: m.frequency.trim(),
      }))
      .filter((m) => m.name || m.dosage || m.frequency),
    emergency_contact_name: form.emergencyName.trim() || null,
    emergency_contact_relationship: form.emergencyRelationship.trim() || null,
  };

  // height / weight
  if (heightRaw === "") patch.height_cm = null;
  else if (heightValid) patch.height_cm = heightNum;
  if (weightRaw === "") patch.weight_kg = null;
  else if (weightValid) patch.weight_kg = weightNum;

  // derived BMI
  if (canComputeBmi) {
    patch.bmi = bmi;
    patch.bmi_category = bmiCategoryOf(bmi);
  } else if (bothEmpty) {
    patch.bmi = null;
    patch.bmi_category = null;
  }

  // derived age + age category
  const age = calculateAge(form.dateOfBirth);
  if (form.dateOfBirth === "") {
    patch.age = null;
    patch.age_category = null;
  } else if (age !== null) {
    patch.age = age;
    patch.age_category = ageCategoryOf(age);
  }

  // pregnancy (only meaningful for female)
  if (form.gender === "female") {
    patch.pregnant = form.pregnant === "yes" ? true : form.pregnant === "no" ? false : null;
    patch.trimester = form.pregnant === "yes" ? form.trimester || null : null;
  } else {
    patch.pregnant = null;
    patch.trimester = null;
  }

  // emergency phone (validated)
  if (phoneRaw === "") patch.emergency_contact_phone = null;
  else if (isValidPhone(phoneRaw)) patch.emergency_contact_phone = phoneRaw;

  return patch;
}

/* ------------------------------------------------------------------ */
/* Profile completion                                                  */
/* ------------------------------------------------------------------ */

export interface CompletionResult {
  percent: number;
  completed: number;
  total: number;
}

/**
 * Scores how much of the patient profile has been completed.
 * The pregnancy/trimester fields only count for female users.
 */
export function computeProfileCompletion(
  p: Partial<Profile> | null | undefined,
): CompletionResult {
  const isFemale = p?.gender === "female";
  const isPregnant = isFemale && typeof p?.pregnant === "boolean" && p.pregnant === true;
  const total = 16 + (isFemale ? 1 : 0) + (isPregnant ? 1 : 0);

  const filled = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
  const hasText = (v: unknown): boolean =>
    typeof v === "string" && v.trim().length > 0;
  const hasItems = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

  let completed = 0;
  if (hasText(p?.full_name)) completed++;
  if (filled(p?.date_of_birth)) completed++;
  if (filled(p?.gender)) completed++;
  if (filled(p?.blood_group)) completed++;
  if (typeof p?.height_cm === "number" && p.height_cm > 0) completed++;
  if (typeof p?.weight_kg === "number" && p.weight_kg > 0) completed++;
  if (isFemale && typeof p?.pregnant === "boolean") completed++;
  if (isPregnant && filled(p?.trimester)) completed++;
  if (filled(p?.smoking_status)) completed++;
  if (filled(p?.alcohol_status)) completed++;
  if (filled(p?.exercise_level)) completed++;
  if (hasItems(p?.known_conditions)) completed++;
  if (hasItems(p?.family_history)) completed++;
  if (hasText(p?.allergies)) completed++;
  if (hasItems(p?.current_medications)) completed++;
  if (hasText(p?.emergency_contact_name)) completed++;
  if (hasText(p?.emergency_contact_relationship)) completed++;
  if (hasText(p?.emergency_contact_phone) && isValidPhone(p?.emergency_contact_phone)) completed++;

  const percent = total === 0 ? 0 : Math.min(100, Math.round((completed / total) * 100));
  return { percent, completed, total };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

/** Thrown when the patient-profile columns are missing (migration not applied). */
export class PatientProfileSchemaError extends Error {
  constructor() {
    super(
      "The Patient Profile database schema hasn't been applied yet. Open the Supabase SQL editor and run supabase/migrations/0007_patient_profile.sql, then reload this page.",
    );
    this.name = "PatientProfileSchemaError";
  }
}

/** Upserts the patient profile fields for the signed-in user. */
export async function savePatientProfile(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("profiles")
    .upsert({ id: userId, updated_at: new Date().toISOString(), ...patch });
  if (!error) return;
  if (/PGRST204|PGRST205|column .* does not exist|relation .* does not exist/i.test(error.message)) {
    throw new PatientProfileSchemaError();
  }
  throw error;
}
