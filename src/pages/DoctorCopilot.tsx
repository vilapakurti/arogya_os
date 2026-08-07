import { DoctorChatPanel } from "@/components/app/doctor-chat";
import { Caret } from "@/components/landing/terminal-window";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { fetchPersonalBaselines } from "@/lib/baseline-data";
import {
  evaluatePatient,
  toClinicalProfile,
  type ClinicalProfile,
} from "@/lib/clinical";
import {
  buildCopilotAnalysis,
  buildCopilotChatContext,
  buildCopilotInput,
  fetchCopilotData,
  fetchLatestOcrExcerpt,
  fetchPreviousAiSummaries,
  generateCopilotBrief,
  type CopilotAnalysis,
  type CopilotBrief,
  type CopilotChatContext,
  type CopilotData,
  type CopilotRiskLevel,
  type PreviousAiSummary,
} from "@/lib/copilot";
import { AnimatePresence, motion } from "framer-motion";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Brain,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  FlaskConical,
  HeartPulse,
  ListChecks,
  Loader2,
  Printer,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

/**
 * Doctor Copilot (AI Visit Assistant).
 *
 * Prepares the user for a doctor visit: deterministic health summary built
 * from the shared timeline/trends/APBE modules, a per-metric latest-vs-
 * previous comparison, a timeline snapshot, an optional AI consultation brief
 * (secure Convex action), an interactive "Ask Doctor Copilot" chat panel
 * (secure `copilotChat:chat` action), and a branded PDF/print export. All data
 * reads reuse existing RLS-scoped accessors — no new tables, no new queries
 * beyond the previous-AI-summaries and latest-OCR lookups.
 *
 * Clinical interpretation is NOT computed here: every metric passes through
 * the Clinical Decision Support Engine (`buildCopilotAnalysis` →
 * `evaluateReport`, personalized against the patient profile), and the page
 * simply consumes the engine's output — severity, priority, trend, clinical
 * meaning, combined findings, risk profile and the patient-level evaluation.
 */

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const RISK_STYLES: Record<CopilotRiskLevel, string> = {
  LOW: "border-ok/40 bg-ok/15 text-ok",
  MODERATE: "border-warn/40 bg-warn/15 text-warn",
  ELEVATED: "border-[var(--chart-4)]/40 bg-[var(--chart-4)]/15 text-[var(--chart-4)]",
  HIGH: "border-crit/40 bg-crit/15 text-crit",
};

const RISK_LABELS: Record<CopilotRiskLevel, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  ELEVATED: "Elevated",
  HIGH: "High",
};

function RiskBadge({ level }: { level: CopilotRiskLevel }) {
  const Icon =
    level === "HIGH" ? AlertTriangle : level === "ELEVATED" || level === "MODERATE" ? Activity : ShieldCheck;
  return (
    <Badge className={RISK_STYLES[level]} aria-label={`Overall risk level: ${RISK_LABELS[level]}`}>
      <Icon className="size-3" /> {RISK_LABELS[level]}
    </Badge>
  );
}

const TREND_STYLES: Record<CopilotAnalysis["healthTrend"], string> = {
  Improving: "border-ok/40 bg-ok/15 text-ok",
  Stable: "border-border/60 bg-accent/60 text-muted-foreground",
  Mixed: "border-warn/40 bg-warn/15 text-warn",
  Worsening: "border-crit/40 bg-crit/15 text-crit",
};

