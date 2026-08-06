import { getSupabase } from "@/lib/supabase";

/**
 * Health Timeline — data layer.
 *
 * Read-only accessors over the existing Supabase schema
 * (`medical_reports` + `health_metrics`, migration 0001) for the Health
 * Journey timeline. Every query runs through the signed-in user's Supabase
 * session, so the existing Row Level Security policies scope every read to
 * reports the user owns — nothing here bypasses or weakens RLS.
 *
 * All returned lists are ordered by `report_date` ascending (nulls last),
 * which is the chronological order a timeline renders in.
 */

export interface TimelineReport {
  id: string;
  /** human-readable report title (e.g. the original file name). */
  title: string;
  /** report classification (e.g. blood_report, lab_report, prescription). */
  type: string;
  /** ISO date (YYYY-MM-DD) the report is dated to; null when unknown. */
  reportDate: string | null;
  /** storage object path of the uploaded file, when available. */
  fileUrl: string | null;
  /** pipeline state (uploaded / extracting / analyzing / completed / failed). */
  processingStatus: string | null;
  /** row creation timestamp (ISO). */
  createdAt: string;
}

export interface TimelineMetric {
  id: string;
  /** owning medical_reports row. */
  reportId: string;
  /** report_date of the parent report (null when the report has no date). */
  reportDate: string | null;
  metricName: string;
  /** numeric reading from the report. */
  metricValue: number;
  metricUnit: string | null;
  /** reference range lower bound from the lab report, when provided. */
  populationMin: number | null;
  /** reference range upper bound from the lab report, when provided. */
  populationMax: number | null;
  /** measurement date written on the report itself, when provided. */
  measurementDate: string | null;
  /** row creation timestamp (ISO). */
  createdAt: string;
}

/** One reading of a single metric, tied to its source report for the timeline. */
export interface MetricHistoryPoint {
  reportId: string;
  reportDate: string | null;
  metricName: string;
  metricValue: number;
  metricUnit: string | null;
  populationMin: number | null;
  populationMax: number | null;
  measurementDate: string | null;
}

/** A health_metrics row with its embedded parent report (runtime shape). */
interface MetricRowWithReport {
  id: string;
  report_id: string;
  metric_name: string;
  metric_value: number;
  metric_unit: string | null;
  population_min: number | null;
  population_max: number | null;
  measurement_date: string | null;
  created_at: string;
  medical_reports: { user_id: string; report_date: string | null } | null;
}

/**
 * Throws a well-known marker when the underlying tables are missing (the
 * migrations have not been applied), matching the convention used by
 * `fetchMyReports` in src/lib/reports.ts.
 */
function throwIfSchemaMissing(error: { message?: string }): void {
  if (error?.message && /relation .* does not exist|PGRST205/i.test(error.message)) {
    throw new Error("SCHEMA_NOT_APPLIED");
  }
}

