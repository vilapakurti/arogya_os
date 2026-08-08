/**
 * ArogyaOS CDSS — Clinical Validation & Verification harness.
 *
 * TEMPORARY smoke test. Runs the Clinical Decision Support Engine
 * (src/lib/clinical) against 10 clinical test cases and a 100-metric
 * performance benchmark. Purely local — no network, no AI, no database.
 *
 * Run with:  npx tsx scripts/cdss-verify.ts
 * Exit code 0 = all tests pass; 1 = at least one assertion failed.
 */

import {
  evaluateMetric,
  evaluateReport,
  evaluatePatient,
  evaluateEmergency,
  evaluateCombinedFindings,
  getReferenceRange,
  type ClinicalProfile,
  type MetricInput,
  type ReportEvaluation,
} from "../src/lib/clinical/index";

let failures = 0;
let passed = 0;

function check(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function near(a: number, b: number, tol = 0.05): boolean {
  return Math.abs(a - b) <= tol;
}

const NORMAL_PROFILE: ClinicalProfile = {
  age: 35,
  ageCategory: "adult",
  gender: "male",
  pregnant: false,
  trimester: null,
  heightCm: 175,
  weightKg: 72,
  bmi: 23.5,
  bmiCategory: "normal",
  knownConditions: [],
  familyHistory: [],
  smokingStatus: "never",
  alcoholStatus: "occasionally",
  exerciseLevel: "moderate",
  bloodGroup: "O+",
};

function normalPanel(): MetricInput[] {
  return [
    { metricName: "hemoglobin", value: 14.5, unit: "g/dL" },
    { metricName: "rbc", value: 5.0, unit: "10^6/uL" },
    { metricName: "wbc", value: 6.5, unit: "10^3/uL" },
    { metricName: "platelets", value: 250, unit: "10^3/uL" },
    { metricName: "blood_glucose", value: 88, unit: "mg/dL" },
    { metricName: "hba1c", value: 5.2, unit: "%" },
    { metricName: "cholesterol_total", value: 170, unit: "mg/dL" },
    { metricName: "ldl", value: 95, unit: "mg/dL" },
    { metricName: "hdl", value: 55, unit: "mg/dL" },
    { metricName: "triglycerides", value: 120, unit: "mg/dL" },
    { metricName: "creatinine", value: 0.9, unit: "mg/dL" },
    { metricName: "urea", value: 14, unit: "mg/dL" },
    { metricName: "blood_pressure_systolic", value: 118, unit: "mmHg" },
    { metricName: "blood_pressure_diastolic", value: 76, unit: "mmHg" },
    { metricName: "potassium", value: 4.2, unit: "mmol/L" },
    { metricName: "sodium", value: 140, unit: "mmol/L" },
    { metricName: "alt", value: 22, unit: "U/L" },
    { metricName: "ast", value: 18, unit: "U/L" },
    { metricName: "oxygen_saturation", value: 98, unit: "%" },
    { metricName: "crp", value: 2, unit: "mg/L" },
    { metricName: "esr", value: 8, unit: "mm/hr" },
  ];
}

/* ==================================================================== */
/* Test 1 — Normal patient                                              */
/* ==================================================================== */
function test1NormalPatient(): void {
  console.log("\n[Test 1] Normal patient — everything in range");
  const report = evaluateReport(normalPanel(), NORMAL_PROFILE);
  check(report.emergencies.length === 0, "no emergencies detected");
  check(report.metrics.every((m) => m.status === "normal"), "every metric status = normal");
  check(
    report.metrics.every((m) => !m.doctorReviewRequired),
    "no unnecessary doctor-review warnings",
  );
  check(report.overallPriority === "low", "overall priority = low");
  check(report.combinedFindings.length === 0, "no combined findings");
  const riskLevels = report.riskProfile.map((r) => r.level);
  check(
    riskLevels.every((l) => l === "low"),
    "all risk categories = low",
    `got ${riskLevels.join(", ")}`,
  );
  const patient = evaluatePatient(NORMAL_PROFILE, report);
  check(patient.overallLevel === "low", "patient-level overall risk = low");
}

/* ==================================================================== */
/* Test 2 — Abnormal glucose pattern                                    */
/* ==================================================================== */
function test2AbnormalGlucose(): void {
  console.log("\n[Test 2] Abnormal glucose pattern (glucose 165 + HbA1c 7.2)");
  const inputs = normalPanel().map((m) =>
    m.metricName === "blood_glucose" ? { ...m, value: 165 } : m,
  ).map((m) =>
    m.metricName === "hba1c" ? { ...m, value: 7.2 } : m,
  );
  const report = evaluateReport(inputs, NORMAL_PROFILE);
  const glucose = report.metrics.find((m) => m.metricName === "blood_glucose")!;
  const hba1c = report.metrics.find((m) => m.metricName === "hba1c")!;
  check(glucose.status === "high", "glucose classified high");
  check(hba1c.status === "high", "HbA1c classified high");
  check(
    glucose.severity === "severe" || glucose.severity === "moderate",
    "glucose severity is moderate/severe (not critical — ordinary abnormal result)",
    glucose.severity,
  );
  const diabetesFinding = report.combinedFindings.find(
    (f) => f.id === "diabetes_progression",
  );
  check(!!diabetesFinding, "combined finding 'diabetes_progression' fires");
  check(
    !diabetesFinding || /possible/i.test(diabetesFinding.finding),
    "finding uses hedged 'Possible' language",
    diabetesFinding?.finding,
  );
  check(
    !diabetesFinding || !/you have|diagnosed|you have diabetes/i.test(diabetesFinding.explanation),
    "no definitive diagnostic claim in explanation",
  );
  const diabetesRisk = report.riskProfile.find((r) => r.key === "diabetes");
  check(
    !!diabetesRisk && (diabetesRisk.level === "high" || diabetesRisk.level === "critical"),
    "diabetes risk elevated (high/critical)",
    diabetesRisk ? `${diabetesRisk.level} (${diabetesRisk.score}/100)` : "missing",
  );
  check(
    glucose.doctorReviewRequired || hba1c.doctorReviewRequired,
    "doctor review recommended",
  );
  check(
    !report.summary.includes("You have diabetes"),
    "summary contains no definitive diagnosis",
  );
}

/* ==================================================================== */
/* Test 3 — Kidney pattern                                              */
/* ==================================================================== */
function test3KidneyPattern(): void {
  console.log("\n[Test 3] Kidney pattern (creatinine 2.4 + urea 65)");
  const inputs = normalPanel().map((m) =>
    m.metricName === "creatinine" ? { ...m, value: 2.4 } : m,
  ).map((m) =>
    m.metricName === "urea" ? { ...m, value: 65 } : m,
  );
  const report = evaluateReport(inputs, NORMAL_PROFILE);
  const kidneyFinding = report.combinedFindings.find((f) => f.id === "kidney_dysfunction");
  check(!!kidneyFinding, "combined finding 'kidney_dysfunction' fires");
  check(
    !kidneyFinding || /possible/i.test(kidneyFinding.finding),
    "finding uses hedged 'Possible' language",
    kidneyFinding?.finding,
  );
  check(!!kidneyFinding && kidneyFinding.doctorReview, "finding flags doctor review");
  const kidneyRisk = report.riskProfile.find((r) => r.key === "kidney");
  check(
    !!kidneyRisk && (kidneyRisk.level === "high" || kidneyRisk.level === "critical"),
    "kidney risk high/critical",
    kidneyRisk ? `${kidneyRisk.level} (${kidneyRisk.score}/100)` : "missing",
  );
}

/* ==================================================================== */
/* Test 4 — Anemia pattern (female profile)                             */
/* ==================================================================== */
function test4AnemiaPattern(): void {
  console.log("\n[Test 4] Anemia pattern (Hb 9.0 + RBC 3.5, female)");
  const female = { ...NORMAL_PROFILE, gender: "female" as const, ageCategory: "adult" as const };
  const inputs = normalPanel().map((m) =>
    m.metricName === "hemoglobin" ? { ...m, value: 9.0 } : m,
  ).map((m) =>
    m.metricName === "rbc" ? { ...m, value: 3.5 } : m,
  );
  const report = evaluateReport(inputs, female);
  const hb = report.metrics.find((m) => m.metricName === "hemoglobin")!;
  check(hb.status === "low", "hemoglobin classified low");
  check(
    hb.severity === "severe" || hb.severity === "moderate",
    "severity moderate/severe, NOT critical (no emergency over-flagging)",
    hb.severity,
  );
  check(hb.possibleCauses.length > 0, "possible causes present");
  check(hb.recommendations.length > 0, "recommendations present");
  check(!hb.emergency.isEmergency, "Hb 9.0 is NOT an emergency");
  const anemiaFinding = report.combinedFindings.find((f) => f.id === "iron_deficiency_pattern");
  check(!!anemiaFinding, "combined finding 'iron_deficiency_pattern' fires");
  const anemiaRisk = report.riskProfile.find((r) => r.key === "anemia");
  check(
    !!anemiaRisk && anemiaRisk.level !== "low",
    "anemia risk elevated",
    anemiaRisk ? `${anemiaRisk.level} (${anemiaRisk.score}/100)` : "missing",
  );
}

/* ==================================================================== */
/* Test 5 — Critical value                                              */
/* ==================================================================== */
function test5CriticalValues(): void {
  console.log("\n[Test 5] Critical values (K+ 7.0, glucose 540)");
  const inputs = normalPanel().map((m) =>
    m.metricName === "potassium" ? { ...m, value: 7.0 } : m,
  ).map((m) =>
    m.metricName === "blood_glucose" ? { ...m, value: 540 } : m,
  );
  const report = evaluateReport(inputs, NORMAL_PROFILE);
  const potassium = report.metrics.find((m) => m.metricName === "potassium")!;
  const glucose = report.metrics.find((m) => m.metricName === "blood_glucose")!;
  check(potassium.status === "critical", "potassium status = critical");
  check(potassium.priority === "critical", "potassium priority = critical");
  check(potassium.emergency.isEmergency === true, "potassium emergency = true");
  check(
    !!potassium.emergency.message && /immediate medical attention/i.test(potassium.emergency.message),
    "potassium emergency message directs to urgent care",
  );
  check(glucose.status === "critical", "glucose 540 status = critical");
  check(report.emergencies.length >= 2, "both emergencies surfaced in report.emergencies");
  const potassiumEmergency = report.emergencies.find((e) => e.metricName === "potassium");
  check(
    !!potassiumEmergency &&
      potassiumEmergency.priority === "critical" &&
      potassiumEmergency.immediateDoctorReview &&
      potassiumEmergency.seekMedicalAttention,
    "emergency finding carries critical priority + seek-attention flags",
  );
  check(
    /seek medical attention|immediate/i.test(report.summary),
    "summary mentions seeking attention",
  );
}

/* ==================================================================== */
/* Test 6 — Personal baseline deviation (no disease claim)              */
/* ==================================================================== */
function test6BaselineDeviation(): void {
  console.log("\n[Test 6] Personal baseline deviation — in-range but unusual for THIS patient");
  const metric = evaluateMetric(
    {
      metricName: "blood_glucose",
      value: 92,
      unit: "mg/dL",
      personalBaseline: 82,
      zScore: 2.3,
      personalClass: "above",
    },
    NORMAL_PROFILE,
  );
  check(metric.status === "normal", "status stays normal (within population range)");
  check(
    /Although still within the reference range/.test(metric.clinicalMeaning),
    "early-warning language present",
  );
  check(metric.doctorReviewRequired, "doctor review recommended for personal deviation");
  check(metric.priority === "medium" || metric.priority === "high", "priority raised", metric.priority);
  check(
    !/you have diabetes|diagnosed/i.test(metric.clinicalMeaning),
    "no disease claim from personal deviation",
  );
}

/* ==================================================================== */
/* Test 7 — Pregnancy personalization (only where justified)            */
/* ==================================================================== */
function test7Pregnancy(): void {
  console.log("\n[Test 7] Pregnancy profile — trimester-specific ranges only where appropriate");
  const pregnant1 = {
    ...NORMAL_PROFILE,
    gender: "female" as const,
    pregnant: true,
    trimester: "first" as const,
  };
  const pregnant3 = {
    ...NORMAL_PROFILE,
    gender: "female" as const,
    pregnant: true,
    trimester: "third" as const,
  };

  const tsh1 = getReferenceRange("tsh", pregnant1);
  const tsh3 = getReferenceRange("tsh", pregnant3);
  check(
    tsh1.min === 0.1 && tsh1.max === 2.5,
    "TSH first trimester 0.1–2.5 (ATA 2017)",
    `${tsh1.min}–${tsh1.max}`,
  );
  check(
    tsh3.min === 0.3 && tsh3.max === 3.0,
    "TSH third trimester 0.3–3.0 (ATA 2017)",
    `${tsh3.min}–${tsh3.max}`,
  );

  const glucoseRange = getReferenceRange("blood_glucose", pregnant1);
  check(glucoseRange.max === 92, "fasting glucose pregnancy target <92 (ADA)", String(glucoseRange.max));

  const hbRange = getReferenceRange("hemoglobin", pregnant1);
  check(hbRange.min === 11, "hemoglobin pregnancy floor 11 (WHO)", String(hbRange.min));

  // Pregnancy must NOT distort metrics with no pregnancy-specific basis.
  const wbcRange = getReferenceRange("wbc", pregnant1);
  check(wbcRange.min === 4 && wbcRange.max === 11, "WBC range unaffected by pregnancy", `${wbcRange.min}–${wbcRange.max}`);

  // Non-pregnant female: no pregnancy adjustment.
  const nonPregnant = { ...NORMAL_PROFILE, gender: "female" as const, pregnant: false };
  const hbNonPreg = getReferenceRange("hemoglobin", nonPregnant);
  check(hbNonPreg.min === 12, "non-pregnant female Hb floor 12 (not 11)", String(hbNonPreg.min));
}

/* ==================================================================== */
/* Test 8 — Missing profile (population fallback, no crash)             */
/* ==================================================================== */
function test8MissingProfile(): void {
  console.log("\n[Test 8] Missing profile — graceful population fallback");
  const report = evaluateReport(normalPanel(), null);
  check(Array.isArray(report.metrics) && report.metrics.length === normalPanel().length, "report evaluates without a profile");
  const hb = report.metrics.find((m) => m.metricName === "hemoglobin")!;
  check(hb.referenceRange.source === "population", "range source = population", hb.referenceRange.source);
  check(hb.referenceRange.min === 13, "population Hb floor 13", String(hb.referenceRange.min));
  check(report.emergencies.length === 0, "no emergencies fabricated");
  // evaluatePatient with null profile must not throw.
  const patient = evaluatePatient(null, report);
  check(patient.overallLevel === "low", "patient risk with null profile = low");
}

/* ==================================================================== */
/* Test 9 — Missing metric / unclassifiable value (no fabrication)      */
/* ==================================================================== */
function test9MissingMetric(): void {
  console.log("\n[Test 9] Missing metric / no reference range — no fabricated interpretation");
  const unknown = evaluateMetric({ metricName: "some_esoteric_marker", value: 123 }, null);
  check(unknown.referenceRange.source === "unavailable", "unknown metric range = unavailable");
  check(unknown.severity === "unknown", "severity = unknown (not invented)", unknown.severity);
  check(
    /cannot be classified at this time/.test(unknown.clinicalMeaning),
    "meaning states it cannot be classified",
  );
  check(unknown.doctorReviewRequired === false, "no doctor-review demand on unclassifiable value");
  check(unknown.recommendations.length > 0, "falls back to 'ask your doctor with lab range' recommendation");
  check(!unknown.emergency.isEmergency, "no emergency fabricated");

  const missingValue = evaluateMetric({ metricName: "hemoglobin", value: null }, null);
  check(missingValue.severity === "unknown", "missing reading → severity unknown");
  check(
    /No reading available/.test(missingValue.clinicalMeaning),
    "missing reading meaning is honest",
  );
  check(missingValue.recommendations.length === 0, "no recommendations invented for missing reading");
}

/* ==================================================================== */
/* Test 10 — Unit conversion                                            */
/* ==================================================================== */
function test10UnitConversion(): void {
  console.log("\n[Test 10] Unit conversion — equivalent values classify identically");

  // Glucose in mmol/L (Indian/European reports) must NOT be compared against mg/dL bounds.
  const glucoseMmol = evaluateMetric(
    { metricName: "blood_glucose", value: 8.0, unit: "mmol/L", populationMin: 3.9, populationMax: 5.5 },
    null,
  );
  check(glucoseMmol.status === "high", "glucose 8.0 mmol/L = high", glucoseMmol.status);
  check(
    near(glucoseMmol.referenceRange.min ?? 0, 3.9) && near(glucoseMmol.referenceRange.max ?? 0, 5.6),
    "glucose range converted to mmol/L (~3.9–5.6)",
    `${glucoseMmol.referenceRange.min}–${glucoseMmol.referenceRange.max}`,
  );

  // Creatinine in µmol/L.
  const creatUmol = evaluateMetric(
    { metricName: "creatinine", value: 150, unit: "µmol/L", populationMin: 59, populationMax: 104 },
    null,
  );
  check(creatUmol.status === "high", "creatinine 150 µmol/L = high", creatUmol.status);
  check(
    near(creatUmol.referenceRange.min ?? 0, 53) && near(creatUmol.referenceRange.max ?? 0, 106.1),
    "creatinine range converted to µmol/L (~53–106)",
    `${creatUmol.referenceRange.min}–${creatUmol.referenceRange.max}`,
  );

  // Equivalence: 180 mg/dL vs 10.0 mmol/L both high.
  const a = evaluateMetric({ metricName: "blood_glucose", value: 180, unit: "mg/dL" }, null);
  const b = evaluateMetric({ metricName: "blood_glucose", value: 10.0, unit: "mmol/L" }, null);
  check(a.status === "high" && b.status === "high", "180 mg/dL ≡ 10.0 mmol/L → both high", `${a.status}/${b.status}`);

  // WBC 10^3/uL vs 10^9/L are numerically identical.
  const wbcK = evaluateMetric({ metricName: "wbc", value: 12.5, unit: "10^3/uL" }, null);
  const wbc9 = evaluateMetric({ metricName: "wbc", value: 12.5, unit: "10^9/L" }, null);
  check(wbcK.status === "high" && wbc9.status === "high", "WBC 12.5 high in both unit notations");

  // Same-unit path unaffected (mg/dL).
  const glucoseMg = evaluateMetric({ metricName: "blood_glucose", value: 88, unit: "mg/dL" }, null);
  check(glucoseMg.status === "normal", "glucose 88 mg/dL stays normal", glucoseMg.status);
}

/* ==================================================================== */
/* Performance benchmark                                                */
/* ==================================================================== */
function benchmark(): void {
  console.log("\n[Performance] evaluateReport() — 100 metrics × 50 iterations (local only)");
  const names = [
    "hemoglobin", "rbc", "wbc", "platelets", "blood_glucose", "hba1c",
    "cholesterol_total", "ldl", "hdl", "triglycerides", "creatinine", "urea",
    "blood_pressure_systolic", "blood_pressure_diastolic", "potassium", "sodium",
    "troponin", "oxygen_saturation", "alt", "ast", "total_bilirubin", "crp",
    "esr", "temperature", "tsh", "ferritin",
  ];
  const units: Record<string, string> = {
    hemoglobin: "g/dL", rbc: "10^6/uL", wbc: "10^3/uL", platelets: "10^3/uL",
    blood_glucose: "mg/dL", hba1c: "%", cholesterol_total: "mg/dL", ldl: "mg/dL",
    hdl: "mg/dL", triglycerides: "mg/dL", creatinine: "mg/dL", urea: "mg/dL",
    blood_pressure_systolic: "mmHg", blood_pressure_diastolic: "mmHg",
    potassium: "mmol/L", sodium: "mmol/L", troponin: "ng/mL",
    oxygen_saturation: "%", alt: "U/L", ast: "U/L", total_bilirubin: "mg/dL",
    crp: "mg/L", esr: "mm/hr", temperature: "°C", tsh: "mIU/L", ferritin: "ng/mL",
  };
  const inputs: MetricInput[] = [];
  for (let i = 0; i < 100; i++) {
    const name = names[i % names.length];
    // Scatter values so the engine exercises status/severity/emergency paths.
    const value = 1 + ((i * 37) % 100);
    inputs.push({ metricName: name, value, unit: units[name] });
  }

  const ITERATIONS = 50;
  const durations: number[] = [];
  let sanity: ReportEvaluation | null = null;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const t0 = performance.now();
    sanity = evaluateReport(inputs, NORMAL_PROFILE);
    const t1 = performance.now();
    durations.push(t1 - t0);
  }
  durations.sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);
  const avg = sum / ITERATIONS;
  const p95Index = Math.min(ITERATIONS - 1, Math.ceil(0.95 * ITERATIONS) - 1);
  const p95 = durations[p95Index];

  console.log(`  iterations: ${ITERATIONS} × 100 metrics`);
  console.log(`  average:    ${avg.toFixed(3)} ms`);
  console.log(`  minimum:    ${durations[0].toFixed(3)} ms`);
  console.log(`  maximum:    ${durations[ITERATIONS - 1].toFixed(3)} ms`);
  console.log(`  P95:        ${p95.toFixed(3)} ms`);
  console.log(`  target:     < 100 ms`);
  check(avg < 100, `benchmark average ${avg.toFixed(3)} ms < 100 ms`, `${avg.toFixed(3)} ms`);
  check(p95 < 100, `benchmark P95 ${p95.toFixed(3)} ms < 100 ms`, `${p95.toFixed(3)} ms`);
  check(!!sanity && sanity.metrics.length === 100, "sanity: report contains 100 evaluated metrics");
}

