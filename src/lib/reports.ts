import { getSupabase } from "@/lib/supabase";
import { isOcrError, OcrError, runOcr } from "@/lib/ocr";
import { parseMedicalText, type ParsedMetric } from "@/lib/parser";
import { recomputePersonalBaselines } from "@/lib/baseline-data";
import {
  generateReportInsight,
  saveAiInsight,
  type AiInsight,
} from "@/lib/insights";

/** Storage bucket + limits for Feature 1 (AI Medical Report → Action Plan). */
export const MEDICAL_REPORTS_BUCKET = "medical-reports";
export const MAX_REPORT_SIZE = 20 * 1024 * 1024; // 20 MB

export type ReportType = "blood_report" | "lab_report" | "prescription";
export type ProcessingStatus =
  | "uploaded"
  | "extracting"
  | "analyzing"
  | "completed"
  | "failed";

export const REPORT_TYPE_OPTIONS: { value: ReportType; label: string }[] = [
  { value: "blood_report", label: "Blood Report" },
  { value: "lab_report", label: "Lab Report" },
  { value: "prescription", label: "Prescription" },
];

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

export function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Returns a friendly error message, or null when the file is acceptable. */
export function validateReportFile(file: File): string | null {
  if (file.size > MAX_REPORT_SIZE) {
    return "This file is larger than 20 MB. Please upload a smaller file.";
  }
  if (!ALLOWED_EXTENSIONS.includes(getFileExtension(file.name))) {
    return "Unsupported file type. Please upload a PDF, JPG, JPEG, or PNG.";
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface UploadedReport {
  id: string;
  fileUrl: string;
  createdAt: string;
}

export interface UploadMedicalReportParams {
  userId: string;
  file: File;
  reportType: ReportType;
  reportDate: string | null;
}

/**
 * Uploads the file to private storage and creates the medical_reports row.
 * Progress is surfaced by the caller as a smooth animation; this storage-js
 * build does not expose an upload-progress callback.
 */
export async function uploadMedicalReport(
  params: UploadMedicalReportParams,
): Promise<UploadedReport> {
  const supabase = getSupabase();
  const objectPath = `${params.userId}/${crypto.randomUUID()}-${params.file.name}`;

  const { error: uploadError } = await supabase.storage
    .from(MEDICAL_REPORTS_BUCKET)
    .upload(objectPath, params.file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    if (/bucket/i.test(uploadError.message)) {
      throw new Error(
        "Storage bucket 'medical-reports' is missing. Apply migration 0003 or create the bucket in Supabase.",
      );
    }
    if (/relation .* does not exist|PGRST205/i.test(uploadError.message)) {
      throw new Error(
        "The database schema is not applied yet. Run migrations 0001–0003 in the Supabase SQL Editor.",
      );
    }
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const reportDate = params.reportDate || new Date().toISOString().slice(0, 10);

  const { data, error: insertError } = await supabase
    .from("medical_reports")
    .insert({
      user_id: params.userId,
      report_title: params.file.name,
      report_type: params.reportType,
      report_date: reportDate,
      file_url: objectPath,
      processing_status: "uploaded",
    })
    .select("id, created_at, file_url")
    .single();

  if (insertError) {
    // Best-effort cleanup of the orphaned object.
    await supabase.storage.from(MEDICAL_REPORTS_BUCKET).remove([objectPath]);
    if (/relation .* does not exist|PGRST205/i.test(insertError.message)) {
      throw new Error(
        "The database schema is not applied yet. Run migrations 0001–0003 in the Supabase SQL Editor.",
      );
    }
    throw new Error(`Could not save the report: ${insertError.message}`);
  }

  return {
    id: data.id,
    fileUrl: data.file_url,
    createdAt: data.created_at,
  };
}

export async function updateReportProcessingStatus(
  reportId: string,
  status: ProcessingStatus,
): Promise<void> {
  const { error } = await getSupabase()
    .from("medical_reports")
    .update({ processing_status: status })
    .eq("id", reportId);
  if (error) {
    console.warn(`[reports] failed to update status to ${status}:`, error.message);
  }
}

/** Downloads the uploaded object back from private storage (object path). */
export async function downloadReportFile(fileUrl: string): Promise<Blob> {
  const { data, error } = await getSupabase()
    .storage.from(MEDICAL_REPORTS_BUCKET)
    .download(fileUrl);
  if (error) {
    throw new Error(
      /fetch|network|offline/i.test(error.message)
        ? "Network failure — could not download the uploaded file from storage."
        : `Could not download the uploaded file: ${error.message}`,
    );
  }
  return data;
}

/** Persists the extracted OCR text. Only touches the ocr_text column. */
export async function updateReportOcrText(
  reportId: string,
  ocrText: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("medical_reports")
    .update({ ocr_text: ocrText })
    .eq("id", reportId);
  if (error) {
    throw new Error(`Could not save the extracted text: ${error.message}`);
  }
}

export interface SaveMetricsResult {
  /** Rows actually inserted into health_metrics. */
  inserted: number;
  /** Metrics skipped because they already exist for this report. */
  duplicates: number;
}

/**
 * Persists parsed metrics into health_metrics.
 * Duplicates are ignored twice over: against rows already stored for this
 * report (re-runs) and within the incoming list. RLS (migration 0001) scopes
 * every insert to reports owned by the signed-in user.
 */
export async function saveHealthMetrics(
  reportId: string,
  metrics: ParsedMetric[],
): Promise<SaveMetricsResult> {
  if (metrics.length === 0) return { inserted: 0, duplicates: 0 };
  const supabase = getSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("health_metrics")
    .select("metric_name")
    .eq("report_id", reportId);
  if (fetchError) {
    throw new Error(`Could not check existing metrics: ${fetchError.message}`);
  }

  const existingNames = new Set((existing ?? []).map((row) => row.metric_name));
  const fresh = metrics.filter((m) => !existingNames.has(m.metric_name));
  if (fresh.length === 0) return { inserted: 0, duplicates: metrics.length };

  const { error: insertError } = await supabase.from("health_metrics").insert(
    fresh.map((m) => ({
      report_id: reportId,
      metric_name: m.metric_name,
      metric_value: m.metric_value,
      metric_unit: m.unit,
      population_min: m.reference_range_min,
      population_max: m.reference_range_max,
    })),
  );
  if (insertError) {
    throw new Error(`Could not save the extracted metrics: ${insertError.message}`);
  }

  return { inserted: fresh.length, duplicates: metrics.length - fresh.length };
}

export interface PipelineResult {
  /** Full text extracted by the OCR engine. */
  ocrText: string;
  /** Structured metrics parsed from the OCR text (the extraction summary). */
  metrics: ParsedMetric[];
  /** health_metrics rows written for this report. */
  metricsInserted: number;
  /** Metrics skipped as duplicates. */
  metricsDuplicates: number;
  /** Gemini AI analysis, when the AI stage succeeded. */
  ai: AiInsight | null;
  /** True when the AI stage failed — OCR + metrics are still saved. */
  aiUnavailable: boolean;
}

export interface RunPipelineParams {
  reportId: string;
  /** Stored object path (medical_reports.file_url) used to re-download the file. */
  fileUrl: string;
  /** Original upload — used to reconstruct the File (name/type) for the OCR engine. */
  file: File;
  /** Supabase access token for the signed-in user (used by the AI action). */
  accessToken: string;
  /** Owner of the report; used to recompute personal baselines after success. */
  userId: string;
  onStatus: (status: ProcessingStatus) => void;
  /** Live progress messages (OCR pages / AI stage), if desired. */
  onOcrProgress?: (message: string) => void;
}

/**
 * Post-upload pipeline.
 *
 *   uploaded  →  extracting  →  analyzing  →  completed
 *
 * - extracting: real OCR (download from storage → Tesseract/pdf.js), then
 *   the Medical Data Parser turns the extracted text into structured metrics
 *   persisted into health_metrics (duplicates ignored).
 * - analyzing: Feature 3 — the Gemini AI analysis. Only the OCR text and the
 *   parsed metrics are sent (never the PDF/image), via the secure Convex
 *   action. On ANY AI failure the pipeline still completes: OCR text and
 *   metrics remain saved and the UI shows "AI Analysis currently
 *   unavailable."
 * - APBE: after a successful run, every personal baseline is recomputed
 *   automatically from health_metrics (never blocks or fails the pipeline).
 * - OCR/parse failures mark the report `failed` and rethrow a structured
 *   OcrError for the UI to present.
 */
export async function runProcessingPipeline(
  params: RunPipelineParams,
): Promise<PipelineResult> {
  const { reportId, fileUrl, file, accessToken, userId, onStatus, onOcrProgress } = params;

  onStatus("uploaded");

  let ocrText: string;
  try {
    onStatus("extracting");
    await updateReportProcessingStatus(reportId, "extracting");

    // Retrieve the uploaded file from Supabase Storage, then OCR it.
    const blob = await downloadReportFile(fileUrl);
    const ocrFile = new File([blob], file.name, {
      type: file.type || "application/octet-stream",
    });
    const result = await runOcr(ocrFile, (progress) =>
      onOcrProgress?.(progress.message),
    );
    ocrText = result.text;
  } catch (err) {
    await updateReportProcessingStatus(reportId, "failed");
    if (isOcrError(err)) throw err;
    throw new OcrError(
      "network",
      "The OCR pipeline failed unexpectedly. Please try again.",
    );
  }

  // Persist the extracted text (does not overwrite any other field).
  await updateReportOcrText(reportId, ocrText);
  onOcrProgress?.("Text extracted — finalizing…");

  // Structured extraction: parse the OCR text and store every metric in
  // health_metrics, ignoring duplicates.
  const metrics = parseMedicalText(ocrText);
  const { inserted, duplicates } = await saveHealthMetrics(reportId, metrics);
  onOcrProgress?.(
    `Parsed ${metrics.length} metric${metrics.length === 1 ? "" : "s"} · ${inserted} stored`,
  );

  // AI analysis stage (Feature 3) — secure Gemini call through Convex.
  onStatus("analyzing");
  await updateReportProcessingStatus(reportId, "analyzing");

  let ai: AiInsight | null = null;
  let aiUnavailable = false;
  try {
    onOcrProgress?.("Consulting the AI physician…");
    const outcome = await generateReportInsight(reportId, accessToken);
    if (outcome.ok) {
      ai = outcome.insight;
      await saveAiInsight({
        reportId,
        insight: outcome.insight,
        raw: outcome.raw,
        model: outcome.model,
        processingTimeMs: outcome.processingTimeMs,
      });
      onOcrProgress?.("AI analysis ready");
    } else {
      aiUnavailable = true;
      console.warn(`[reports] AI unavailable (${outcome.code}): ${outcome.message}`);
    }
  } catch (err) {
    // Keep OCR + metrics saved; only the AI stage is lost.
    aiUnavailable = true;
    console.warn("[reports] AI stage failed:", err);
  }

  // APBE (Adaptive Personal Baseline Engine): after a successful run, recompute
  // every personal baseline from health_metrics automatically — no manual
  // button. Failures here never break the pipeline (baselines can be rebuilt
  // from the saved metrics later).
  try {
    await recomputePersonalBaselines(userId);
    onOcrProgress?.("Personal baselines updated");
  } catch (baselineErr) {
    console.warn("[reports] personal baseline recompute failed:", baselineErr);
  }

  onStatus("completed");
  await updateReportProcessingStatus(reportId, "completed");

  return {
    ocrText,
    metrics,
    metricsInserted: inserted,
    metricsDuplicates: duplicates,
    ai,
    aiUnavailable,
  };
}

export interface ReportRow {
  id: string;
  report_title: string;
  report_type: ReportType;
  report_date: string | null;
  file_url: string;
  processing_status: ProcessingStatus;
  created_at: string;
}

/**
 * Lists the current user's own reports (enforced by existing RLS policies).
 * Throws a special marker when the schema hasn't been applied yet.
 */
export async function fetchMyReports(): Promise<ReportRow[]> {
  const { data, error } = await getSupabase()
    .from("medical_reports")
    .select(
      "id, report_title, report_type, report_date, file_url, processing_status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    if (/relation .* does not exist|PGRST205/i.test(error.message)) {
      throw new Error("SCHEMA_NOT_APPLIED");
    }
    throw error;
  }
  return (data ?? []) as ReportRow[];
}
