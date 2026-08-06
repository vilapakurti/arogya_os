/**
 * Medical Data Parser (Feature 3 — structured extraction from OCR text).
 *
 * Pure, dependency-free module. Turns the raw OCR text of a lab report into
 * structured metrics (name, value, unit, reference range) ready to persist
 * into health_metrics.
 *
 * Deliberately defensive: malformed OCR, missing units, unparseable lines,
 * and out-of-plausibility values are skipped line-by-line — the parser never
 * throws and never lets one bad line poison the rest of the report.
 */

export interface ParsedMetric {
  /** Canonical metric name (health_metrics.metric_name). */
  metric_name: string;
  /** Numeric value (health_metrics.metric_value, numeric NOT NULL). */
  metric_value: number;
  /** Unit; falls back to the metric's typical unit when the report omits one. */
  unit: string | null;
  reference_range_min: number | null;
  reference_range_max: number | null;
}

interface MetricDef {
  name: string;
  /** Case-insensitive label variants; longest-first resolution handles specificity. */
  labels: string[];
  /** Typical unit used when the report does not state one. */
  defaultUnit: string | null;
  /** Typical adult reference ranges keyed by normalized unit (safety net only). */
  defaultRangesByUnit?: Record<string, [number, number]>;
  /** Inclusive plausibility bounds — values outside are treated as OCR garbage. */
  minValue: number;
  maxValue: number;
  /** When true, the reading is a compound "120/80" blood pressure. */
  compound?: "bp";
}

const METRICS: MetricDef[] = [
  {
    name: "hemoglobin",
    labels: ["hemoglobin", "haemoglobin", "hgb", "hb"],
    defaultUnit: "g/dL",
    defaultRangesByUnit: { "g/dL": [12.0, 17.5] },
    minValue: 0,
    maxValue: 25,
  },
  {
    name: "hba1c",
    labels: ["hba1c", "hemoglobin a1c", "glycated hemoglobin", "glycohemoglobin", "a1c"],
    defaultUnit: "%",
    defaultRangesByUnit: { "%": [4.0, 5.6] },
    minValue: 0,
    maxValue: 20,
  },
  {
    name: "blood_glucose",
    labels: ["blood glucose", "fasting blood sugar", "blood sugar", "glucose", "sugar", "fbs", "rbs"],
    defaultUnit: "mg/dL",
    defaultRangesByUnit: { "mg/dL": [70, 99], "mmol/L": [3.9, 5.5] },
    minValue: 0,
    maxValue: 2000,
  },
  {
    name: "cholesterol_total",
    labels: ["total cholesterol", "cholesterol", "chol"],
    defaultUnit: "mg/dL",
    defaultRangesByUnit: { "mg/dL": [125, 200] },
    minValue: 0,
    maxValue: 1000,
  },
  {
    name: "hdl",
    labels: ["hdl cholesterol", "high density lipoprotein", "hdl"],
    defaultUnit: "mg/dL",
    defaultRangesByUnit: { "mg/dL": [40, 60] },
    minValue: 0,
    maxValue: 200,
  },
  {
    name: "ldl",
    labels: ["ldl cholesterol", "low density lipoprotein", "ldl"],
    defaultUnit: "mg/dL",
    defaultRangesByUnit: { "mg/dL": [0, 100] },
    minValue: 0,
    maxValue: 500,
  },
  {
    name: "triglycerides",
    labels: ["triglycerides", "triglyceride", "tg"],
    defaultUnit: "mg/dL",
    defaultRangesByUnit: { "mg/dL": [0, 150] },
    minValue: 0,
    maxValue: 2000,
  },
  {
    name: "wbc",
    labels: ["white blood cell count", "white blood cells", "total leucocyte count", "wbc", "leukocytes"],
    defaultUnit: "10^3/uL",
    defaultRangesByUnit: { "10^3/uL": [4.0, 11.0] },
    minValue: 0,
    maxValue: 200,
  },
  {
    name: "rbc",
    labels: ["red blood cell count", "red blood cells", "rbc", "erythrocytes"],
    defaultUnit: "million/uL",
    defaultRangesByUnit: { "million/uL": [4.1, 5.9] },
    minValue: 0,
    maxValue: 20,
  },
  {
    name: "platelets",
    labels: ["platelets", "platelet", "plt", "thrombocytes"],
    defaultUnit: "10^3/uL",
    defaultRangesByUnit: { "10^3/uL": [150, 450] },
    minValue: 0,
    maxValue: 2000,
  },
  {
    name: "creatinine",
    labels: ["creatinine", "creat"],
    defaultUnit: "mg/dL",
    defaultRangesByUnit: { "mg/dL": [0.6, 1.3], "µmol/L": [59, 104] },
    minValue: 0,
    maxValue: 2000,
  },
  {
    name: "urea",
    labels: ["blood urea nitrogen", "urea", "bun"],
    defaultUnit: "mg/dL",
    defaultRangesByUnit: { "mg/dL": [7, 20], "mmol/L": [2.5, 7.1] },
    minValue: 0,
    maxValue: 400,
  },
  {
    name: "blood_pressure",
    labels: ["blood pressure", "bp"],
    defaultUnit: "mmHg",
    compound: "bp",
    minValue: 20,
    maxValue: 300,
  },
];