/** Ascending compare on report dates — nulls sort last. */
function compareReportDate(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/**
 * Normalizes the embedded parent report. PostgREST returns a to-one embed as
 * an object, but the supabase-js generic types model it as an array — this
 * accepts either shape safely.
 */
function toParent(
  row: MetricRowWithReport | MetricRowWithReport["medical_reports"],
): { user_id?: string; report_date?: string | null } | null {
  const parent = row && typeof row === "object" && "medical_reports" in row
    ? row.medical_reports
    : (row as MetricRowWithReport["medical_reports"]);
  if (Array.isArray(parent)) return parent[0] ?? null;
  return parent;
}

/**
 * Lists every report owned by `userId`, ordered by `report_date` ascending
 * (nulls last, then by creation time as a stable tiebreak).
 *
 * RLS note: the session's JWT already restricts reads to the signed-in
 * user's own rows; the explicit `user_id` filter is defense in depth and
 * matches the caller-provided identity.
 */
export async function fetchAllReports(userId: string): Promise<TimelineReport[]> {
  const { data, error } = await getSupabase()
    .from("medical_reports")
    .select(
      "id, report_title, report_type, report_date, file_url, processing_status, created_at",
    )
    .eq("user_id", userId);

  if (error) {
    throwIfSchemaMissing(error);
    throw error;
  }

  const reports = (data ?? []) as Array<{
    id: string;
    report_title: string;
    report_type: string;
    report_date: string | null;
    file_url: string | null;
    processing_status: string | null;
    created_at: string;
  }>;

  return reports
    .map(
      (row): TimelineReport => ({
        id: row.id,
        title: row.report_title,
        type: row.report_type,
        reportDate: row.report_date,
        fileUrl: row.file_url,
        processingStatus: row.processing_status,
        createdAt: row.created_at,
      }),
    )
    .sort(
      (a, b) =>
        compareReportDate(a.reportDate, b.reportDate) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/**
 * Returns every health_metrics reading for the reports owned by `userId`,
 * ordered by the parent report's `report_date` ascending (nulls last, then
 * creation time). The parent report date is embedded so each reading carries
 * its timeline position.
 *
 * RLS note: `health_metrics` policies inherit ownership from the parent
 * `medical_reports` row (migration 0001); the embedded parent's `user_id` is
 * additionally checked here so results always correspond to `userId`.
 */
export async function fetchMetricsForUser(userId: string): Promise<TimelineMetric[]> {
  const { data, error } = await getSupabase()
    .from("health_metrics")
    .select(
      "id, report_id, metric_name, metric_value, metric_unit, population_min, population_max, measurement_date, created_at, medical_reports(user_id, report_date)",
    );

  if (error) {
    throwIfSchemaMissing(error);
    throw error;
  }

  // Bridge the supabase-js generic (embedded resource typed as array) to the
  // actual runtime shape via unknown.
  const rows = (data ?? []) as unknown as MetricRowWithReport[];

  return rows
    .filter((row) => toParent(row)?.user_id === userId)
    .map((row): TimelineMetric => {
      const parent = toParent(row);
      return {
        id: row.id,
        reportId: row.report_id,
        reportDate: parent?.report_date ?? null,
        metricName: row.metric_name,
        metricValue: row.metric_value,
        metricUnit: row.metric_unit,
        populationMin: row.population_min,
        populationMax: row.population_max,
        measurementDate: row.measurement_date,
        createdAt: row.created_at,
      };
    })
    .sort(
      (a, b) =>
        compareReportDate(a.reportDate, b.reportDate) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/**
 * Returns the chronological history of one metric across all of the signed-in
 * user's reports (exact `metric_name` match), ordered by the parent report's
 * `report_date` ascending. Useful for sparklines and trend views on the
 * timeline.
 */
export async function fetchMetricHistory(metricName: string): Promise<MetricHistoryPoint[]> {
  const { data, error } = await getSupabase()
    .from("health_metrics")
    .select(
      "report_id, metric_name, metric_value, metric_unit, population_min, population_max, measurement_date, created_at, medical_reports(report_date)",
    )
    .eq("metric_name", metricName);

  if (error) {
    throwIfSchemaMissing(error);
    throw error;
  }

  const rows = (data ?? []) as unknown as Array<
    Omit<MetricRowWithReport, "medical_reports"> & {
      medical_reports: { report_date: string | null } | Array<{ report_date: string | null }> | null;
    }
  >;

  return rows
    .map((row): MetricHistoryPoint => {
      const parent = Array.isArray(row.medical_reports)
        ? row.medical_reports[0]
        : row.medical_reports;
      return {
        reportId: row.report_id,
        reportDate: parent?.report_date ?? null,
        metricName: row.metric_name,
        metricValue: row.metric_value,
        metricUnit: row.metric_unit,
        populationMin: row.population_min,
        populationMax: row.population_max,
        measurementDate: row.measurement_date,
      };
    })
    .sort(
      (a, b) =>
        compareReportDate(a.reportDate, b.reportDate) ||
        (a.measurementDate ?? "").localeCompare(b.measurementDate ?? "") ||
        a.reportId.localeCompare(b.reportId),
    );
}