/* ==================================================================== */
/* Run everything                                                       */
/* ==================================================================== */

console.log("ArogyaOS CDSS — Clinical Validation & Verification");
console.log("===================================================");

test1NormalPatient();
test2AbnormalGlucose();
test3KidneyPattern();
test4AnemiaPattern();
test5CriticalValues();
test6BaselineDeviation();
test7Pregnancy();
test8MissingProfile();
test9MissingMetric();
test10UnitConversion();
benchmark();

// Extra sanity: evaluateEmergency + evaluateCombinedFindings exported directly.
const em = evaluateEmergency([{ metricName: "sodium", value: 118, unit: "mmol/L" }]);
check(em.length === 1 && em[0].flag === "dangerous_sodium", "evaluateEmergency detects sodium 118");
const cf = evaluateCombinedFindings(
  evaluateReport(normalPanel().map((m) => (m.metricName === "ldl" ? { ...m, value: 165 } : m))
    .map((m) => (m.metricName === "triglycerides" ? { ...m, value: 220 } : m)), null).metrics,
  null,
);
check(
  cf.some((f) => f.id === "elevated_cardiovascular_risk"),
  "elevated cardiovascular risk pattern fires (LDL + TG)",
);

console.log("\n===================================================");
console.log(`RESULT: ${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log("ALL TESTS PASSED");