/** Space-tolerant unit tokens; most specific alternatives come first. */
const UNIT_REGEX =
  /(mg\s*\/\s*dL|g\s*\/\s*dL|mmol\s*\/\s*L|mcmol\s*\/\s*L|µ?mol\s*\/\s*L|10\s*\^\s*3\s*\/\s*uL|10\s*\^\s*9\s*\/\s*L|thousand\s*\/\s*uL|k\s*\/\s*uL|million\s*\/\s*uL|\/\s*uL|\/\s*mm3|\/\s*cmm|mmHg|%)/i;

const VALUE_REGEX = /(\d{1,4}(?:[.,]\d{1,2})?)/;
const RANGE_PAIR_REGEX = /(\d{1,4}(?:[.,]\d{1,2})?)\s*[-–—]\s*(\d{1,4}(?:[.,]\d{1,2})?)/;
const RANGE_LT_REGEX = /<\s*(\d{1,4}(?:[.,]\d{1,2})?)/;
const RANGE_GT_REGEX = />\s*(\d{1,4}(?:[.,]\d{1,2})?)/;
const BP_REGEX = /(\d{2,3})\s*\/\s*(\d{2,3})/;

function normalizeUnit(raw: string): string {
  const s = raw.replace(/\s+/g, "").toLowerCase();
  if (/^(g\/dl|gm\/dl)$/.test(s)) return "g/dL";
  if (/^mg\/dl$/.test(s)) return "mg/dL";
  if (/^mmol\/l$/.test(s)) return "mmol/L";
  if (/^(mcmol|umol|µmol)\/l$/.test(s)) return "µmol/L";
  if (/^mmhg$/.test(s)) return "mmHg";
  if (/^%$/.test(s)) return "%";
  if (/^(10\^3\/ul|x10\^3\/ul|k\/ul|thousand\/ul|\/ul|\/mm3|\/cmm)$/.test(s)) {
    return "10^3/uL";
  }
  if (/^10\^9\/l$/.test(s)) return "10^9/L";
  if (/^(million\/ul|m\/ul)$/.test(s)) return "million/uL";
  return raw.trim();
}

/** Finds the first recognized unit token in a segment, or null. */
function findUnit(segment: string): string | null {
  const match = segment.match(UNIT_REGEX);
  return match ? normalizeUnit(match[0]) : null;
}

