/**
 * ArogyaOS — Clinical Decision Support Engine (CDSS)
 * Clinical rules. This file is the single source of medical thresholds and
 * plain-language clinical knowledge. The engine (clinicalEngine.ts) contains
 * NO medical thresholds — it only applies these rules. Adding support for a
 * new lab metric = adding one entry to `METRIC_RULES`; no application logic
 * changes.
 *
 * Thresholds are approximate adult population references used for decision
 * support and education only. They are not diagnostic cut-offs. Every output
 * must be confirmed by a clinician.
 *
 * Source traceability: each rule carries `source` metadata naming the
 * guideline / body the threshold is based on. Where a threshold is a
 * laboratory-dependent reference interval (varies by lab, assay, age, sex,
 * pregnancy, or methodology), `review: true` marks it for clinician
 * verification — an exact citation is intentionally NOT invented for it.
 *
 * Unit handling: rules are written in one canonical unit (rule.unit). The
 * `unitConversions` map converts the rule's range into the unit a report
 * actually used (e.g. glucose in mmol/L) so the engine never compares values
 * expressed in different units without conversion.
 *
 * Rule shape:
 *  - populationMin/Max        base reference range (before personalization)
 *  - lowerIsBetter            a LOWER value is the healthy direction
 *  - meanings/causes/risks/recommendations keyed by value status
 *  - trendMeaning             what increasing / decreasing implies clinically
 *  - trendRecommendation      recommendation when the trend is improving /
 *                             stable / worsening
 *  - emergency                absolute critical thresholds, in the rule's
 *                             canonical unit (min = critical below, max =
 *                             critical above), flagged regardless of the
 *                             personalized range
 *  - riskContributions        weights fed to the risk engine per status level
 *  - personalized             reference-range adjustments per demographics
 *  - unitConversions          rule-unit → report-unit numeric multipliers
 *  - source                   traceability metadata for the threshold
 */

import type {
  BmiCategory,
  Gender,
  RiskCategoryKey,
  StatusLevel,
  Trimester,
} from "./clinicalTypes";

/* ------------------------------------------------------------------ */
/* Status severity points (mild=1 … critical=4)                        */
/* ------------------------------------------------------------------ */

export const SEVERITY_POINTS: Record<StatusLevel, number> = {
  low: 1,
  normal: 0,
  high: 1,
  critical: 4,
};

/** Multiplier applied to a metric's risk weight by its status severity. */
export const SEVERITY_MULTIPLIER: Record<StatusLevel, number> = {
  low: 1,
  normal: 0,
  high: 1,
  critical: 2.5,
};

/* ------------------------------------------------------------------ */
/* Rule types                                                          */
/* ------------------------------------------------------------------ */

export interface RangeOverride {
  min?: number;
  max?: number;
}

/** Traceability metadata for a clinical threshold. */
export interface RuleSource {
  /** Organization / body behind the threshold. */
  source: string;
  /** Guideline or document name, when known. */
  guideline?: string;
  /** Year or edition (e.g. "2018" or "current edition (2026)"). */
  year?: number | string;
  /** Free-text pointer to the relevant cut-off (never a fabricated URL). */
  reference?: string;
  /** True when the exact threshold is lab/assay/methodology-dependent and
   *  needs clinician verification rather than a hard citation. */
  review?: boolean;
}

