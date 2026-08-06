import { AiAnalysisSection } from "@/components/app/ai-analysis";
import { Caret } from "@/components/landing/terminal-window";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { isOcrError } from "@/lib/ocr";
import { AI_UNAVAILABLE_MESSAGE, type AiInsight } from "@/lib/insights";
import {
  formatFileSize,
  MAX_REPORT_SIZE,
  REPORT_TYPE_OPTIONS,
  runProcessingPipeline,
  uploadMedicalReport,
  validateReportFile,
  type ProcessingStatus,
  type ReportType,
  type UploadedReport,
} from "@/lib/reports";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Clock,
  Download,
  FileText,
  FileUp,
  Loader2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const PIPELINE_STEPS: { status: ProcessingStatus; label: string; hint: string }[] = [
  { status: "uploaded", label: "Uploaded", hint: "File secured in private storage" },
  { status: "extracting", label: "Extracting", hint: "Reading report contents with OCR" },
  { status: "analyzing", label: "Analyzing", hint: "Building your action plan" },
  { status: "completed", label: "Completed", hint: "Report is ready" },
];

const TYPE_ICONS: Record<ReportType, typeof FileText> = {
  blood_report: FileText,
  lab_report: FileText,
  prescription: FileText,
};

/** Lines of extracted text shown before the preview is expanded. */
const PREVIEW_LINES = 8;

function mapUploadError(message: string): string {
  if (/Failed to fetch|NetworkError|fetch failed|ERR_CONNECTION|Network request failed/i.test(message)) {
    return "Network failure — we couldn't reach the server. Check your connection and try again.";
  }
  if (/larger than 20 MB/i.test(message)) return message;
  if (/Unsupported file/i.test(message)) return message;
  if (/bucket/i.test(message)) return message;
  if (/schema is not applied/i.test(message)) return message;
  return message;
}

function ReportTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: ReportType;
  onChange: (t: ReportType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {REPORT_TYPE_OPTIONS.map((opt) => {
        const Icon = TYPE_ICONS[opt.value];
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-xs font-medium transition-all sm:py-3.5 ${
              active
                ? "border-primary/40 bg-primary/12 text-primary shadow-[0_0_20px_-6px] shadow-primary/40"
                : "border-border/70 bg-background/50 text-muted-foreground hover:border-border hover:bg-accent/60 hover:text-foreground"
            } ${disabled ? "pointer-events-none opacity-60" : ""}`}
          >
            <Icon style={{ width: 18, height: 18 }} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PipelineStepper({ current }: { current: ProcessingStatus }) {
  const currentIndex = PIPELINE_STEPS.findIndex((s) => s.status === current);
  return (
    <ol className="space-y-3">
      {PIPELINE_STEPS.map((step, i) => {
        const done = i < currentIndex || current === "completed";
        const active = i === currentIndex && current !== "completed";
        return (
          <motion.li
            key={step.status}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="flex items-start gap-3"
          >
            <span
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] transition-all ${
                done
                  ? "border-ok/40 bg-ok/15 text-ok"
                  : active
                    ? "border-primary/50 bg-primary/12 text-primary"
                    : "border-border/70 bg-background/50 text-muted-foreground/50"
              }`}
            >
              {done ? (
                <CheckCircle2 className="size-4" />
              ) : active ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                i + 1
              )}
            </span>
            <div className="min-w-0">
              <p
                className={`text-[13px] font-medium ${
                  done || active ? "text-foreground" : "text-muted-foreground/60"
                }`}
              >
                {step.label}
              </p>
              <p className="truncate text-[11px] text-muted-foreground/80">{step.hint}</p>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

/** Collapsible extracted-text preview with copy + download actions. */
function OcrResultCard({ ocrText, fileName }: { ocrText: string; fileName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const previewLines = useMemo(() => {
    const lines = ocrText.split("\n");
    return lines.length > PREVIEW_LINES ? lines.slice(0, PREVIEW_LINES).join("\n") : ocrText;
  }, [ocrText]);

  const copyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ocrText);
    } catch {
      // Fallback for environments without the async clipboard API.
      const area = document.createElement("textarea");
      area.value = ocrText;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    toast.success("Extracted text copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, [ocrText]);

  const downloadText = useCallback(() => {
    const blob = new Blob([ocrText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName.replace(/\.[^.]+$/, "")}-ocr.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success("Text file downloaded");
  }, [ocrText, fileName]);

  return (
    <div className="rounded-3xl border border-ok/25 bg-ok/8 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
              OCR Completed
              <Badge className="bg-ok/15 text-ok">Text extracted</Badge>
            </h3>
            <p className="text-[12px] text-muted-foreground">
              Plain text recovered from the document — values, units and reference ranges
              preserved in order.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={copyText}
          >
            {copied ? <Check className="size-4 text-ok" /> : <ClipboardCopy className="size-4" />}
            {copied ? "Copied!" : "Copy Text"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={downloadText}
          >
            <Download className="size-4" />
            Download Text
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-background/60">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <FileText className="size-3.5" />
            extracted-text.txt
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            {expanded ? (
              <>
                Collapse <ChevronUp className="size-3.5" />
              </>
            ) : (
              <>
                Expand <ChevronDown className="size-3.5" />
              </>
            )}
          </button>
        </div>
        <div className="relative">
          <pre
            className={`whitespace-pre-wrap break-words px-4 py-3.5 font-mono text-[12px] leading-6 text-foreground/90 ${
              expanded ? "max-h-[340px] overflow-y-auto" : "max-h-40 overflow-hidden"
            }`}
          >
            {expanded ? ocrText : previewLines}
          </pre>
          {!expanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/90 to-transparent" />
          )}
        </div>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full cursor-pointer border-t border-border/60 px-4 py-2.5 text-center text-[12px] font-medium text-primary transition-colors hover:bg-primary/8"
          >
            Show full text ({ocrText.length.toLocaleString()} characters)
          </button>
        )}
      </div>
    </div>
  );
}

export default function UploadReport() {
  const { user, session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [reportType, setReportType] = useState<ReportType>("blood_report");
  const [reportDate, setReportDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "done" | "error">(
    "idle",
  );
  const [progress, setProgress] = useState(0);
  const [pipelineStatus, setPipelineStatus] = useState<ProcessingStatus>("uploaded");
  const [uploaded, setUploaded] = useState<UploadedReport | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiInsight | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Ease the progress bar upward while uploading so it never looks frozen.
  // This storage-js build exposes no upload-progress callback, so the bar
  // eases toward 90% and snaps to 100% when the server responds.
  useEffect(() => {
    if (phase !== "uploading") return;
    const timer = setInterval(() => {
      setProgress((p) => (p < 90 ? Math.min(90, p + Math.max(1, Math.round((90 - p) * 0.09))) : p));
    }, 120);
    return () => clearInterval(timer);
  }, [phase]);

  const reset = useCallback(() => {
    setFile(null);
    setProgress(0);
    setPipelineStatus("uploaded");
    setUploaded(null);
    setOcrText(null);
    setOcrError(null);
    setAi(null);
    setAiUnavailable(false);
    setOcrMessage(null);
    setError(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const selectFile = useCallback((candidate: File | null) => {
    if (!candidate) return;
    const problem = validateReportFile(candidate);
    if (problem) {
      setError(problem);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError(null);
    setPhase("idle");
    setProgress(0);
    setUploaded(null);
    setOcrText(null);
    setOcrError(null);
    setAi(null);
    setAiUnavailable(false);
    setOcrMessage(null);
    setFile(candidate);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      selectFile(e.dataTransfer.files?.[0] ?? null);
    },
    [selectFile],
  );

  const handleUpload = useCallback(async () => {
    if (!file) {
      setError("Choose a file first — drag one in or click the upload area.");
      return;
    }
    if (!user) {
      setError("You need to be signed in to upload a report.");
      return;
    }
    setError(null);
    setOcrError(null);
    setOcrText(null);
    setAi(null);
    setAiUnavailable(false);
    setOcrMessage(null);
    setPhase("uploading");
    setProgress(4);

    try {
      const result = await uploadMedicalReport({
        userId: user.id,
        file,
        reportType,
        reportDate,
      });
      setUploaded(result);
      setProgress(100);
      setPhase("processing");
      await new Promise((r) => setTimeout(r, 350));

      try {
        const pipeline = await runProcessingPipeline({
          reportId: result.id,
          fileUrl: result.fileUrl,
          file,
          userId: user.id,
          accessToken: session?.access_token ?? "",
          onStatus: setPipelineStatus,
          onOcrProgress: setOcrMessage,
        });
        setOcrText(pipeline.ocrText);
        setAi(pipeline.ai);
        setAiUnavailable(pipeline.aiUnavailable);
        setPhase("done");
        toast.success("Report uploaded and processed");
      } catch (pipelineErr) {
        if (isOcrError(pipelineErr)) {
          // The upload itself succeeded — only the OCR stage failed.
          setOcrError(pipelineErr.message);
          setPhase("done");
          toast.error("OCR could not complete");
        } else {
          throw pipelineErr;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(mapUploadError(message));
      setPhase("error");
      toast.error("Upload failed");
    }
  }, [file, user, session, reportType, reportDate]);

  const busy = phase === "uploading" || phase === "processing";
  const TypeIcon = file ? TYPE_ICONS[reportType] : FileUp;
  const ocrFinished = ocrText !== null || ocrError !== null;
  const aiSettled = ai !== null || aiUnavailable;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-4xl"
    >
      <p className="font-mono text-[12px] text-muted-foreground">
        <span className="text-primary">$</span> arogya module · upload-report
      </p>

      <div className="glass-card mt-5 rounded-3xl p-6 sm:p-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Upload Report
              <Caret className="ml-1.5" />
            </h1>
            <p className="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">
              Drop in a blood test, lab report, or prescription. ArogyaOS secures the file,
              extracts the text with OCR, parses the values, and generates a plain-language
              AI analysis automatically.
            </p>
          </div>
        </div>

        {phase === "done" && uploaded ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 space-y-5"
          >
            {/* Success card */}
            <div className="rounded-3xl border border-ok/25 bg-ok/8 p-6 sm:p-8">
              <div className="flex items-center gap-4">
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
                  className="flex size-14 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok"
                >
                  <CheckCircle2 className="size-8" />
                </motion.span>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    Upload Successful
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Your report is safe and ready in the pipeline.
                  </p>
                </div>
              </div>

              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    File Name
                  </dt>
                  <dd className="mt-1 flex items-center gap-2 break-all text-sm font-medium text-foreground">
                    <FileText className="size-4 shrink-0 text-primary" />
                    {file?.name ?? "report"}
                  </dd>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Upload Time
                  </dt>
                  <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Clock className="size-4 shrink-0 text-primary" />
                    {new Date(uploaded.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </dd>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Report Type
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">
                    {REPORT_TYPE_OPTIONS.find((o) => o.value === reportType)?.label}
                  </dd>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Processing Status
                  </dt>
                  <dd className="mt-1">
                    <Badge className="bg-ok/15 text-ok">
                      <CheckCircle2 className="size-3" /> Completed
                    </Badge>
                  </dd>
                </div>
              </dl>
            </div>

            {/* OCR result */}
            {ocrText !== null && (
              <OcrResultCard ocrText={ocrText} fileName={file?.name ?? "report"} />
            )}

            {/* OCR failure — upload still succeeded, file is safe in storage. */}
            {ocrError !== null && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 rounded-3xl border border-warn/40 bg-warn/8 p-5 sm:p-6"
              >
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn">
                  <AlertTriangle className="size-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
                    OCR could not complete
                  </h3>
                  <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{ocrError}</p>
                  <p className="mt-2 text-[12px] text-muted-foreground/80">
                    Your file is safely stored — retry OCR from the Reports page once it ships.
                  </p>
                </div>
              </motion.div>
            )}

            {/* AI Analysis (Feature 3) */}
            {aiSettled && <AiAnalysisSection insight={ai} unavailable={aiUnavailable} />}

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Sparkles className="size-4 text-primary" />
                {ai
                  ? "AI analysis complete — powered by Gemini."
                  : aiUnavailable
                    ? AI_UNAVAILABLE_MESSAGE
                    : ocrFinished
                      ? "OCR complete — the AI summary arrives in a later milestone."
                      : "Pipeline finished."}
              </p>
              <Button type="button" variant="outline" className="cursor-pointer" onClick={reset}>
                Upload another report
              </Button>
            </div>
          </motion.div>
        ) : (
          <div className="mt-8 space-y-6">
            {/* Dropzone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload a medical report"
              onClick={() => !busy && inputRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !busy) inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              className={`group relative cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed p-8 text-center transition-all sm:p-12 ${
                dragActive
                  ? "border-primary bg-primary/8 scale-[1.01] shadow-[0_0_40px_-10px] shadow-primary/40"
                  : "border-border/70 bg-background/40 hover:border-primary/50 hover:bg-accent/30"
              } ${busy ? "pointer-events-none opacity-70" : ""}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="sr-only"
                onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
              />
              <AnimatePresence mode="wait">
                {file ? (
                  <motion.div
                    key="file"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="mx-auto flex max-w-md flex-col items-center gap-3"
                  >
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                      <TypeIcon className="size-7" />
                    </span>
                    <p className="break-all text-sm font-semibold text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)} ·{" "}
                      {REPORT_TYPE_OPTIONS.find((o) => o.value === reportType)?.label}
                    </p>
                    <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                      <FileUp className="size-3.5 text-primary" /> Ready to upload — click to
                      replace
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="mx-auto flex max-w-md flex-col items-center gap-3"
                  >
                    <motion.span
                      animate={{ y: [0, -6, 0] }}
                      transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
                      className="flex size-14 items-center justify-center rounded-2xl bg-primary/12 text-primary"
                    >
                      <UploadCloud className="size-7" />
                    </motion.span>
                    <p className="text-[15px] font-semibold text-foreground">
                      Drag &amp; drop your report
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      or <span className="font-medium text-primary">browse files</span> on this
                      device
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">
                      PDF · JPG · PNG — up to {MAX_REPORT_SIZE / (1024 * 1024)} MB
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Metadata */}
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                  Report Type
                </label>
                <ReportTypePicker
                  value={reportType}
                  onChange={setReportType}
                  disabled={busy || !file}
                />
              </div>
              <div>
                <label className="mb-2 block text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
                  Report Date
                </label>
                <Input
                  type="date"
                  value={reportDate}
                  max={new Date().toISOString().slice(0, 10)}
                  disabled={busy || !file}
                  onChange={(e) => setReportDate(e.target.value)}
                  className="h-11 w-full cursor-pointer rounded-2xl border border-border/70 bg-background/50 text-sm text-foreground"
                />
              </div>
            </div>

            {/* Upload progress / pipeline */}
            <AnimatePresence mode="wait">
              {(phase === "uploading" || phase === "processing") && (
                <motion.div
                  key="progress"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-2xl border border-border/70 bg-background/50 p-5">
                    {phase === "uploading" ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-[13px]">
                          <span className="flex items-center gap-2 font-medium text-foreground">
                            <Loader2 className="size-4 animate-spin text-primary" />
                            Uploading…
                          </span>
                          <span className="font-mono text-muted-foreground">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-2.5" />
                        <p className="text-[11px] text-muted-foreground/70">
                          Securing your file in private storage…
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <PipelineStepper current={pipelineStatus} />
                        {(pipelineStatus === "extracting" || pipelineStatus === "analyzing") &&
                          ocrMessage && (
                            <motion.p
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground"
                            >
                              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                              {ocrMessage}
                            </motion.p>
                          )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error */}
            <AnimatePresence mode="wait">
              {phase === "error" && error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-2.5 rounded-2xl border border-crit/30 bg-crit/8 p-4 text-sm text-crit"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Upload failed</p>
                    <p className="mt-0.5 text-crit/80">{error}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions */}
            <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground/80">
                <ShieldCheck className="size-4 text-ok" />
                Stored privately — only you can access your reports (RLS).
              </p>
              <div className="flex items-center gap-2">
                {file && !busy && (
                  <Button type="button" variant="ghost" className="cursor-pointer" onClick={reset}>
                    <X className="size-4" /> Clear
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={!file || busy}
                  onClick={handleUpload}
                  className="min-w-[180px] cursor-pointer"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Processing…
                    </>
                  ) : (
                    <>
                      <UploadCloud className="size-4" /> Upload &amp; Analyze
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