/** Parses a numeric token; "14,2" → 14.2, "1,250" → 1250. Returns null on garbage. */
function parseNumberToken(token: string): number | null {
  let s = token.trim();
  if (/^\d{1,3},\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const value = Number(s);
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface Range {
  min: number | null;
  max: number | null;
}

/** Extracts a declared reference range ("13.5 - 17.5", "<100", ">60"). */
function parseRange(segment: string): Range {
  const pair = segment.match(RANGE_PAIR_REGEX);
  if (pair) {
    const min = parseNumberToken(pair[1]);
    const max = parseNumberToken(pair[2]);
    if (min !== null && max !== null && min <= max) return { min, max };
  }
  const lt = segment.match(RANGE_LT_REGEX);
  if (lt) return { min: null, max: parseNumberToken(lt[1]) };
  const gt = segment.match(RANGE_GT_REGEX);
  if (gt) return { min: parseNumberToken(gt[1]), max: null };
  return { min: null, max: null };
}

/** Typical adult range used only when the report declares none. */
function defaultRangeFor(def: MetricDef, unit: string | null): [number, number] | null {
  const table = def.defaultRangesByUnit;
  if (!table) return null;
  if (unit && table[unit]) return table[unit];
  return def.defaultUnit && table[def.defaultUnit] ? table[def.defaultUnit] : null;
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[a-z0-9]/.test(ch);
}

interface LabelMatch {
  def: MetricDef;
  label: string;
  index: number;
  end: number;
}

/** Locates a label in a lower-cased line, requiring word boundaries. */
function findLabel(lineLower: string, label: string): { index: number; end: number } | null {
  const idx = lineLower.indexOf(label);
  if (idx < 0) return null;
  if (isWordChar(lineLower[idx - 1]) || isWordChar(lineLower[idx + label.length])) {
    return null;
  }
  return { index: idx, end: idx + label.length };
}

/** Collects every label hit on a line, keeping the most specific per span. */
function collectMatches(lineLower: string): LabelMatch[] {
  const matches: LabelMatch[] = [];
  for (const def of METRICS) {
    for (const label of def.labels) {
      const hit = findLabel(lineLower, label);
      if (hit) matches.push({ def, label, index: hit.index, end: hit.end });
    }
  }
  // Longest label first; drop any match overlapping an already-kept span.
  matches.sort((a, b) => b.end - b.index - (a.end - a.index));
  const kept: LabelMatch[] = [];
  for (const m of matches) {
    const overlaps = kept.some((k) => m.index < k.end && k.index < m.end);
    if (!overlaps) kept.push(m);
  }
  return kept;
}

/** Extracts metric(s) from a line given a resolved label match. */
function extractFromMatch(line: string, match: LabelMatch): ParsedMetric[] {
  const segment = line.slice(match.end).trim();
  if (!segment) return [];

  if (match.def.compound === "bp") {
    const bp = segment.match(BP_REGEX);
    if (!bp) return [];
    const sys = Number(bp[1]);
    const dia = Number(bp[2]);
    if (sys < 20 || sys > 300 || dia < 20 || dia > 300) return [];
    const unit = findUnit(segment) ?? "mmHg";
    return [
      {
        metric_name: "blood_pressure_systolic",
        metric_value: sys,
        unit,
        reference_range_min: 90,
        reference_range_max: 120,
      },
      {
        metric_name: "blood_pressure_diastolic",
        metric_value: dia,
        unit,
        reference_range_min: 60,
        reference_range_max: 80,
      },
    ];
  }

  const valueMatch = segment.match(VALUE_REGEX);
  if (!valueMatch || valueMatch.index === undefined) return [];
  const rawValue = valueMatch[0];
  const value = parseNumberToken(rawValue);
  if (value === null || value < match.def.minValue || value > match.def.maxValue) return [];

  const afterValue = segment.slice(valueMatch.index + rawValue.length);
  // "10^3/uL" fragments (exponent) are not standalone values.
  if (afterValue.startsWith("^")) return [];

  const unit = findUnit(afterValue) ?? match.def.defaultUnit;
  const range = parseRange(afterValue);
  const fallback = defaultRangeFor(match.def, unit);
  // If the report declared a range — even a one-sided one like "<100" —
  // trust it as-is and never backfill the missing bound from defaults.
  const declared = range.min !== null || range.max !== null;
  return [
    {
      metric_name: match.def.name,
      metric_value: value,
      unit,
      reference_range_min: range.min ?? (declared ? null : fallback ? fallback[0] : null),
      reference_range_max: range.max ?? (declared ? null : fallback ? fallback[1] : null),
    },
  ];
}

/**
 * Parses OCR text into structured metrics.
 *
 * - Deduplicates: the first occurrence of each metric wins.
 * - Safe: per-line try/catch; malformed lines are skipped, never thrown.
 * - Missing units fall back to the metric's typical unit.
 * - Reference ranges come from the report when stated, else typical adult ranges.
 */
export function parseMedicalText(ocrText: string): ParsedMetric[] {
  if (!ocrText || !ocrText.trim()) return [];
  const found = new Map<string, ParsedMetric>();
  const lines = ocrText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const lineLower = line.toLowerCase();
    try {
      const matches = collectMatches(lineLower);
      for (const match of matches) {
        for (const metric of extractFromMatch(line, match)) {
          if (!found.has(metric.metric_name)) found.set(metric.metric_name, metric);
        }
      }
    } catch {
      // Malformed OCR on this line — ignore and continue.
    }
  }

  return [...found.values()];
}
