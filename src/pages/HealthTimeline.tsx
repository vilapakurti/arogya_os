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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchPersonalBaselines,
  type PersonalBaselineRow,
} from "@/lib/baseline-data";
import {
  classifyPersonalClass,
  personalClassLabel,
  sdLevelOf,
  zScoreOf,
} from "@/lib/baselines";
import {
  fetchAllReports,
  fetchMetricHistory,
  fetchMetricsForUser,
  type MetricHistoryPoint,
  type TimelineMetric,
  type TimelineReport,
} from "@/lib/timeline";
import {
  calculateTrend,
  type TrendDirection,
} from "@/lib/trends";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FileText,
  FlaskConical,
  HeartPulse,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Health Journey — timeline & trends.
 *
 * The Health Journey feature renders the full report timeline, metric
 * tracking, trend analysis and report comparison. It reads ONLY via the
 * existing data layer (fetchAllReports / fetchMetricsForUser /
 * fetchMetricHistory / fetchPersonalBaselines) and the pure trend library
 * (calculateTrend) plus the APBE engine (baselines.ts). No new queries, no
 * schema changes.
 *
 * Expanded reports show the personal baseline comparison (APBE) for each
 * metric — the user's own average and a status label derived from the z-score
 * of the reading against their baseline — alongside the population range.
 */

/** Dropdown options mapped to canonical health_metrics names. */
const METRIC_OPTIONS: ReadonlyArray<{ label: string; dbName: string; unit: string }> = [
  { label: "Hemoglobin", dbName: "hemoglobin", unit: "g/dL" },
  { label: "Blood Glucose", dbName: "blood_glucose", unit: "mg/dL" },
  { label: "HbA1c", dbName: "hba1c", unit: "%" },
  { label: "Total Cholesterol", dbName: "cholesterol_total", unit: "mg/dL" },
  { label: "HDL", dbName: "hdl", unit: "mg/dL" },
  { label: "LDL", dbName: "ldl", unit: "mg/dL" },
  { label: "Triglycerides", dbName: "triglycerides", unit: "mg/dL" },
  { label: "Platelets", dbName: "platelets", unit: "10^3/uL" },
  { label: "WBC", dbName: "wbc", unit: "10^3/uL" },
  { label: "RBC", dbName: "rbc", unit: "million/uL" },
  { label: "Creatinine", dbName: "creatinine", unit: "mg/dL" },
  { label: "Urea", dbName: "urea", unit: "mg/dL" },
  { label: "Blood Pressure Systolic", dbName: "blood_pressure_systolic", unit: "mmHg" },
  { label: "Blood Pressure Diastolic", dbName: "blood_pressure_diastolic", unit: "mmHg" },
];

/** Comparison table rows. */
const COMPARE_METRICS: ReadonlyArray<{ label: string; dbName: string; unit: string }> = [
  { label: "Hemoglobin", dbName: "hemoglobin", unit: "g/dL" },
  { label: "Blood Glucose", dbName: "blood_glucose", unit: "mg/dL" },
  { label: "HbA1c", dbName: "hba1c", unit: "%" },
  { label: "Total Cholesterol", dbName: "cholesterol_total", unit: "mg/dL" },
  { label: "HDL", dbName: "hdl", unit: "mg/dL" },
  { label: "LDL", dbName: "ldl", unit: "mg/dL" },
  { label: "Triglycerides", dbName: "triglycerides", unit: "mg/dL" },
  { label: "Blood Pressure", dbName: "blood_pressure_systolic", unit: "mmHg" },
  { label: "Creatinine", dbName: "creatinine", unit: "mg/dL" },
  { label: "Platelets", dbName: "platelets", unit: "10^3/uL" },
];

const REPORT_TYPE_LABELS: Record<string, string> = {
  blood_report: "Blood Report",
  lab_report: "Lab Report",
  prescription: "Prescription",
};

/** Formats an ISO date (YYYY-MM-DD) as a short human label, e.g. "Aug 5, 2026". */
function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Formats an ISO timestamp, e.g. "Aug 5, 2026, 12:17 PM". */
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