export interface MetricRule {
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  populationMin?: number;
  populationMax?: number;
  meanings: Partial<Record<StatusLevel, string>>;
  causes: Partial<Record<StatusLevel, string[]>>;
  risks: Partial<Record<StatusLevel, string[]>>;
  recommendations: Partial<Record<StatusLevel, string[]>>;
  trendMeaning: { increasing: string; decreasing: string };
  trendRecommendation: { improving: string; stable: string; worsening: string };
  /**
   * Absolute critical thresholds, always expressed in the rule's canonical
   * unit (converted when a report uses another unit):
   *   min — critical when the value is BELOW min (e.g. Hb < 7 g/dL)
   *   max — critical when the value is ABOVE max (e.g. K+ > 6.5 mmol/L)
   * These are emergency cut-offs, distinct from the reference range. A
   * critically-LOW condition (hemoglobin, platelets, oxygen saturation) must
   * be declared with `min`, never with `max`.
   */
  emergency?: { min?: number; max?: number; flag: string; message: string };
  riskContributions?: Partial<Record<RiskCategoryKey, number>>;
  /** Reference-range personalization. */
  personalized?: {
    byGender?: Partial<Record<Gender, RangeOverride>>;
    byAgeCategory?: { child?: RangeOverride; senior?: RangeOverride };
    byPregnant?: RangeOverride;
    byTrimester?: Partial<Record<Trimester, RangeOverride>>;
    byCondition?: Record<string, RangeOverride>;
    byExercise?: { athlete?: RangeOverride };
  };
  /**
   * Converts values in the rule's canonical unit into a report's unit:
   * `value_in_rule_unit × factor = value_in_report_unit`. Keys are the
   * normalized report unit strings (lowercase, no spaces, "µ"→"u").
   * Used so the engine never compares rule-unit ranges against values
   * expressed in another unit.
   */
  unitConversions?: Record<string, number>;
  /** Traceability for the threshold (see RuleSource above). */
  source?: RuleSource;
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export const METRIC_RULES: Record<string, MetricRule> = {
  /* ---- Complete blood count ---- */
  hemoglobin: {
    label: "Hemoglobin",
    unit: "g/dL",
    lowerIsBetter: false,
    populationMin: 13,
    populationMax: 17,
    meanings: {
      low: "Lower than the expected range — consistent with anemia and warrants a clinician review.",
      normal: "Within the expected range.",
      high: "Higher than the expected range — may reflect dehydration, high altitude, or a blood disorder.",
      critical: "Critically low — requires immediate medical attention.",
    },
    causes: {
      low: ["Iron deficiency", "Chronic disease", "Blood loss", "Nutritional deficiency (B12/folate)"],
      high: ["Dehydration", "Smoking", "High altitude exposure", "Polycythemia"],
      critical: ["Acute blood loss", "Severe hemolysis", "Bone marrow failure"],
    },
    risks: { low: ["Anemia", "Fatigue", "Reduced oxygen delivery"], critical: ["Organ hypoperfusion", "Cardiac strain"] },
    recommendations: {
      low: ["Discuss iron studies and a re-check with your doctor", "Review diet for iron and B12 sources"],
      high: ["Confirm with a repeat test after hydration", "Discuss causes with your doctor"],
      critical: ["Seek medical attention immediately"],
    },
    trendMeaning: { increasing: "Hemoglobin is rising", decreasing: "Hemoglobin is falling" },
    trendRecommendation: {
      improving: "Improving towards the normal range — continue current management",
      stable: "Continue monitoring",
      worsening: "Trending away from normal — worth discussing with your doctor",
    },
    emergency: {
      min: 7,
      flag: "critically_low_hemoglobin",
      message: "Hemoglobin is critically low — seek immediate medical attention.",
    },
    riskContributions: { anemia: 30 },
    personalized: {
      byGender: {
        female: { min: 12, max: 15.5 },
        male: { min: 13.5, max: 17.5 },
      },
      byPregnant: { min: 11, max: 14 },
      byAgeCategory: { child: { min: 11.5, max: 15.5 } },
    },
    unitConversions: { "g/l": 10 },
    source: {
      source: "WHO",
      guideline: "Haemoglobin concentrations for the diagnosis of anaemia and assessment of severity",
      year: 2011,
      reference: "Anaemia cut-offs: men <13.0 g/dL, non-pregnant women <12.0, pregnant <11.0",
      review: true,
    },
  },

  rbc: {
    label: "RBC",
    unit: "10^6/uL",
    lowerIsBetter: false,
    populationMin: 4.2,
    populationMax: 6.1,
    meanings: {
      low: "Red cell count is below the expected range — commonly seen with anemia.",
      normal: "Within the expected range.",
      high: "Red cell count is above the expected range.",
      critical: "Critically low red cell count — requires immediate attention.",
    },
    causes: { low: ["Anemia", "Blood loss", "Bone marrow suppression"], high: ["Dehydration", "Polycythemia"] },
    risks: { low: ["Anemia", "Reduced oxygen transport"] },
    recommendations: {
      low: ["Ask your doctor about an anemia work-up (iron, B12, folate)"],
      high: ["Confirm with a repeat test after hydration"],
    },
    trendMeaning: { increasing: "RBC count is rising", decreasing: "RBC count is falling" },
    trendRecommendation: { improving: "Continue monitoring", stable: "Continue monitoring", worsening: "Worth discussing with your doctor" },
    riskContributions: { anemia: 20 },
    personalized: {
      byGender: {
        female: { min: 4.2, max: 5.4 },
        male: { min: 4.7, max: 6.1 },
      },
      byPregnant: { min: 3.8, max: 5.2 },
    },
    unitConversions: { "million/ul": 1 },
    source: {
      source: "General laboratory reference",
      reference: "RBC reference intervals vary by lab and altitude; gender-specific ranges used",
      review: true,
    },
  },

  wbc: {
    label: "WBC",
    unit: "10^3/uL",
    lowerIsBetter: false,
    populationMin: 4,
    populationMax: 11,
    meanings: {
      low: "White cell count is below the expected range — may indicate infection, medication effect, or marrow suppression.",
      normal: "Within the expected range.",
      high: "White cell count is above the expected range — commonly a response to infection or inflammation.",
      critical: "Extreme white cell count — requires urgent review.",
    },
    causes: { low: ["Viral infection", "Medication effect", "Bone marrow suppression"], high: ["Bacterial infection", "Inflammation", "Stress response"] },
    risks: { high: ["Infection", "Inflammatory process"] },
    recommendations: {
      low: ["Discuss possible causes with your doctor", "Monitor for fever or infection signs"],
      high: ["Discuss with your doctor — may need a repeat test"],
    },
    trendMeaning: { increasing: "WBC is rising", decreasing: "WBC is falling" },
    trendRecommendation: { improving: "Continue monitoring", stable: "Continue monitoring", worsening: "Worth discussing with your doctor" },
    riskContributions: { inflammation: 20 },
    unitConversions: { "10^9/l": 1 },
    source: {
      source: "General laboratory reference",
      reference: "4.0–11.0 ×10⁹/L widely used",
      review: true,
    },
  },

  platelets: {
    label: "Platelets",
    unit: "10^3/uL",
    lowerIsBetter: false,
    populationMin: 150,
    populationMax: 450,
    meanings: {
      low: "Platelet count is below the expected range — increases bleeding risk.",
      normal: "Within the expected range.",
      high: "Platelet count is above the expected range — may increase clotting risk.",
      critical: "Critically low platelets — risk of spontaneous bleeding.",
    },
    causes: { low: ["Immune thrombocytopenia", "Medication effect", "Marrow suppression"], high: ["Reactive (inflammation)", "Iron deficiency"] },
    risks: { low: ["Bleeding risk"], high: ["Clotting risk"] },
    recommendations: {
      low: ["Discuss bleeding precautions with your doctor", "Seek care if bruising or bleeding occurs"],
      high: ["Discuss with your doctor — may warrant a repeat test"],
      critical: ["Seek medical attention immediately"],
    },
    trendMeaning: { increasing: "Platelets are rising", decreasing: "Platelets are falling" },
    trendRecommendation: { improving: "Continue monitoring", stable: "Continue monitoring", worsening: "Worth discussing with your doctor" },
    emergency: {
      min: 20,
      flag: "critically_low_platelets",
      message: "Platelets are critically low — risk of bleeding. Seek immediate medical attention.",
    },
    unitConversions: { "10^9/l": 1 },
    source: {
      source: "General laboratory reference",
      reference: "150–450 ×10⁹/L widely used; <20 ×10⁹/L associated with major bleeding risk",
      review: true,
    },
  },

  /* ---- Diabetes / glucose ---- */
  blood_glucose: {
    label: "Blood Sugar",
    unit: "mg/dL",
    lowerIsBetter: true,
    populationMin: 70,
    populationMax: 100,
    meanings: {
      low: "Blood sugar is below the expected range (possible hypoglycemia).",
      normal: "Within the expected fasting range.",
      high: "Blood sugar is above the expected range — warrants discussion.",
      critical: "Dangerously high blood sugar — requires immediate attention.",
    },
    causes: { low: ["Fasting", "Medication effect", "Hypoglycemia"], high: ["Carbohydrate load", "Insulin resistance", "Diabetes", "Stress hormones"] },
    risks: { high: ["Prediabetes", "Diabetes progression"], critical: ["Hyperglycemic emergency"] },
    recommendations: {
      low: ["If symptomatic, follow your doctor's hypoglycemia plan", "Confirm with a repeat reading"],
      high: ["Discuss with your doctor", "Review diet and activity"],
      critical: ["Seek immediate medical attention"],
    },
    trendMeaning: { increasing: "Blood sugar is rising", decreasing: "Blood sugar is falling" },
    trendRecommendation: {
      improving: "Improving towards the target — continue current approach",
      stable: "Continue monitoring",
      worsening: "Rising blood sugar — discuss with your doctor",
    },
    emergency: { min: 40, max: 500, flag: "extreme_blood_glucose", message: "Blood sugar is dangerously out of range — seek immediate medical attention." },
    riskContributions: { diabetes: 30, metabolic: 20 },
    personalized: {
      byPregnant: { max: 92 },
      byCondition: { diabetes: { min: 80, max: 130, } },
    },
    unitConversions: { "mmol/l": 1 / 18.016 },
    source: {
      source: "ADA",
      guideline: "Standards of Care in Diabetes",
      year: "current edition (2026)",
      reference: "Fasting <100 mg/dL normal; 100–125 impaired fasting glucose; ≥126 mg/dL diabetes; pregnancy fasting <92 mg/dL",
    },
  },

  hba1c: {
    label: "HbA1c",
    unit: "%",
    lowerIsBetter: true,
    populationMin: 4,
    populationMax: 5.6,
    meanings: {
      low: "HbA1c is below the expected range.",
      normal: "Within the expected range — good long-term glucose control.",
      high: "HbA1c is above the expected range — indicates elevated average glucose over ~3 months.",
      critical: "Very high HbA1c — sustained high glucose.",
    },
    causes: { high: ["Elevated average glucose", "Diabetes or prediabetes", "Insulin resistance"] },
    risks: { high: ["Prediabetes", "Diabetes progression", "Long-term complications"] },
    recommendations: {
      high: ["Discuss with your doctor", "Review diet, activity and medication adherence"],
    },
    trendMeaning: { increasing: "Long-term glucose is rising", decreasing: "Long-term glucose is improving" },
    trendRecommendation: {
      improving: "Improving — continue current management",
      stable: "Continue monitoring",
      worsening: "Rising HbA1c — important to discuss with your doctor",
    },
    riskContributions: { diabetes: 40, cardiovascular: 10 },
    personalized: {
      byPregnant: { max: 5.4 },
      byCondition: { diabetes: { min: 4, max: 7 } },
    },
    source: {
      source: "ADA",
      guideline: "Standards of Care in Diabetes",
      year: "current edition (2026)",
      reference: "Normal <5.7%; prediabetes 5.7–6.4%; diabetes ≥6.5%; general adult treatment target <7.0%",
    },
  },

  /* ---- Lipids ---- */
  cholesterol_total: {
    label: "Total Cholesterol",
    unit: "mg/dL",
    lowerIsBetter: true,
    populationMin: 0,
    populationMax: 200,
    meanings: {
      normal: "Within the expected range.",
      high: "Total cholesterol is above the expected range.",
    },
    causes: { high: ["Dietary fat intake", "Genetics", "Inactivity", "Metabolic factors"] },
    risks: { high: ["Cardiovascular risk"] },
    recommendations: { high: ["Discuss lipid profile with your doctor", "Review diet and activity"] },
    trendMeaning: { increasing: "Cholesterol is rising", decreasing: "Cholesterol is improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising cholesterol — discuss with your doctor" },
    riskContributions: { cardiovascular: 20, metabolic: 10 },
    unitConversions: { "mmol/l": 1 / 38.67 },
    source: {
      source: "NCEP ATP III",
      year: 2001,
      reference: "Desirable <200 mg/dL; borderline 200–239; high ≥240",
    },
  },

  ldl: {
    label: "LDL",
    unit: "mg/dL",
    lowerIsBetter: true,
    populationMin: 0,
    populationMax: 100,
    meanings: {
      normal: "Within the expected range.",
      high: "LDL ('bad') cholesterol is above the expected range.",
    },
    causes: { high: ["Dietary saturated fat", "Genetics", "Inactivity"] },
    risks: { high: ["Atherosclerosis", "Cardiovascular risk"] },
    recommendations: { high: ["Discuss cardiovascular risk with your doctor", "Review diet, activity, and statin need with a clinician"] },
    trendMeaning: { increasing: "LDL is rising", decreasing: "LDL is improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising LDL — discuss with your doctor" },
    riskContributions: { cardiovascular: 30, metabolic: 10 },
    personalized: { byCondition: { diabetes: { max: 70 }, heart_disease: { max: 70 } } },
    unitConversions: { "mmol/l": 1 / 38.67 },
    source: {
      source: "ACC/AHA + NCEP ATP III",
      guideline: "2018 Guideline on the Management of Blood Cholesterol",
      year: 2018,
      reference: "Optimal <100 mg/dL; <70 mg/dL for ASCVD/high-risk; ≥190 mg/dL very high",
    },
  },

  hdl: {
    label: "HDL",
    unit: "mg/dL",
    lowerIsBetter: false,
    populationMin: 40,
    populationMax: 100,
    meanings: {
      low: "HDL ('good') cholesterol is below the expected range.",
      normal: "Within the expected range.",
      high: "Above the expected range — generally favorable.",
    },
    causes: { low: ["Inactivity", "Smoking", "Dietary factors"] },
    risks: { low: ["Cardiovascular risk"] },
    recommendations: { low: ["Increase activity", "Discuss lifestyle changes with your doctor"] },
    trendMeaning: { increasing: "HDL is rising", decreasing: "HDL is falling" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Falling HDL — discuss with your doctor" },
    riskContributions: { cardiovascular: 20 },
    personalized: { byGender: { male: { min: 40 }, female: { min: 50 } } },
    unitConversions: { "mmol/l": 1 / 38.67 },
    source: {
      source: "NCEP ATP III",
      year: 2001,
      reference: "Low: <40 mg/dL (men), <50 mg/dL (women); ≥60 mg/dL protective",
    },
  },

  triglycerides: {
    label: "Triglycerides",
    unit: "mg/dL",
    lowerIsBetter: true,
    populationMin: 0,
    populationMax: 150,
    meanings: {
      normal: "Within the expected range.",
      high: "Triglycerides are above the expected range.",
      critical: "Very high triglycerides — risk of pancreatitis.",
    },
    causes: { high: ["Carbohydrate/alcohol intake", "Metabolic factors", "Genetics"] },
    risks: { high: ["Cardiovascular risk", "Pancreatitis risk at very high levels"], critical: ["Pancreatitis"] },
    recommendations: { high: ["Discuss with your doctor", "Reduce alcohol and refined carbohydrates"], critical: ["Seek medical attention"] },
    trendMeaning: { increasing: "Triglycerides are rising", decreasing: "Triglycerides are improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising triglycerides — discuss with your doctor" },
    emergency: {
      min: undefined,
      max: 1000,
      flag: "very_high_triglycerides",
      message: "Triglycerides are very high — risk of pancreatitis. Seek medical attention.",
    },
    riskContributions: { cardiovascular: 20, metabolic: 20 },
    unitConversions: { "mmol/l": 1 / 88.57 },
    source: {
      source: "NCEP ATP III / ACC-AHA",
      year: 2001,
      reference: "Normal <150 mg/dL; borderline 150–199; high 200–499; very high ≥500; pancreatitis risk increases above ~1000",
    },
  },

  /* ---- Kidney ---- */
  creatinine: {
    label: "Creatinine",
    unit: "mg/dL",
    lowerIsBetter: true,
    populationMin: 0.6,
    populationMax: 1.2,
    meanings: {
      low: "Below the expected range — often benign.",
      normal: "Within the expected range.",
      high: "Creatinine is above the expected range — may reflect reduced kidney function.",
      critical: "Critically high creatinine — requires urgent review.",
    },
    causes: { high: ["Dehydration", "Kidney disease", "Medication effect", "Muscle mass"] },
    risks: { high: ["Kidney dysfunction"], critical: ["Acute kidney injury"] },
    recommendations: {
      high: ["Discuss kidney function with your doctor", "Stay hydrated"],
      critical: ["Seek medical attention"],
    },
    trendMeaning: { increasing: "Creatinine is rising", decreasing: "Creatinine is improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising creatinine — discuss with your doctor" },
    emergency: { min: undefined, max: 10, flag: "critically_high_creatinine", message: "Creatinine is critically high — seek immediate medical attention." },
    riskContributions: { kidney: 35 },
    personalized: {
      byGender: { male: { min: 0.7, max: 1.3 }, female: { min: 0.6, max: 1.1 } },
      byCondition: { kidney_disease: { max: 1.2 } },
    },
    unitConversions: { "umol/l": 88.42 },
    source: {
      source: "KDIGO",
      guideline: "KDIGO Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease",
      year: 2012,
      reference: "Reference intervals vary by lab and muscle mass; staging is eGFR-based",
      review: true,
    },
  },

  urea: {
    label: "Urea",
    unit: "mg/dL",
    lowerIsBetter: true,
    populationMin: 7,
    populationMax: 20,
    meanings: {
      low: "Below the expected range — often benign.",
      normal: "Within the expected range.",
      high: "Urea is above the expected range — may reflect kidney function, hydration, or protein intake.",
    },
    causes: { high: ["Dehydration", "High protein intake", "Kidney dysfunction", "GI bleeding"] },
    risks: { high: ["Kidney dysfunction"] },
    recommendations: { high: ["Discuss with your doctor", "Hydration review"] },
    trendMeaning: { increasing: "Urea is rising", decreasing: "Urea is improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising urea — discuss with your doctor" },
    riskContributions: { kidney: 25 },
    unitConversions: { "mmol/l": 0.357 },
    source: {
      source: "General laboratory reference",
      reference: "BUN 7–20 mg/dL typical (1 mg/dL BUN ≈ 0.357 mmol/L urea)",
      review: true,
    },
  },

  /* ---- Blood pressure ---- */
  blood_pressure_systolic: {
    label: "Blood Pressure (Systolic)",
    unit: "mmHg",
    lowerIsBetter: true,
    populationMin: 90,
    populationMax: 120,
    meanings: {
      low: "Systolic pressure below the expected range.",
      normal: "Within the expected range.",
      high: "Systolic pressure is above the expected range.",
      critical: "Systolic pressure is at crisis level.",
    },
    causes: { high: ["Stress", "Salt intake", "Hypertension", "Obesity"] },
    risks: { high: ["Hypertension", "Cardiovascular risk"], critical: ["Hypertensive crisis"] },
    recommendations: {
      high: ["Discuss blood pressure with your doctor", "Review salt intake and activity"],
      critical: ["Seek immediate medical attention"],
    },
    trendMeaning: { increasing: "Systolic pressure is rising", decreasing: "Systolic pressure is improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising blood pressure — discuss with your doctor" },
    emergency: {
      min: undefined,
      max: 180,
      flag: "hypertensive_crisis",
      message: "Blood pressure is at crisis level (≥180) — seek immediate medical attention.",
    },
    riskContributions: { cardiovascular: 25 },
    personalized: { byCondition: { hypertension: { max: 130 } }, byPregnant: { max: 120 } },
    source: {
      source: "ACC/AHA",
      guideline: "2017 Guideline for the Prevention, Detection, Evaluation, and Management of High Blood Pressure in Adults",
      year: 2017,
      reference: "Normal <120; elevated 120–129; stage 1 HTN 130–139; stage 2 ≥140; crisis ≥180",
    },
  },

  blood_pressure_diastolic: {
    label: "Blood Pressure (Diastolic)",
    unit: "mmHg",
    lowerIsBetter: true,
    populationMin: 60,
    populationMax: 80,
    meanings: {
      low: "Diastolic pressure below the expected range.",
      normal: "Within the expected range.",
      high: "Diastolic pressure is above the expected range.",
      critical: "Diastolic pressure is at crisis level.",
    },
    causes: { high: ["Stress", "Salt intake", "Hypertension"] },
    risks: { high: ["Hypertension", "Cardiovascular risk"], critical: ["Hypertensive crisis"] },
    recommendations: {
      high: ["Discuss blood pressure with your doctor", "Review lifestyle factors"],
      critical: ["Seek immediate medical attention"],
    },
    trendMeaning: { increasing: "Diastolic pressure is rising", decreasing: "Diastolic pressure is improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising blood pressure — discuss with your doctor" },
    emergency: {
      min: undefined,
      max: 120,
      flag: "hypertensive_crisis",
      message: "Blood pressure is at crisis level (≥120 diastolic) — seek immediate medical attention.",
    },
    riskContributions: { cardiovascular: 20 },
    personalized: { byCondition: { hypertension: { max: 80 } }, byPregnant: { max: 80 } },
    source: {
      source: "ACC/AHA",
      guideline: "2017 Guideline for the Prevention, Detection, Evaluation, and Management of High Blood Pressure in Adults",
      year: 2017,
      reference: "Normal <80; stage 1 HTN 80–89; stage 2 ≥90; crisis ≥120",
    },
  },

  /* ---- Electrolytes (emergency-relevant) ---- */
  potassium: {
    label: "Potassium",
    unit: "mmol/L",
    lowerIsBetter: false,
    populationMin: 3.5,
    populationMax: 5,
    meanings: {
      low: "Potassium is below the expected range (hypokalemia).",
      normal: "Within the expected range.",
      high: "Potassium is above the expected range (hyperkalemia).",
      critical: "Potassium is dangerously out of range — cardiac risk.",
    },
    causes: { low: ["Diuretics", "GI losses", "Diet"], high: ["Kidney dysfunction", "Medication effect", "Tissue breakdown"] },
    risks: { low: ["Arrhythmia risk"], high: ["Arrhythmia risk"], critical: ["Life-threatening arrhythmia"] },
    recommendations: { low: ["Discuss with your doctor — do not self-supplement"], high: ["Discuss with your doctor immediately"] },
    trendMeaning: { increasing: "Potassium is rising", decreasing: "Potassium is falling" },
    trendRecommendation: { improving: "Continue monitoring", stable: "Continue monitoring", worsening: "Movement away from normal — discuss with your doctor" },
    emergency: { min: 2.5, max: 6.5, flag: "dangerous_potassium", message: "Potassium is dangerously out of range — cardiac risk. Seek immediate medical attention." },
    unitConversions: { "meq/l": 1 },
    source: {
      source: "General laboratory reference",
      reference: "3.5–5.0 mmol/L (mEq/L ≈ mmol/L for monovalent ions); severe <2.5 or >6.5",
      review: true,
    },
  },

  sodium: {
    label: "Sodium",
    unit: "mmol/L",
    lowerIsBetter: false,
    populationMin: 135,
    populationMax: 145,
    meanings: {
      low: "Sodium is below the expected range (hyponatremia).",
      normal: "Within the expected range.",
      high: "Sodium is above the expected range (hypernatremia).",
      critical: "Sodium is dangerously out of range.",
    },
    causes: { low: ["Fluid overload", "Medication effect", "Endocrine causes"], high: ["Dehydration", "Fluid loss"] },
    risks: { low: ["Neurological symptoms risk"], high: ["Neurological symptoms risk"], critical: ["Seizure / confusion risk"] },
    recommendations: { low: ["Discuss with your doctor"], high: ["Hydration review with your doctor"] },
    trendMeaning: { increasing: "Sodium is rising", decreasing: "Sodium is falling" },
    trendRecommendation: { improving: "Continue monitoring", stable: "Continue monitoring", worsening: "Movement away from normal — discuss with your doctor" },
    emergency: { min: 120, max: 160, flag: "dangerous_sodium", message: "Sodium is dangerously out of range. Seek immediate medical attention." },
    unitConversions: { "meq/l": 1 },
    source: {
      source: "General laboratory reference",
      reference: "135–145 mmol/L (mEq/L ≈ mmol/L); severe <120 or >160",
      review: true,
    },
  },

  /* ---- Cardiac markers ---- */
  troponin: {
    label: "Troponin",
    unit: "ng/mL",
    lowerIsBetter: true,
    populationMin: 0,
    populationMax: 0.04,
    meanings: {
      normal: "Within the expected range — no detectable heart-muscle injury signal.",
      high: "Troponin is elevated — may indicate heart-muscle stress or injury.",
    },
    causes: { high: ["Heart muscle injury", "Myocarditis", "Severe stress on the heart"] },
    risks: { high: ["Acute coronary event"] },
    recommendations: { high: ["Seek medical evaluation immediately"] },
    trendMeaning: { increasing: "Troponin is rising", decreasing: "Troponin is falling" },
    trendRecommendation: { improving: "Falling troponin — continue medical follow-up", stable: "Continue medical follow-up", worsening: "Rising troponin — urgent medical review" },
    emergency: { min: undefined, max: 0.5, flag: "elevated_troponin", message: "Troponin is markedly elevated — seek immediate emergency care." },
    riskContributions: { cardiovascular: 40 },
    source: {
      source: "IFCC",
      guideline: "Assay-specific 99th percentile upper reference limit",
      reference: "Elevation above the 99th percentile of a healthy reference population is assay-dependent",
      review: true,
    },
  },

  /* ---- Oxygenation ---- */
  oxygen_saturation: {
    label: "Oxygen Saturation",
    unit: "%",
    lowerIsBetter: false,
    populationMin: 95,
    populationMax: 100,
    meanings: {
      low: "Oxygen saturation is below the expected range.",
      normal: "Within the expected range.",
    },
    causes: { low: ["Respiratory condition", "Anemia", "Circulation issue"] },
    risks: { low: ["Hypoxia"] },
    recommendations: { low: ["Seek medical evaluation"] },
    trendMeaning: { increasing: "Oxygen saturation is improving", decreasing: "Oxygen saturation is falling" },
    trendRecommendation: { improving: "Improving — continue monitoring", stable: "Continue monitoring", worsening: "Falling oxygen saturation — seek medical evaluation" },
    emergency: {
      min: 85,
      flag: "low_oxygen_saturation",
      message: "Oxygen saturation is critically low — seek immediate medical attention.",
    },
    source: {
      source: "General respiratory reference",
      reference: "Normal ≥95%; hypoxemia <90%; <85 severe",
      review: true,
    },
  },

  /* ---- Liver ---- */
  alt: {
    label: "ALT",
    unit: "U/L",
    lowerIsBetter: true,
    populationMin: 7,
    populationMax: 56,
    meanings: {
      normal: "Within the expected range.",
      high: "ALT is elevated — a marker of liver-cell stress.",
    },
    causes: { high: ["Fatty liver", "Medication effect", "Alcohol", "Viral hepatitis"] },
    risks: { high: ["Liver injury"] },
    recommendations: { high: ["Discuss liver profile with your doctor", "Review alcohol and medications"] },
    trendMeaning: { increasing: "ALT is rising", decreasing: "ALT is improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising ALT — discuss with your doctor" },
    riskContributions: { liver: 35 },
    personalized: { byCondition: { liver_disease: { max: 56 } } },
    source: {
      source: "General laboratory reference",
      reference: "Reference intervals vary by lab and sex (commonly 7–56 U/L)",
      review: true,
    },
  },

  ast: {
    label: "AST",
    unit: "U/L",
    lowerIsBetter: true,
    populationMin: 10,
    populationMax: 40,
    meanings: {
      normal: "Within the expected range.",
      high: "AST is elevated — may reflect liver or muscle stress.",
    },
    causes: { high: ["Liver injury", "Alcohol", "Muscle stress", "Medication effect"] },
    risks: { high: ["Liver injury"] },
    recommendations: { high: ["Discuss liver profile with your doctor", "Review alcohol intake"] },
    trendMeaning: { increasing: "AST is rising", decreasing: "AST is improving" },
    trendRecommendation: { improving: "Improving — continue current approach", stable: "Continue monitoring", worsening: "Rising AST — discuss with your doctor" },
    riskContributions: { liver: 30 },
    personalized: { byCondition: { liver_disease: { max: 40 } } },
    source: {
      source: "General laboratory reference",
      reference: "Reference intervals vary by lab (commonly 10–40 U/L)",
      review: true,
    },
  },

  total_bilirubin: {
    label: "Total Bilirubin",
    unit: "mg/dL",
    lowerIsBetter: true,
    populationMin: 0.1,
    populationMax: 1.2,
    meanings: { normal: "Within the expected range.", high: "Bilirubin is elevated." },
    causes: { high: ["Liver condition", "Bile-duct issue", "Hemolysis"] },
    risks: { high: ["Liver dysfunction"] },
    recommendations: { high: ["Discuss with your doctor"] },
    trendMeaning: { increasing: "Bilirubin is rising", decreasing: "Bilirubin is improving" },
    trendRecommendation: { improving: "Improving — continue monitoring", stable: "Continue monitoring", worsening: "Rising bilirubin — discuss with your doctor" },
    riskContributions: { liver: 20 },
    source: {
      source: "General laboratory reference",
      reference: "Typical <1.2 mg/dL",
      review: true,
    },
  },

  /* ---- Inflammation ---- */
  crp: {
    label: "CRP",
    unit: "mg/L",
    lowerIsBetter: true,
    populationMin: 0,
    populationMax: 10,
    meanings: {
      normal: "Within the expected range.",
      high: "CRP is elevated — a marker of inflammation.",
    },
    causes: { high: ["Inflammation", "Infection", "Tissue injury"] },
    risks: { high: ["Inflammatory process", "Cardiovascular risk (if persistently elevated)"] },
    recommendations: { high: ["Discuss with your doctor", "Repeat testing to track the trend"] },
    trendMeaning: { increasing: "Inflammation marker rising", decreasing: "Inflammation marker improving" },
    trendRecommendation: { improving: "Improving — continue monitoring", stable: "Continue monitoring", worsening: "Rising CRP — discuss with your doctor" },
    riskContributions: { inflammation: 35, cardiovascular: 10 },
    source: {
      source: "General laboratory reference",
      reference: "Standard CRP <10 mg/L; hs-CRP <1 low / 1–3 moderate / >3 mg/L high cardiovascular risk",
      review: true,
    },
  },

  esr: {
    label: "ESR",
    unit: "mm/hr",
    lowerIsBetter: true,
    populationMin: 0,
    populationMax: 20,
    meanings: {
      normal: "Within the expected range.",
      high: "ESR is elevated — a marker of inflammation.",
    },
    causes: { high: ["Inflammation", "Infection", "Anemia", "Pregnancy"] },
    risks: { high: ["Inflammatory process"] },
    recommendations: { high: ["Discuss with your doctor"] },
    trendMeaning: { increasing: "ESR is rising", decreasing: "ESR is improving" },
    trendRecommendation: { improving: "Improving — continue monitoring", stable: "Continue monitoring", worsening: "Rising ESR — discuss with your doctor" },
    riskContributions: { inflammation: 30 },
    personalized: { byPregnant: { max: 30 }, byGender: { female: { max: 25 } } },
    source: {
      source: "General laboratory reference (Westergren)",
      reference: "Age/sex adjusted: men ≈ age/2, women ≈ (age+10)/2 mm/hr",
      review: true,
    },
  },

  temperature: {
    label: "Temperature",
    unit: "°C",
    lowerIsBetter: false,
    populationMin: 36.1,
    populationMax: 37.2,
    meanings: {
      normal: "Within the expected range.",
      high: "Temperature is elevated — possible fever.",
    },
    causes: { high: ["Infection", "Inflammation"] },
    risks: { high: ["Infection"] },
    recommendations: { high: ["Monitor symptoms", "Discuss with a clinician if persistent"] },
    trendMeaning: { increasing: "Temperature is rising", decreasing: "Temperature is normalizing" },
    trendRecommendation: { improving: "Normalizing — continue monitoring", stable: "Continue monitoring", worsening: "Rising temperature — monitor closely" },
    riskContributions: { inflammation: 20 },
    source: {
      source: "General clinical reference",
      reference: "36.1–37.2 °C oral",
    },
  },

  /* ---- Thyroid ---- */
  tsh: {
    label: "TSH",
    unit: "mIU/L",
    lowerIsBetter: false,
    populationMin: 0.4,
    populationMax: 4,
    meanings: {
      low: "TSH is below the expected range — may suggest overactive thyroid.",
      normal: "Within the expected range.",
      high: "TSH is above the expected range — may suggest underactive thyroid.",
    },
    causes: { low: ["Overactive thyroid", "Medication effect"], high: ["Underactive thyroid"] },
    risks: { low: ["Hyperthyroidism"], high: ["Hypothyroidism"] },
    recommendations: { low: ["Discuss thyroid function with your doctor"], high: ["Discuss thyroid function with your doctor"] },
    trendMeaning: { increasing: "TSH is rising", decreasing: "TSH is falling" },
    trendRecommendation: { improving: "Continue monitoring", stable: "Continue monitoring", worsening: "Movement away from normal — discuss with your doctor" },
    personalized: {
      byPregnant: { min: 0.1, max: 2.5 },
      byTrimester: {
        first: { min: 0.1, max: 2.5 },
        second: { min: 0.2, max: 3.0 },
        third: { min: 0.3, max: 3.0 },
      },
    },
    source: {
      source: "ATA",
      guideline: "2017 Guidelines of the American Thyroid Association for the Diagnosis and Management of Thyroid Disease During Pregnancy and the Postpartum",
      year: 2017,
      reference: "Population 0.4–4.0 mIU/L; pregnancy: 1st trimester 0.1–2.5, 2nd 0.2–3.0, 3rd 0.3–3.0",
    },
  },

  ferritin: {
    label: "Ferritin",
    unit: "ng/mL",
    lowerIsBetter: false,
    populationMin: 12,
    populationMax: 300,
    meanings: {
      low: "Ferritin is low — may indicate depleted iron stores.",
      normal: "Within the expected range.",
      high: "Ferritin is elevated — may reflect inflammation or iron overload.",
    },
    causes: { low: ["Iron deficiency", "Blood loss"], high: ["Inflammation", "Iron overload", "Liver condition"] },
    risks: { low: ["Iron-deficiency anemia"] },
    recommendations: { low: ["Discuss iron studies with your doctor"], high: ["Discuss with your doctor"] },
    trendMeaning: { increasing: "Ferritin is rising", decreasing: "Ferritin is falling" },
    trendRecommendation: { improving: "Continue monitoring", stable: "Continue monitoring", worsening: "Movement away from normal — discuss with your doctor" },
    riskContributions: { anemia: 25 },
    personalized: { byGender: { male: { min: 30, max: 300 }, female: { min: 12, max: 150 } } },
    source: {
      source: "WHO",
      year: 2011,
      reference: "Iron deficiency typically <12–15 ng/mL (age/sex dependent)",
      review: true,
    },
  },
};

/* ------------------------------------------------------------------ */
/* Generic fallback for metrics without a dedicated rule               */
/* ------------------------------------------------------------------ */

export const GENERIC_METRIC_RULE: MetricRule = {
  label: "", // filled by the engine from the input metric name
  unit: "",
  lowerIsBetter: false,
  meanings: {
    low: "Below the reference range.",
    normal: "Within the reference range.",
    high: "Above the reference range.",
    critical: "Dangerously outside the reference range.",
  },
  causes: {},
  risks: {},
  recommendations: {},
  trendMeaning: { increasing: "The value is trending upward", decreasing: "The value is trending downward" },
  trendRecommendation: { improving: "Continue monitoring", stable: "Continue monitoring", worsening: "Discuss the trend with your doctor" },
};

/** Returns the rule for a metric, or the generic fallback. */
export function getRule(metricName: string): MetricRule {
  return METRIC_RULES[metricName] ?? GENERIC_METRIC_RULE;
}

/** True when a lower value is the healthy direction for this metric. */
export function lowerIsBetter(metricName: string): boolean {
  return getRule(metricName).lowerIsBetter;
}

/** Human label for a metric (rule label, else pretty-printed name). */
export function metricLabel(metricName: string): string {
  const rule = getRule(metricName);
  if (rule.label) return rule.label;
  return metricName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Profile factor helpers (used by the risk + reference engines)       */
/* ------------------------------------------------------------------ */

export function isBmiHigh(bmiCategory: BmiCategory | null | undefined): boolean {
  return bmiCategory === "overweight" || bmiCategory === "obese";
}

export function isObese(bmiCategory: BmiCategory | null | undefined): boolean {
  return bmiCategory === "obese";
}