function TrendBadge({ trend }: { trend: CopilotAnalysis["healthTrend"] }) {
  const Icon =
    trend === "Improving"
      ? TrendingUp
      : trend === "Worsening"
        ? TrendingDown
        : trend === "Mixed"
          ? Activity
          : ArrowRight;
  return (
    <Badge className={TREND_STYLES[trend]}>
      <Icon className="size-3" /> {trend}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

const STATUS_STYLES: Record<string, string> = {
  completed: "border-ok/40 bg-ok/15 text-ok",
  analyzing: "border-primary/40 bg-primary/12 text-primary",
  extracting: "border-warn/40 bg-warn/15 text-warn",
  uploaded: "border-border/60 bg-accent/60 text-muted-foreground",
  failed: "border-crit/40 bg-crit/15 text-crit",
};

function StatusBadge({ status }: { status: string | null }) {
  const key = status ?? "uploaded";
  return <Badge className={STATUS_STYLES[key] ?? STATUS_STYLES.uploaded}>{key}</Badge>;
}

function ComparisonDelta({ changePct, improving }: { changePct: number | null; improving: boolean | null }) {
  if (changePct === null) return <span className="text-muted-foreground">—</span>;
  const Icon =
    changePct > 0 ? ArrowUpRight : changePct < 0 ? ArrowDownRight : ArrowRight;
  const tone =
    improving === true
      ? "text-ok"
      : improving === false
        ? "text-crit"
        : "text-muted-foreground";
  return (
    <span className={`tnum inline-flex items-center gap-1 font-mono font-semibold ${tone}`}>
      <Icon className="size-3.5" aria-hidden />
      {changePct > 0 ? "+" : ""}
      {fmt(changePct)}%
    </span>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading doctor copilot">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <Skeleton className="h-4 w-96 max-w-full rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-3xl" />
      <Skeleton className="h-52 rounded-3xl" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Printable report (PDF + print)                                      */
/* ------------------------------------------------------------------ */

/**
 * Inline-styled, theme-independent report used for the PDF + print export.
 * `ref` attaches the parent's reportRef so html2canvas can capture this exact
 * node when the user downloads the PDF.
 */
function PrintableBrief({
  analysis,
  brief,
  ref,
}: {
  analysis: CopilotAnalysis;
  brief: CopilotBrief | null;
  ref?: React.Ref<HTMLDivElement | null>;
}) {
  const generatedAt = new Date().toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <div
      id="doctor-brief-print"
      ref={ref}
      style={{
        position: "fixed",
        left: -9999,
        top: 0,
        width: 794,
        background: "#ffffff",
        color: "#1c1917",
        padding: 40,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        fontSize: 13,
        lineHeight: 1.55,
      }}
      aria-hidden
    >
      <style>{`
        #doctor-brief-print { box-sizing: border-box; }
        #doctor-brief-print * { box-sizing: border-box; }
        #doctor-brief-print h1, #doctor-brief-print h2, #doctor-brief-print p { margin: 0; }
        #doctor-brief-print .mono { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      {/* Brand header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "2px solid #166534",
          paddingBottom: 14,
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "#166534" }}>
            ArogyaOS
          </div>
          <div style={{ fontSize: 11, color: "#57534e" }}>ai health memory · doctor visit brief</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: "#57534e" }}>
          <div>Generated {generatedAt}</div>
          <div>{analysis.reportCount} report(s) analyzed</div>
        </div>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 700, marginTop: 18, color: "#1c1917" }}>
        Doctor Visit Brief
      </h1>

      {/* Summary */}
      <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, color: "#166534" }}>
        PATIENT SUMMARY
      </h2>
      <p style={{ marginTop: 6 }}>
        {brief && brief.overallSummary ? brief.overallSummary : analysis.currentSummary}
      </p>
      {brief && brief.healthProgress && (
        <p style={{ marginTop: 8 }}>
          <strong>Progress:</strong> {brief.healthProgress}
        </p>
      )}
      <div style={{ display: "flex", gap: 24, marginTop: 12, fontSize: 12 }}>
        <span>
          <strong>Trend:</strong> {analysis.healthTrend}
        </span>
        <span>
          <strong>Overall risk:</strong>{" "}
          {brief ? brief.riskLevel : analysis.overallRiskLevel}
        </span>
        <span>
          <strong>Latest report:</strong> {formatDate(analysis.latestReport?.reportDate ?? null)}
        </span>
      </div>

      {/* Comparison table */}
      <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 18, color: "#166534" }}>
        IMPORTANT METRICS — LATEST VS PREVIOUS VS YOUR BASELINE
      </h2>
      {analysis.comparisons.length > 0 ? (
        <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              {["Metric", "Latest", "Previous", "Personal baseline", "Lab range"].map((head) => (
                <th
                  key={head}
                  style={{
                    borderBottom: "1px solid #d6d3d1",
                    padding: "6px 8px",
                    fontSize: 11,
                    color: "#57534e",
                  }}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysis.comparisons.map((c) => (
              <tr key={c.metricName}>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{c.label}</td>
                <td style={{ padding: "6px 8px" }} className="mono">
                  {fmt(c.latestValue)} {c.unit ?? ""}
                </td>
                <td style={{ padding: "6px 8px" }} className="mono">
                  {fmt(c.previousValue)}
                </td>
                <td style={{ padding: "6px 8px" }} className="mono">
                  {fmt(c.personalBaseline)}
                </td>
                <td style={{ padding: "6px 8px" }} className="mono">
                  {fmt(c.populationMin)}–{fmt(c.populationMax)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ marginTop: 6 }}>No structured metrics were extracted yet.</p>
      )}

      {/* Timeline */}
      <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 18, color: "#166534" }}>
        HEALTH TIMELINE
      </h2>
      <ul style={{ marginTop: 6, paddingLeft: 18 }}>
        {analysis.timeline.map((report) => (
          <li key={report.id} style={{ marginTop: 3 }}>
            {report.title} — {formatDate(report.reportDate)} ({report.processingStatus ?? "uploaded"})
          </li>
        ))}
      </ul>

      {/* Milestones + abnormal */}
      {analysis.milestones.length > 0 && (
        <>
          <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, color: "#166534" }}>
            IMPORTANT MILESTONES
          </h2>
          <ul style={{ marginTop: 6, paddingLeft: 18 }}>
            {analysis.milestones.map((milestone) => (
              <li key={milestone} style={{ marginTop: 3 }}>
                {milestone}
              </li>
            ))}
          </ul>
        </>
      )}
      {analysis.abnormalFindings.length > 0 && (
        <>
          <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, color: "#b91c1c" }}>
            LATEST ABNORMAL FINDINGS
          </h2>
          <ul style={{ marginTop: 6, paddingLeft: 18 }}>
            {analysis.abnormalFindings.map((finding) => (
              <li key={finding} style={{ marginTop: 3 }}>
                {finding}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Questions */}
      <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, color: "#166534" }}>
        QUESTIONS TO ASK YOUR DOCTOR
      </h2>
      <ol style={{ marginTop: 6, paddingLeft: 20 }}>
        {(brief && brief.recommendedQuestions.length > 0
          ? brief.recommendedQuestions
          : analysis.topQuestions
        ).map((question) => (
          <li key={question} style={{ marginTop: 3 }}>
            {question}
          </li>
        ))}
      </ol>

      {brief && brief.doctorDiscussionPoints.length > 0 && (
        <>
          <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, color: "#166534" }}>
            DISCUSSION POINTS
          </h2>
          <ul style={{ marginTop: 6, paddingLeft: 18 }}>
            {brief.doctorDiscussionPoints.map((point) => (
              <li key={point} style={{ marginTop: 3 }}>
                {point}
              </li>
            ))}
          </ul>
        </>
      )}

      <div
        style={{
          marginTop: 24,
          paddingTop: 12,
          borderTop: "1px solid #d6d3d1",
          fontSize: 10,
          color: "#78716c",
        }}
      >
        Generated by ArogyaOS — this brief is educational and does not replace professional
        medical advice. Please confirm everything with your doctor.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section scaffolding                                                  */
/* ------------------------------------------------------------------ */

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
  className = "",
}: {
  icon: typeof Sparkles;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`glass-card rounded-3xl p-5 sm:p-6 ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-mono text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

function ListGroup({
  items,
  tone = "default",
  empty = "Nothing to show yet.",
}: {
  items: string[];
  tone?: "default" | "good" | "bad" | "warn";
  empty?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  const dotClass =
    tone === "good"
      ? "bg-ok"
      : tone === "bad"
        ? "bg-crit"
        : tone === "warn"
          ? "bg-warn"
          : "bg-primary/60";
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="flex items-start gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2"
        >
          <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
          <span className="text-[12.5px] leading-5 text-foreground/90">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DoctorCopilot() {
  const { user, session, profile } = useAuth();
  const navigate = useNavigate();
  const reportRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<CopilotData | null>(null);
  const [baselineCount, setBaselineCount] = useState(0);
  const [previousSummaries, setPreviousSummaries] = useState<PreviousAiSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [latestOcr, setLatestOcr] = useState<string | null>(null);

  const [brief, setBrief] = useState<CopilotBrief | null>(null);
  const [briefState, setBriefState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const briefRequested = useRef(false);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /* Primary load — reports + metrics + baselines + previous AI summaries. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError(null);
    setData(null);
    Promise.all([
      fetchCopilotData(user.id),
      fetchPersonalBaselines(user.id).catch(() => []),
      fetchPreviousAiSummaries(user.id).catch(() => [] as PreviousAiSummary[]),
    ])
      .then(([copilotData, baselineRows, summaries]) => {
        if (cancelled) return;
        setData(copilotData);
        setBaselineCount(baselineRows.length);
        setPreviousSummaries(summaries);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, attempt]);

  /* Patient profile → CDSS clinical profile (personalized ranges/risk). */
  const clinicalProfile: ClinicalProfile = useMemo(
    () => toClinicalProfile(profile),
    [profile],
  );

  /* Deterministic analysis — memoized. Every metric passes through the
     Clinical Decision Support Engine, personalized against the profile. */
  const analysis = useMemo(
    () =>
      data
        ? buildCopilotAnalysis(data.reports, data.metrics, baselineCount, clinicalProfile)
        : null,
    [data, baselineCount, clinicalProfile],
  );

  /* Latest OCR excerpt for the Ask Doctor Copilot chat (one RLS-scoped read). */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchLatestOcrExcerpt(user.id)
      .then((excerpt) => {
        if (!cancelled) setLatestOcr(excerpt);
      })
      .catch(() => {
        if (!cancelled) setLatestOcr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  /* Ask Doctor Copilot — compact health snapshot reusing already-loaded data.
     The chat also consumes the CDSS patient-level evaluation. */
  const chatContext = useMemo<CopilotChatContext | null>(() => {
    if (!analysis) return null;
    const ctx = buildCopilotChatContext(analysis, previousSummaries, latestOcr);
    ctx.clinicalHighlights = [
      ctx.clinicalHighlights ?? "",
      `Patient risk summary: ${evaluatePatient(clinicalProfile, analysis.cdss).summary}`,
    ]
      .filter(Boolean)
      .join("\n");
    return ctx;
  }, [analysis, previousSummaries, latestOcr, clinicalProfile]);

  /* AI consultation brief — one call per visit when enough data. */
  useEffect(() => {
    if (
      !user ||
      !session?.access_token ||
      !analysis ||
      analysis.reportCount === 0 ||
      briefRequested.current ||
      briefState === "loading" ||
      briefState === "done"
    ) {
      return;
    }
    briefRequested.current = true;
    setBriefState("loading");

    const input = buildCopilotInput(analysis, previousSummaries);
    generateCopilotBrief(session.access_token, input)
      .then((outcome) => {
        if (outcome.ok) {
          setBrief(outcome.brief);
          setBriefState("done");
        } else {
          console.warn(`[copilot] AI brief unavailable (${outcome.code}): ${outcome.message}`);
          setBriefState("error");
        }
      })
      .catch(() => {
        setBriefState("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, session, analysis, previousSummaries]);

  /* ---------------------------- export ---------------------------- */

  const downloadPdf = useCallback(async () => {
    // The printable node is captured via the ref; fall back to the DOM id in
    // case the ref has not attached yet.
    const node =
      reportRef.current ?? document.getElementById("doctor-brief-print");
    if (!node || exporting) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageWidth = 210;
      const pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.95);

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(dataUrl, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(dataUrl, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save("arogya-doctor-brief.pdf");
      toast.success("Doctor brief PDF downloaded");
    } catch (err) {
      console.error("[copilot] PDF export failed:", err);
      toast.error("Could not generate the PDF — please try again.");
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  const printReport = useCallback(() => {
    window.print();
  }, []);

  /* ---------------------------- render ---------------------------- */

  if (error) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-2xl"
      >
        <p className="font-mono text-[12px] text-muted-foreground">
          <span className="text-primary">$</span> arogya module · doctor-copilot
        </p>
        <div className="glass-card mt-5 rounded-3xl p-8 text-center sm:p-12">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-crit/15 text-crit">
            <AlertCircle className="size-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
            Couldn’t prepare your brief
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {error === "SCHEMA_NOT_APPLIED"
              ? "The database schema isn’t applied yet — run migrations 0001–0002 in the Supabase SQL Editor."
              : "Something went wrong while reading your health data. Your data is safe — try again."}
          </p>
          <Button type="button" className="mt-6 cursor-pointer" onClick={reload}>
            <Loader2 className="size-4" /> Retry
          </Button>
        </div>
      </motion.section>
    );
  }

  if (data === null || analysis === null) {
    return (
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-6xl">
        <PageSkeleton />
      </motion.section>
    );
  }

  if (analysis.reportCount === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-2xl"
      >
        <p className="font-mono text-[12px] text-muted-foreground">
          <span className="text-primary">$</span> arogya module · doctor-copilot
        </p>
        <Empty className="glass-card mt-5 min-h-[420px] rounded-3xl">
          <EmptyMedia className="flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary">
            <Stethoscope className="size-10" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle className="text-xl">Upload your first medical report to generate a Doctor Brief.</EmptyTitle>
            <EmptyDescription>
              ArogyaOS will summarize your health history, compare your latest report against
              your personal baseline, and prepare questions worth asking your doctor — ready
              before your next visit.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" className="cursor-pointer" onClick={() => navigate("/upload")}>
              <UploadCloud className="size-4" /> Upload Report
            </Button>
          </EmptyContent>
        </Empty>
      </motion.section>
    );
  }

  const { latestReport, previousReport } = analysis;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-6xl"
    >
      {/* Printable report (hidden off-screen; used by PDF + print). */}
      <PrintableBrief ref={reportRef} analysis={analysis} brief={brief} />

      {/* Print styles — only the report is visible on paper. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #doctor-brief-print, #doctor-brief-print * { visibility: visible; }
          #doctor-brief-print {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 24px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>

      {/* Header */}
      <p className="font-mono text-[12px] text-muted-foreground">
        <span className="text-primary">$</span> arogya module · doctor-copilot
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Doctor Copilot <Caret className="ml-1.5" />
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">
            Your visit, rehearsed. ArogyaOS summarizes your history, compares your latest
            report against your own baseline, and drafts the questions worth asking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={printReport}
            aria-label="Print the doctor brief"
          >
            <Printer className="size-4" /> Print
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            onClick={downloadPdf}
            disabled={exporting}
            aria-label="Download the doctor brief as PDF"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {exporting ? "Preparing…" : "Download PDF"}
          </Button>
        </div>
      </div>

      {/* Health summary + Ask Doctor Copilot — two columns on desktop, stacked on mobile */}
      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          <Section
            icon={HeartPulse}
            title="Current Health Summary"
            subtitle="Derived from your reports, baselines and AI analyses"
            className="lg:col-span-2"
          >
            <p className="text-[13.5px] leading-6 text-foreground/90">{analysis.currentSummary}</p>
            {brief && brief.overallSummary && (
              <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/6 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="size-3" /> AI summary
                </p>
                <p className="mt-1 text-[13px] leading-6 text-foreground/85">{brief.overallSummary}</p>
              </div>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Health Trend
                </p>
                <div className="mt-1.5">
                  <TrendBadge trend={analysis.healthTrend} />
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Overall Risk
                </p>
                <div className="mt-1.5">
                  <RiskBadge
                    level={brief ? brief.riskLevel : analysis.overallRiskLevel}
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Latest Report
                </p>
                <p className="tnum mt-1.5 truncate font-mono text-[13px] font-semibold text-foreground">
                  {formatDate(latestReport?.reportDate ?? null)}
                </p>
              </div>
            </div>
          </Section>

          <Section
            icon={ListChecks}
            title="Metrics"
            subtitle="Improving vs worsening across your history"
          >
            <div className="space-y-4">
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ok">
                  <TrendingUp className="size-3.5" /> Improving ({analysis.improvingMetrics.length})
                </p>
                {analysis.improvingMetrics.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {analysis.improvingMetrics.map((label) => (
                      <Badge key={label} className="border-ok/40 bg-ok/15 text-ok">
                        {label}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-muted-foreground">None detected.</p>
                )}
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-crit">
                  <TrendingDown className="size-3.5" /> Worsening ({analysis.worseningMetrics.length})
                </p>
                {analysis.worseningMetrics.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {analysis.worseningMetrics.map((label) => (
                      <Badge key={label} className="border-crit/40 bg-crit/15 text-crit">
                        {label}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-muted-foreground">None detected.</p>
                )}
              </div>
              <div className="border-t border-border/50 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tracked ({analysis.metricsTracked.length})
                </p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {analysis.metricsTracked.length > 0
                    ? analysis.metricsTracked.join(" · ")
                    : "No structured metrics yet."}
                </p>
              </div>
            </div>
          </Section>
        </div>

        <DoctorChatPanel
          context={chatContext}
          accessToken={session?.access_token ?? null}
          className="lg:sticky lg:top-6 lg:self-start"
        />
      </div>

      {/* Visit preparation */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Section
          icon={Brain}
          title="Top Observations"
          subtitle="What stands out in your latest report"
        >
          <ListGroup items={analysis.topObservations} empty="No observations yet." />
        </Section>
        <Section
          icon={ClipboardList}
          title="Questions to Ask"
          subtitle="Highest-yield questions for your doctor"
        >
          <ListGroup
            items={
              brief && brief.recommendedQuestions.length > 0
                ? brief.recommendedQuestions
                : analysis.topQuestions
            }
            empty="No questions generated yet."
          />
        </Section>
        <Section
          icon={Activity}
          title="Things to Monitor"
          subtitle="Metrics worth watching until your visit"
        >
          <ListGroup items={analysis.topMonitor} empty="Nothing to monitor." tone="warn" />
        </Section>
        <Section
          icon={FlaskConical}
          title="Suggested Follow-up Tests"
          subtitle="Educational only — always confirm with your doctor"
        >
          <ListGroup
            items={
              brief && brief.followUpTests.length > 0
                ? brief.followUpTests
                : analysis.followUpTests
            }
            empty="No follow-up suggestions yet."
          />
        </Section>
      </div>

      {/* Compare latest report */}
      <div className="mt-5">
        <Section
          icon={Waypoints}
          title="Compare Latest Report"
          subtitle={`${latestReport ? latestReport.title : "Latest report"} vs previous, your baseline and the lab range`}
        >
          {analysis.comparisons.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No structured metrics in the latest report yet — upload a blood or lab report to
              unlock comparisons.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/60">
              <Table aria-label="Latest report comparison">
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead className="text-right">Latest</TableHead>
                    <TableHead className="text-right">Previous</TableHead>
                    <TableHead className="text-right">Your baseline</TableHead>
                    <TableHead className="text-right">Lab range</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.comparisons.map((c) => {
                    const outside = c.outsidePopulation;
                    return (
                      <TableRow key={c.metricName} className={outside ? "bg-crit/6" : undefined}>
                        <TableCell className="font-medium">{c.label}</TableCell>
                        <TableCell className="tnum text-right font-mono">
                          {fmt(c.latestValue)} <span className="text-xs text-muted-foreground">{c.unit ?? ""}</span>
                        </TableCell>
                        <TableCell className="tnum text-right font-mono text-muted-foreground">
                          {fmt(c.previousValue)}
                        </TableCell>
                        <TableCell className="tnum text-right font-mono text-muted-foreground">
                          {fmt(c.personalBaseline)}
                        </TableCell>
                        <TableCell className="tnum text-right font-mono text-muted-foreground">
                          {fmt(c.populationMin)}–{fmt(c.populationMax)}
                        </TableCell>
                        <TableCell className="text-right">
                          <ComparisonDelta changePct={c.changePct} improving={c.improving} />
                        </TableCell>
                        <TableCell className="text-right">
                          {outside ? (
                            <Badge className="border-crit/40 bg-crit/15 text-crit">
                              Outside range
                            </Badge>
                          ) : (
                            <Badge className="border-ok/40 bg-ok/15 text-ok">In range</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            {previousReport
              ? `Compared against your previous report from ${formatDate(previousReport.reportDate)}.`
              : "Only one dated report so far — baselines and lab ranges are still shown."}
            {" "}Arrows reflect the healthy direction for each metric.
          </p>
        </Section>
      </div>

      {/* Timeline snapshot */}
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Section
          icon={CalendarDays}
          title="Recent Reports"
          subtitle="Last five, newest first"
          className="lg:col-span-1"
        >
          {analysis.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dated reports yet.</p>
          ) : (
            <ul className="space-y-2">
              {analysis.timeline.map((report) => (
                <li
                  key={report.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-foreground">
                      {report.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(report.reportDate)}
                    </p>
                  </div>
                  <StatusBadge status={report.processingStatus} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          icon={Waypoints}
          title="Important Milestones"
          subtitle="Moments that shaped your history"
          className="lg:col-span-1"
        >
          <ListGroup items={analysis.milestones} empty="No milestones yet." />
        </Section>

        <Section
          icon={AlertTriangle}
          title="Latest Abnormal Findings"
          subtitle="Values outside the lab reference range"
          className="lg:col-span-1"
        >
          <ListGroup
            items={analysis.abnormalFindings}
            empty="No values outside the lab range in your latest report."
            tone="bad"
          />
        </Section>
      </div>

      {/* AI consultation brief */}
      <div className="mt-5">
        <Section
          icon={Sparkles}
          title="AI Consultation Brief"
          subtitle="A plain-language narrative written for your visit"
        >
          <AnimatePresence mode="wait">
            {briefState === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground"
              >
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="text-sm">Composing your consultation brief…</p>
              </motion.div>
            )}

            {briefState === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border border-warn/40 bg-warn/8 p-4 text-center"
              >
                <Brain className="mx-auto size-5 text-warn" />
                <p className="mt-2 text-sm font-medium text-foreground">AI brief unavailable</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Your visit preparation is still complete below — the AI narrative needs a
                  Gemini API key configured on the server.
                </p>
              </motion.div>
            )}

            {briefState === "done" && brief && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="grid gap-4 lg:grid-cols-2"
              >
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      <HeartPulse className="size-3" /> Health progress
                    </p>
                    <p className="mt-1 text-[13px] leading-6 text-foreground/85">
                      {brief.healthProgress || "No notable progress summary."}
                    </p>
                  </div>
                  {brief.importantChanges.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Important changes
                      </p>
                      <ListGroup items={brief.importantChanges} tone="warn" />
                    </div>
                  )}
                  {brief.doctorDiscussionPoints.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Discussion points
                      </p>
                      <ListGroup items={brief.doctorDiscussionPoints} />
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {brief.recommendedQuestions.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Recommended questions
                      </p>
                      <ListGroup items={brief.recommendedQuestions} />
                    </div>
                  )}
                  {brief.followUpTests.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Follow-up tests
                      </p>
                      <ListGroup items={brief.followUpTests} tone="warn" />
                    </div>
                  )}
                  <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                        <ShieldCheck className="size-3.5 text-ok" /> AI risk assessment
                      </span>
                      <RiskBadge level={brief.riskLevel} />
                    </div>
                    <div
                      className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-background/60"
                      role="progressbar"
                      aria-valuenow={brief.confidence}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="AI brief confidence"
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${brief.confidence}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-right text-[10px] text-muted-foreground">
                      {brief.confidence}% confidence
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>
      </div>

      {/* Export footer */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        className="glass-card mt-5 flex flex-col items-center justify-between gap-4 rounded-3xl p-5 sm:flex-row sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
            <FileText className="size-5" />
          </span>
          <div>
            <p className="text-[14px] font-semibold tracking-tight text-foreground">
              Bring this brief to your visit
            </p>
            <p className="text-[12px] text-muted-foreground">
              A branded PDF with your summary, comparisons, timeline and questions — dated and
              ready to share.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={printReport}
            aria-label="Print the doctor brief"
          >
            <Printer className="size-4" /> Print Report
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            onClick={downloadPdf}
            disabled={exporting}
            aria-label="Download the doctor brief as PDF"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {exporting ? "Preparing…" : "Download PDF"}
          </Button>
        </div>
      </motion.div>

      <p className="mt-4 text-center text-[11px] text-muted-foreground/80">
        Doctor Copilot is educational assistance, not medical advice. Discuss everything with a
        qualified doctor.
      </p>
    </motion.section>
  );
}