/** Rounds to two decimals and strips trailing zeros. */
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function prettyMetricName(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reportTypeLabel(type: string): string {
  return REPORT_TYPE_LABELS[type] ?? prettyMetricName(type);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Compares report dates ascending with nulls last (mirrors timeline.ts). */
function compareReportDate(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  delay = 0,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="glass-card rounded-3xl p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="tnum mt-3 truncate font-mono text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {sub ? <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p> : null}
    </motion.div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "completed") {
    return (
      <Badge className="border-ok/40 bg-ok/15 text-ok">
        <CheckCircle2 /> Completed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="border-crit/40 bg-crit/15 text-crit">
        <AlertCircle /> Failed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Activity /> {status ? prettyMetricName(status) : "Pending"}
    </Badge>
  );
}

function TrendBadge({ direction }: { direction: TrendDirection }) {
  if (direction === "increasing") {
    return (
      <Badge className="border-ok/40 bg-ok/15 text-ok">
        <TrendingUp /> Improving
      </Badge>
    );
  }
  if (direction === "decreasing") {
    return (
      <Badge className="border-crit/40 bg-crit/15 text-crit">
        <TrendingDown /> Worsening
      </Badge>
    );
  }
  return (
    <Badge className="border-warn/40 bg-warn/15 text-warn">
      <Minus /> Stable
    </Badge>
  );
}

/**
 * Personal baseline comparison for one reading: status label + color derived
 * from the reading's z-score against the user's own baseline (APBE).
 */
function PersonalBaselineBadge({
  metric,
  baseline,
}: {
  metric: TimelineMetric;
  baseline: PersonalBaselineRow;
}) {
  const z = zScoreOf(
    metric.metricValue,
    baseline.rollingMean,
    baseline.rollingStd,
  );
  const klass = classifyPersonalClass(z);
  const sd = sdLevelOf(z);
  const label = personalClassLabel(klass);

  let className = "border-ok/40 bg-ok/15 text-ok";
  if (sd >= 2) className = "border-crit/40 bg-crit/15 text-crit";
  else if (sd === 1) className = "border-warn/40 bg-warn/15 text-warn";
  else if (klass !== "within") className = "border-primary/40 bg-primary/10 text-primary";

  return (
    <span className="mt-1 inline-flex items-center gap-1.5">
      <Badge className={`text-[10px] ${className}`}>{label}</Badge>
      {sd >= 1 && (
        <span className="text-[10px] font-semibold text-warn">
          {sd > 1 ? `>${sd} SD` : ">1 SD"}
        </span>
      )}
    </span>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading health journey">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <Skeleton className="h-4 w-96 max-w-full rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-3xl" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-3xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-3xl" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function HealthTimeline() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState<TimelineReport[] | null>(null);
  const [allMetrics, setAllMetrics] = useState<TimelineMetric[] | null>(null);
  const [baselines, setBaselines] = useState<PersonalBaselineRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [selectedMetric, setSelectedMetric] = useState<string>(METRIC_OPTIONS[0].dbName);
  const [metricHistory, setMetricHistory] = useState<MetricHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyCache = useRef(new Map<string, MetricHistoryPoint[]>());
  const historyRequest = useRef(0);

  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /* Primary load — exactly three queries (reports + metrics + baselines). */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError(null);
    setReports(null);
    setAllMetrics(null);
    Promise.all([
      fetchAllReports(user.id),
      fetchMetricsForUser(user.id),
      fetchPersonalBaselines(user.id).catch(() => [] as PersonalBaselineRow[]),
    ])
      .then(([reportRows, metricRows, baselineRows]) => {
        if (cancelled) return;
        setReports(reportRows);
        setAllMetrics(metricRows);
        setBaselines(baselineRows);
        const newestFirst = [...reportRows].sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt),
        );
        if (newestFirst.length >= 2) {
          setCompareA(newestFirst[1].id);
          setCompareB(newestFirst[0].id);
        } else if (newestFirst.length === 1) {
          setCompareA(newestFirst[0].id);
          setCompareB(newestFirst[0].id);
        }
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

  /* Per-metric history — one query per metric, cached to avoid duplicates. */
  useEffect(() => {
    if (!selectedMetric) return;
    const cached = historyCache.current.get(selectedMetric);
    if (cached) {
      setMetricHistory(cached);
      return;
    }
    const requestId = ++historyRequest.current;
    let cancelled = false;
    setHistoryLoading(true);
    fetchMetricHistory(selectedMetric)
      .then((history) => {
        if (cancelled || requestId !== historyRequest.current) return;
        historyCache.current.set(selectedMetric, history);
        setMetricHistory(history);
      })
      .catch(() => {
        if (cancelled || requestId !== historyRequest.current) return;
        setMetricHistory([]);
      })
      .finally(() => {
        if (!cancelled && requestId === historyRequest.current) {
          setHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMetric]);

  /* ---------------------------- derived ---------------------------- */

  const selectedDef = useMemo(
    () => METRIC_OPTIONS.find((option) => option.dbName === selectedMetric) ?? METRIC_OPTIONS[0],
    [selectedMetric],
  );

  const newestFirst = useMemo(
    () =>
      [...(reports ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [reports],
  );

  const metricsByReport = useMemo(() => {
    const map = new Map<string, TimelineMetric[]>();
    for (const metric of allMetrics ?? []) {
      const list = map.get(metric.reportId) ?? [];
      list.push(metric);
      map.set(metric.reportId, list);
    }
    return map;
  }, [allMetrics]);

  const distinctMetricNames = useMemo(() => {
    const names = new Set<string>();
    for (const metric of allMetrics ?? []) names.add(metric.metricName);
    return names;
  }, [allMetrics]);

  /** Baselines keyed by metric name for the expanded-report comparison. */
  const baselinesByMetric = useMemo(() => {
    const map = new Map<string, PersonalBaselineRow>();
    for (const baseline of baselines) map.set(baseline.metricName, baseline);
    return map;
  }, [baselines]);

  const selectedValues = useMemo(
    () =>
      (allMetrics ?? [])
        .filter((metric) => metric.metricName === selectedMetric)
        .map((metric) => metric.metricValue),
    [allMetrics, selectedMetric],
  );

  const stats = useMemo(() => {
    const byName = (name: string) =>
      (allMetrics ?? [])
        .filter((metric) => metric.metricName === name)
        .map((metric) => metric.metricValue);
    const hgb = byName("hemoglobin");
    const glucose = byName("blood_glucose");
    const cholesterol = byName("cholesterol_total");
    return {
      avgHemoglobin: average(hgb),
      avgBloodSugar: average(glucose),
      avgCholesterol: average(cholesterol),
      highestBloodSugar: glucose.length ? Math.max(...glucose) : null,
      lowestHemoglobin: hgb.length ? Math.min(...hgb) : null,
    };
  }, [allMetrics]);

  const latestReport = useMemo(() => newestFirst[0] ?? null, [newestFirst]);

  const selectedUnit = useMemo(() => {
    const fromData = metricHistory.find((point) => point.metricUnit);
    return fromData?.metricUnit ?? selectedDef.unit;
  }, [metricHistory, selectedDef]);

  const trend = useMemo(() => calculateTrend(metricHistory), [metricHistory]);

  const chartData = useMemo(
    () =>
      metricHistory.map((point) => ({
        date: formatDate(point.reportDate).replace(", 2026", ""),
        fullDate: point.reportDate,
        value: point.metricValue,
      })),
    [metricHistory],
  );

  const orderedCompare = useMemo(() => {
    if (!reports || !compareA || !compareB) return null;
    const reportA = reports.find((report) => report.id === compareA);
    const reportB = reports.find((report) => report.id === compareB);
    if (!reportA || !reportB) return null;
    const [older, newer] = [reportA, reportB].sort(
      (a, b) => compareReportDate(a.reportDate, b.reportDate) || a.createdAt.localeCompare(b.createdAt),
    );
    return { older, newer };
  }, [reports, compareA, compareB]);

  const metricValueFor = useCallback(
    (reportId: string, dbName: string): TimelineMetric | undefined =>
      (metricsByReport.get(reportId) ?? []).find((metric) => metric.metricName === dbName),
    [metricsByReport],
  );

  /* ---------------------------- render ----------------------------- */

  if (error) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-2xl"
      >
        <p className="font-mono text-[12px] text-muted-foreground">
          <span className="text-primary">$</span> arogya module · health-journey · timeline
        </p>
        <div className="glass-card mt-5 rounded-3xl p-8 text-center sm:p-12">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-crit/15 text-crit">
            <AlertCircle className="size-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
            Couldn’t load your health journey
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {error === "SCHEMA_NOT_APPLIED"
              ? "The database schema isn’t applied yet — run migrations 0001–0004 in the Supabase SQL Editor."
              : "Something went wrong while reading your reports. Your data is safe — try again."}
          </p>
          <Button type="button" className="mt-6 cursor-pointer" onClick={reload}>
            <Loader2 className="size-4" /> Retry
          </Button>
        </div>
      </motion.section>
    );
  }

  if (reports === null || allMetrics === null) {
    return (
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mx-auto max-w-6xl"
      >
        <PageSkeleton />
      </motion.section>
    );
  }

  if (reports.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-2xl"
      >
        <p className="font-mono text-[12px] text-muted-foreground">
          <span className="text-primary">$</span> arogya module · health-journey · timeline
        </p>
        <Empty className="glass-card mt-5 min-h-[420px] rounded-3xl">
          <EmptyMedia className="flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary">
            <HeartPulse className="size-10" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle className="text-xl">No reports uploaded yet.</EmptyTitle>
            <EmptyDescription>
              Upload your first blood test or lab report and ArogyaOS will chart every
              metric on this timeline — trends, comparisons and all.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              className="cursor-pointer"
              onClick={() => navigate("/upload")}
            >
              <UploadCloud className="size-4" /> Upload First Report
            </Button>
          </EmptyContent>
        </Empty>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-6xl"
    >
      {/* Header */}
      <p className="font-mono text-[12px] text-muted-foreground">
        <span className="text-primary">$</span> arogya module · health-journey · timeline
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Health Journey <Caret className="ml-1.5" />
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">
            Every report, every metric, every trend — a living history of your lab values,
            compared against your own baseline and across reports.
          </p>
        </div>
        <Badge variant="secondary" className="h-7">
          <Activity className="size-3" /> {newestFirst.length} report
          {newestFirst.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {/* Overview cards */}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={FileText}
          label="Total Reports"
          value={String(newestFirst.length)}
          sub={`Last upload ${latestReport ? formatTimestamp(latestReport.createdAt) : "—"}`}
          delay={0}
        />
        <StatCard
          icon={FlaskConical}
          label="Metrics Tracked"
          value={String(distinctMetricNames.size)}
          sub="distinct readings extracted"
          delay={0.05}
        />
        <StatCard
          icon={CalendarClock}
          label="Latest Report"
          value={latestReport ? formatDate(latestReport.reportDate) : "—"}
          sub={latestReport ? latestReport.title : "no reports yet"}
          delay={0.1}
        />
        <StatCard
          icon={TrendingUp}
          label="Average · Selected"
          value={`${formatNumber(average(selectedValues))} ${selectedUnit}`}
          sub={`${selectedDef.label} across ${selectedValues.length} reading${selectedValues.length === 1 ? "" : "s"}`}
          delay={0.15}
        />
      </div>

      {/* Timeline statistics */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FileText} label="Total Reports" value={String(newestFirst.length)} delay={0} />
        <StatCard icon={FlaskConical} label="Metrics Available" value={String(allMetrics?.length ?? 0)} sub="stored readings" delay={0.04} />
        <StatCard icon={CalendarClock} label="Latest Upload" value={latestReport ? formatTimestamp(latestReport.createdAt) : "—"} delay={0.08} />
        <StatCard icon={TrendingUp} label="Avg Hemoglobin" value={`${formatNumber(stats.avgHemoglobin)} g/dL`} delay={0.12} />
        <StatCard icon={TrendingUp} label="Avg Blood Sugar" value={`${formatNumber(stats.avgBloodSugar)} mg/dL`} delay={0.16} />
        <StatCard icon={TrendingUp} label="Avg Cholesterol" value={`${formatNumber(stats.avgCholesterol)} mg/dL`} delay={0.2} />
        <StatCard icon={TrendingUp} label="Highest Blood Sugar" value={`${formatNumber(stats.highestBloodSugar)} mg/dL`} delay={0.24} />
        <StatCard icon={TrendingUp} label="Lowest Hemoglobin" value={`${formatNumber(stats.lowestHemoglobin)} g/dL`} delay={0.28} />
      </div>

      {/* Trend analysis: selector + chart + summary */}
      <div className="glass-card mt-8 rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-base font-semibold tracking-tight text-foreground">
              Trend Analysis
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick a metric — every chart and statistic updates.
            </p>
          </div>
          <Select value={selectedMetric} onValueChange={setSelectedMetric}>
            <SelectTrigger
              aria-label="Select metric to analyze"
              className="w-full min-w-[220px] cursor-pointer sm:w-auto"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRIC_OPTIONS.map((option) => (
                <SelectItem key={option.dbName} value={option.dbName}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-5">
          {/* Chart */}
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
              {historyLoading ? (
                <div className="flex h-[280px] items-center justify-center text-muted-foreground">
                  <Loader2 className="size-5 animate-spin text-primary" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <FlaskConical className="size-6 text-primary/60" />
                  <p className="text-sm">No readings for {selectedDef.label} yet.</p>
                  <p className="text-xs">Upload a report containing this metric to see it charted.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      stroke="var(--border)"
                      minTickGap={28}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      stroke="var(--border)"
                      width={48}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                      formatter={(value) => [
                        `${formatNumber(Number(value))} ${selectedUnit}`,
                        selectedDef.label,
                      ]}
                      labelFormatter={(_label, payload) => {
                        const full = payload?.[0]?.payload?.fullDate as string | undefined;
                        return full ? formatDate(full) : String(_label);
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      name={selectedDef.label}
                      stroke="var(--chart-1)"
                      strokeWidth={2.5}
                      dot={{ r: 3.5, fill: "var(--chart-1)" }}
                      activeDot={{ r: 5.5 }}
                      isAnimationActive
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Trend summary */}
          <div className="lg:col-span-2">
            <div className="flex h-full flex-col rounded-2xl border border-border/60 bg-background/40 p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Trend Summary
                </p>
                <TrendBadge direction={trend.direction} />
              </div>
              <dl className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[13px] text-muted-foreground">Latest Value</dt>
                  <dd className="tnum font-mono text-sm font-semibold text-foreground">
                    {formatNumber(trend.latestValue)} {selectedUnit}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[13px] text-muted-foreground">Previous Value</dt>
                  <dd className="tnum font-mono text-sm font-medium text-foreground">
                    {formatNumber(trend.previousValue)} {selectedUnit}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[13px] text-muted-foreground">Difference</dt>
                  <dd
                    className={`tnum flex items-center gap-1 font-mono text-sm font-semibold ${
                      trend.changeAmount !== null && trend.changeAmount > 0
                        ? "text-ok"
                        : trend.changeAmount !== null && trend.changeAmount < 0
                          ? "text-crit"
                          : "text-foreground"
                    }`}
                  >
                    {trend.changeAmount !== null ? (
                      <>
                        {trend.changeAmount > 0 ? (
                          <ArrowUpRight className="size-3.5" />
                        ) : trend.changeAmount < 0 ? (
                          <ArrowDownRight className="size-3.5" />
                        ) : (
                          <ArrowRight className="size-3.5" />
                        )}
                        {formatNumber(Math.abs(trend.changeAmount))} {selectedUnit}
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[13px] text-muted-foreground">Percentage Change</dt>
                  <dd className="tnum font-mono text-sm font-medium text-foreground">
                    {trend.percentageChange === null
                      ? "—"
                      : `${trend.percentageChange > 0 ? "+" : ""}${formatNumber(trend.percentageChange)}%`}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[13px] text-muted-foreground">Sample Size</dt>
                  <dd className="tnum font-mono text-sm font-medium text-foreground">
                    {trend.sampleSize} reading{trend.sampleSize === 1 ? "" : "s"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>

      {/* Report timeline */}
      <div className="mt-8">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-base font-semibold tracking-tight text-foreground">
            Report Timeline
          </h2>
          <Badge variant="secondary">{newestFirst.length}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Newest first — click a report to expand its extracted metrics and personal baseline comparison.
        </p>

        <div className="mt-4 space-y-3">
          {newestFirst.map((report, index) => {
            const reportMetrics = metricsByReport.get(report.id) ?? [];
            const expanded = expandedReportId === report.id;
            return (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.05, 0.3) }}
                className="glass-card overflow-hidden rounded-3xl"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`report-metrics-${report.id}`}
                  onClick={() => setExpandedReportId(expanded ? null : report.id)}
                  className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/30 sm:px-6"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FileText className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                        {report.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {reportTypeLabel(report.type)} · {formatDate(report.reportDate)} ·{" "}
                        uploaded {formatTimestamp(report.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <Badge variant="secondary">
                      <FlaskConical className="size-3" /> {reportMetrics.length} metric
                      {reportMetrics.length === 1 ? "" : "s"}
                    </Badge>
                    <StatusBadge status={report.processingStatus} />
                    <ChevronDown
                      className={`size-4 text-muted-foreground transition-transform duration-200 ${
                        expanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      key="content"
                      id={`report-metrics-${report.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border/60 px-5 py-4 sm:px-6">
                        {reportMetrics.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No metrics were extracted from this report.
                          </p>
                        ) : (
                          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {reportMetrics.map((metric) => {
                              const hasRange =
                                metric.populationMin !== null || metric.populationMax !== null;
                              const baseline = baselinesByMetric.get(metric.metricName);
                              return (
                                <li
                                  key={metric.id}
                                  className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/40 px-4 py-3"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-[13px] font-medium text-foreground">
                                      {prettyMetricName(metric.metricName)}
                                    </p>
                                    {/* Population reference range (from the report). */}
                                    {hasRange && (
                                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        population{" "}
                                        {metric.populationMin === null
                                          ? "—"
                                          : formatNumber(metric.populationMin)}
                                        {" – "}
                                        {metric.populationMax === null
                                          ? "—"
                                          : formatNumber(metric.populationMax)}{" "}
                                        {metric.metricUnit ?? ""}
                                      </p>
                                    )}
                                    {/* Personal baseline comparison (APBE). */}
                                    {baseline ? (
                                      <>
                                        <p className="mt-0.5 text-[11px] text-primary">
                                          your average{" "}
                                          {formatNumber(baseline.rollingMean)}{" "}
                                          {metric.metricUnit ?? ""}
                                        </p>
                                        <PersonalBaselineBadge metric={metric} baseline={baseline} />
                                      </>
                                    ) : null}
                                  </div>
                                  <p className="tnum shrink-0 font-mono text-sm font-semibold text-primary">
                                    {formatNumber(metric.metricValue)}{" "}
                                    <span className="text-xs font-normal text-muted-foreground">
                                      {metric.metricUnit ?? ""}
                                    </span>
                                  </p>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Report comparison */}
      <div className="glass-card mt-8 rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-base font-semibold tracking-tight text-foreground">
              Report Comparison
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose two reports — the older is shown as the baseline.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Select value={compareA ?? undefined} onValueChange={setCompareA}>
            <SelectTrigger
              aria-label="Select first report to compare"
              className="w-full cursor-pointer"
            >
              <SelectValue placeholder="Select report A" />
            </SelectTrigger>
            <SelectContent>
              {newestFirst.map((report) => (
                <SelectItem key={report.id} value={report.id}>
                  {report.title} — {formatDate(report.reportDate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={compareB ?? undefined} onValueChange={setCompareB}>
            <SelectTrigger
              aria-label="Select second report to compare"
              className="w-full cursor-pointer"
            >
              <SelectValue placeholder="Select report B" />
            </SelectTrigger>
            <SelectContent>
              {newestFirst.map((report) => (
                <SelectItem key={report.id} value={report.id}>
                  {report.title} — {formatDate(report.reportDate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {orderedCompare ? (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-border/60">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <caption className="sr-only">
                Comparison of {orderedCompare.older.title} and {orderedCompare.newer.title}
              </caption>
              <thead>
                <tr className="border-b border-border/60 bg-background/40 text-left">
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Metric
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Old Value
                  </th>
                  <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Δ
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    New Value
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_METRICS.map((def) => {
                  const oldMetric = metricValueFor(orderedCompare.older.id, def.dbName);
                  const newMetric = metricValueFor(orderedCompare.newer.id, def.dbName);
                  const oldValue = oldMetric?.metricValue ?? null;
                  const newValue = newMetric?.metricValue ?? null;
                  const diff =
                    oldValue !== null && newValue !== null ? newValue - oldValue : null;
                  const changed = diff !== null && diff !== 0;
                  const unit = newMetric?.metricUnit ?? oldMetric?.metricUnit ?? def.unit;
                  return (
                    <tr
                      key={def.dbName}
                      className={`border-b border-border/40 last:border-b-0 ${
                        changed ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{def.label}</td>
                      <td className="tnum px-4 py-3 font-mono text-muted-foreground">
                        {oldValue === null ? "—" : formatNumber(oldValue)}
                        {oldValue !== null ? ` ${unit}` : ""}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {diff === null ? (
                          <span className="text-muted-foreground/50">·</span>
                        ) : diff > 0 ? (
                          <ArrowUpRight className="inline size-4 text-ok" />
                        ) : diff < 0 ? (
                          <ArrowDownRight className="inline size-4 text-crit" />
                        ) : (
                          <ArrowRight className="inline size-4 text-muted-foreground" />
                        )}
                      </td>
                      <td className="tnum px-4 py-3 font-mono font-semibold text-foreground">
                        {newValue === null ? "—" : formatNumber(newValue)}
                        {newValue !== null ? ` ${unit}` : ""}
                      </td>
                      <td
                        className={`tnum px-4 py-3 font-mono ${
                          changed
                            ? diff !== null && diff > 0
                              ? "text-ok"
                              : "text-crit"
                            : "text-muted-foreground"
                        }`}
                      >
                        {diff === null
                          ? "—"
                          : `${diff > 0 ? "+" : ""}${formatNumber(diff)} ${unit}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">Select two reports to compare.</p>
        )}
      </div>
    </motion.section>
  );
}
