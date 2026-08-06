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
  groupMetricsByMetricName,
  type PersonalBaselineRow,
} from "@/lib/baseline-data";
import {
  emaSeries,
  computeBaseline,
  personalClassLabel,
  type BaselineStats,
  type RiskTone,
} from "@/lib/baselines";
import { generateBaselineBrief, type BaselineAiBrief } from "@/lib/baseline-ai";
import {
  fetchAllReports,
  fetchMetricsForUser,
  type MetricHistoryPoint,
  type TimelineMetric,
  type TimelineReport,
} from "@/lib/timeline";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  FlaskConical,
  HeartPulse,
  LineChart as LineChartIcon,
  Loader2,
  Minus,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Health Baseline — Adaptive Personal Baseline Engine dashboard.
 *
 * Compares every metric against the user's OWN historical health (personal
 * average, EMA, z-score, five-way classification) instead of only population
 * ranges. Reads ONLY via the existing data layer (fetchAllReports /
 * fetchMetricsForUser / fetchPersonalBaselines) and the pure APBE engine
 * (baselines.ts) + the secure Gemini enhancement action (baseline-ai.ts).
 */

/** Supported metrics, in display order, with canonical DB names + units. */
const METRIC_DEFS: ReadonlyArray<{ label: string; dbName: string; unit: string }> = [
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

/** Formats an ISO date as a short human label. */
function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Formats an ISO timestamp. */
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

/** Rounds to two decimals. */
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

/** Converts a TimelineMetric to the engine's MetricHistoryPoint shape. */
function toHistoryPoint(metric: TimelineMetric): MetricHistoryPoint {
  return {
    reportId: metric.reportId,
    reportDate: metric.reportDate,
    metricName: metric.metricName,
    metricValue: metric.metricValue,
    metricUnit: metric.metricUnit,
    populationMin: metric.populationMin,
    populationMax: metric.populationMax,
    measurementDate: metric.measurementDate,
  };
}

/* ------------------------------------------------------------------ */
/* Risk tone badge                                                      */
/* ------------------------------------------------------------------ */

const RISK_TONE_STYLES: Record<RiskTone, string> = {
  green: "border-ok/40 bg-ok/15 text-ok",
  blue: "border-chart-3/50 bg-chart-3/15 text-chart-3",
  amber: "border-warn/40 bg-warn/15 text-warn",
  orange: "border-[var(--chart-4)]/40 bg-[var(--chart-4)]/15 text-[var(--chart-4)]",
  red: "border-crit/40 bg-crit/15 text-crit",
};

const RISK_TONE_LABELS: Record<RiskTone, string> = {
  green: "Within baseline",
  blue: "Improving",
  amber: "Slight deviation",
  orange: "Moderate deviation",
  red: "Significant deviation",
};

function RiskBadge({ tone }: { tone: RiskTone }) {
  const Icon =
    tone === "red" ? AlertCircle : tone === "orange" || tone === "amber" ? Activity : ShieldCheck;
  return (
    <Badge className={`${RISK_TONE_STYLES[tone]}`}>
      <Icon className="size-3" /> {RISK_TONE_LABELS[tone]}
    </Badge>
  );
}

function TrendArrow({ stats }: { stats: BaselineStats }) {
  if (stats.direction === "increasing") {
    return <ArrowUpRight className="size-4 text-ok" aria-label="Increasing" />;
  }
  if (stats.direction === "decreasing") {
    return <ArrowDownRight className="size-4 text-crit" aria-label="Decreasing" />;
  }
  return <ArrowRight className="size-4 text-muted-foreground" aria-label="Stable" />;
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

function MetricCard({
  stats,
  label,
  selected,
  onSelect,
  delay = 0,
}: {
  stats: BaselineStats;
  label: string;
  selected: boolean;
  onSelect: () => void;
  delay?: number;
}) {
  const unit = stats.unit ?? "";
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      onClick={onSelect}
      aria-pressed={selected}
      className={`glass-card w-full cursor-pointer rounded-3xl p-5 text-left transition-all ${
        selected ? "ring-1 ring-primary/50" : "hover:bg-accent/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-semibold tracking-tight text-foreground">
          {label}
        </p>
        <RiskBadge tone={stats.riskTone} />
      </div>

      <p className="tnum mt-3 font-mono text-2xl font-semibold tracking-tight text-foreground">
        {formatNumber(stats.latestValue)}{" "}
        <span className="text-xs font-normal text-muted-foreground">{unit}</span>
      </p>

      <dl className="mt-3 space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Personal avg</dt>
          <dd className="tnum font-mono font-medium text-foreground">
            {formatNumber(stats.rollingMean)} {unit}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Z-score</dt>
          <dd className="tnum font-mono font-medium text-foreground">
            {stats.latestZScore === null ? "—" : formatNumber(stats.latestZScore)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Δ vs avg</dt>
          <dd
            className={`tnum flex items-center gap-1 font-mono font-medium ${
              stats.latestDifference !== null && stats.latestDifference > 0
                ? "text-ok"
                : stats.latestDifference !== null && stats.latestDifference < 0
                  ? "text-crit"
                  : "text-foreground"
            }`}
          >
            <TrendArrow stats={stats} />
            {stats.latestDifference === null
              ? "—"
              : `${stats.latestDifference > 0 ? "+" : ""}${formatNumber(stats.latestDifference)} ${unit}`}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {stats.sampleCount} reading{stats.sampleCount === 1 ? "" : "s"}
          {stats.lastUpdatedDate ? ` · ${formatDate(stats.lastUpdatedDate)}` : ""}
        </span>
        {stats.sdLevel >= 1 && (
          <span className="text-[10px] font-semibold text-warn">
            &gt;{stats.sdLevel} SD
          </span>
        )}
      </div>
    </motion.button>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading health baseline">
      <Skeleton className="h-8 w-72 rounded-xl" />
      <Skeleton className="h-4 w-96 max-w-full rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-3xl" />
      <Skeleton className="h-44 rounded-3xl" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function HealthBaseline() {
  const { user, session } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState<TimelineReport[] | null>(null);
  const [allMetrics, setAllMetrics] = useState<TimelineMetric[] | null>(null);
  const [baselineRows, setBaselineRows] = useState<PersonalBaselineRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [selectedMetric, setSelectedMetric] = useState<string>(METRIC_DEFS[0].dbName);
  const [brief, setBrief] = useState<BaselineAiBrief | null>(null);
  const [briefState, setBriefState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const briefRequested = useRef(false);

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
        setBaselineRows(baselineRows);
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

  /* ---------------------------- derived ---------------------------- */

  const grouped = useMemo(
    () => groupMetricsByMetricName(allMetrics ?? []),
    [allMetrics],
  );

  /** Full APBE statistics per metric, computed deterministically. */
  const statsByMetric = useMemo(() => {
    const map = new Map<string, BaselineStats>();
    for (const [metricName, history] of grouped) {
      const points = history.map(toHistoryPoint);
      const unit = history[0]?.metricUnit ?? null;
      map.set(metricName, computeBaseline(points, metricName, unit));
    }
    return map;
  }, [grouped]);

  const selectedDef = useMemo(
    () => METRIC_DEFS.find((def) => def.dbName === selectedMetric) ?? METRIC_DEFS[0],
    [selectedMetric],
  );

  const selectedStats = statsByMetric.get(selectedMetric) ?? null;

  /** Population reference range for the selected metric (latest known). */
  const selectedPopulation = useMemo(() => {
    const history = grouped.get(selectedMetric) ?? [];
    const last = history[history.length - 1];
    if (!last) return { min: null, max: null };
    return { min: last.populationMin, max: last.populationMax };
  }, [grouped, selectedMetric]);

  /** Chart series: values, rolling average, EMA — all chronological. */
  const chartData = useMemo(() => {
    const history = grouped.get(selectedMetric) ?? [];
    const points = history.map(toHistoryPoint);
    const values = points
      .filter((p) => Number.isFinite(p.metricValue))
      .map((p) => p.metricValue);
    const ema = emaSeries(values);
    let runningSum = 0;
    return values.map((value, i) => {
      runningSum += value;
      return {
        date: formatDate(points[i]?.reportDate ?? null).replace(", 2026", ""),
        fullDate: points[i]?.reportDate ?? null,
        value,
        rolling: runningSum / (i + 1),
        ema: ema[i] ?? null,
      };
    });
  }, [grouped, selectedMetric]);

  const sortedDefs = useMemo(() => {
    const present = new Set(statsByMetric.keys());
    return METRIC_DEFS.filter((def) => present.has(def.dbName));
  }, [statsByMetric]);

  const totalBaselines = baselineRows.length;

  /* AI enhancement — one call, only when enough data and signed in. */
  useEffect(() => {
    if (
      !user ||
      !session?.access_token ||
      briefRequested.current ||
      briefState === "loading" ||
      briefState === "done"
    ) {
      return;
    }
    if (statsByMetric.size === 0) return;
    briefRequested.current = true;
    setBriefState("loading");

    const input = sortedDefs.slice(0, 10).map((def) => {
      const stats = statsByMetric.get(def.dbName);
      const values = (grouped.get(def.dbName) ?? [])
        .map((m) => m.metricValue)
        .filter((v) => Number.isFinite(v))
        .slice(-20);
      return {
        metricName: def.dbName,
        label: def.label,
        unit: def.unit,
        values,
        rollingMean: stats?.rollingMean ?? null,
        stdDev: stats?.stdDev ?? null,
        latestZScore: stats?.latestZScore ?? null,
        latestValue: stats?.latestValue ?? null,
        percentageDifference: stats?.percentageDifference ?? null,
        direction: stats?.direction ?? "stable",
        personalStatus: stats ? personalClassLabel(stats.personalClass) : "unknown",
      };
    });

    generateBaselineBrief(session.access_token, input)
      .then((outcome) => {
        if (outcome.ok) {
          setBrief(outcome.brief);
          setBriefState("done");
        } else {
          console.warn(`[baseline] AI enhancement unavailable (${outcome.code}): ${outcome.message}`);
          setBriefState("error");
        }
      })
      .catch(() => {
        setBriefState("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, session, statsByMetric, sortedDefs, grouped]);

  /* ---------------------------- render ----------------------------- */

  if (error) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-2xl"
      >
        <p className="font-mono text-[12px] text-muted-foreground">
          <span className="text-primary">$</span> arogya module · health-baseline
        </p>
        <div className="glass-card mt-5 rounded-3xl p-8 text-center sm:p-12">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-crit/15 text-crit">
            <AlertCircle className="size-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
            Couldn’t load your baseline
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

  if (reports === null || allMetrics === null) {
    return (
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-6xl">
        <PageSkeleton />
      </motion.section>
    );
  }

  if (reports.length < 3) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-2xl"
      >
        <p className="font-mono text-[12px] text-muted-foreground">
          <span className="text-primary">$</span> arogya module · health-baseline
        </p>
        <Empty className="glass-card mt-5 min-h-[420px] rounded-3xl">
          <EmptyMedia className="flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary">
            <Waves className="size-10" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle className="text-xl">
              Upload at least three reports to build your personal baseline.
            </EmptyTitle>
            <EmptyDescription>
              ArogyaOS learns YOUR normal from your own history — your personal average,
              standard deviation and z-score replace generic population ranges. You've
              uploaded {reports.length} report{reports.length === 1 ? "" : "s"} so far.
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

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-6xl"
    >
      {/* Header */}
      <p className="font-mono text-[12px] text-muted-foreground">
        <span className="text-primary">$</span> arogya module · health-baseline
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Health Baseline <Caret className="ml-1.5" />
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">
            Your own normal, not the textbook's. Every metric is scored against your
            personal average, EMA and standard deviation — built automatically from each
            processed report.
          </p>
        </div>
        <Badge variant="secondary" className="h-7">
          <ShieldCheck className="size-3" /> {totalBaselines} personal baselines
        </Badge>
      </div>

      {/* Summary strip */}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="glass-card rounded-3xl p-5"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Metrics With Baseline
          </p>
          <p className="tnum mt-3 font-mono text-2xl font-semibold tracking-tight text-foreground">
            {statsByMetric.size}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">of {METRIC_DEFS.length} supported</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="glass-card rounded-3xl p-5"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Reports Analyzed
          </p>
          <p className="tnum mt-3 font-mono text-2xl font-semibold tracking-tight text-foreground">
            {reports.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">across your history</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="glass-card rounded-3xl p-5"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Within Your Normal
          </p>
          <p className="tnum mt-3 font-mono text-2xl font-semibold tracking-tight text-foreground">
            {[...statsByMetric.values()].filter((s) => s.riskTone === "green" || s.riskTone === "blue")
              .length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            of {statsByMetric.size} metrics
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
          className="glass-card rounded-3xl p-5"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Needs Attention
          </p>
          <p className="tnum mt-3 font-mono text-2xl font-semibold tracking-tight text-foreground">
            {[...statsByMetric.values()].filter((s) => s.sdLevel >= 1).length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">&gt;1 SD from your normal</p>
        </motion.div>
      </div>

      {/* Metric cards */}
      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-base font-semibold tracking-tight text-foreground">
              Personal Baselines
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Select a card to chart its history against your baseline.
            </p>
          </div>
          {/* Risk legend */}
          <div className="flex flex-wrap items-center gap-2" aria-label="Risk indicator legend">
            {(["green", "blue", "amber", "orange", "red"] as RiskTone[]).map((tone) => (
              <span key={tone} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className={`size-2 rounded-full ${RISK_TONE_STYLES[tone].split(" ")[0].replace("border-", "bg-")}`} />
                {RISK_TONE_LABELS[tone]}
              </span>
            ))}
          </div>
        </div>

        {sortedDefs.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No metrics extracted yet — upload reports containing lab values.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedDefs.map((def, index) => {
              const stats = statsByMetric.get(def.dbName);
              if (!stats) return null;
              return (
                <MetricCard
                  key={def.dbName}
                  stats={stats}
                  label={def.label}
                  selected={selectedMetric === def.dbName}
                  onSelect={() => setSelectedMetric(def.dbName)}
                  delay={Math.min(index * 0.04, 0.3)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Chart + AI briefing */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {/* Chart */}
        <div className="glass-card rounded-3xl p-5 sm:p-6 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-mono text-base font-semibold tracking-tight text-foreground">
                <LineChartIcon className="size-4 text-primary" /> Personal Trend
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Historical values, rolling average, EMA and your baseline.
              </p>
            </div>
            <Select value={selectedMetric} onValueChange={setSelectedMetric}>
              <SelectTrigger
                aria-label="Select metric to chart"
                className="w-full min-w-[220px] cursor-pointer sm:w-auto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortedDefs.map((def) => (
                  <SelectItem key={def.dbName} value={def.dbName}>
                    {def.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-5 rounded-2xl border border-border/60 bg-background/40 p-3">
            {chartData.length === 0 ? (
              <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <FlaskConical className="size-6 text-primary/60" />
                <p className="text-sm">No readings for {selectedDef.label} yet.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
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
                    width={52}
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
                    formatter={(value, name) => [`${formatNumber(Number(value))} ${selectedDef.unit}`, String(name)]}
                    labelFormatter={(_label, payload) => {
                      const full = payload?.[0]?.payload?.fullDate as string | undefined;
                      return full ? formatDate(full) : String(_label);
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />

                  {/* Population reference range from the report. */}
                  {selectedPopulation.min !== null && selectedPopulation.max !== null && (
                    <ReferenceArea
                      y1={selectedPopulation.min}
                      y2={selectedPopulation.max}
                      fill="var(--chart-3)"
                      fillOpacity={0.08}
                      stroke="var(--chart-3)"
                      strokeOpacity={0.25}
                      strokeDasharray="4 4"
                      label={{ value: "population range", position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                  )}
                  {/* Personal baseline (rolling mean). */}
                  {selectedStats?.rollingMean !== null && selectedStats?.rollingMean !== undefined && (
                    <ReferenceLine
                      y={selectedStats.rollingMean}
                      stroke="var(--chart-2)"
                      strokeDasharray="6 4"
                      label={{ value: "your baseline", position: "insideBottomRight", fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                  )}
                  {/* Latest reading marker. */}
                  {selectedStats?.latestValue !== null && selectedStats?.latestValue !== undefined && (
                    <ReferenceLine
                      y={selectedStats.latestValue}
                      stroke="var(--chart-4)"
                      strokeDasharray="2 4"
                      label={{ value: "latest", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                  )}

                  <Line
                    type="monotone"
                    dataKey="value"
                    name="Values"
                    stroke="var(--chart-1)"
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: "var(--chart-1)" }}
                    activeDot={{ r: 5.5 }}
                    isAnimationActive
                  />
                  <Line
                    type="monotone"
                    dataKey="rolling"
                    name="Rolling average"
                    stroke="var(--chart-2)"
                    strokeWidth={1.8}
                    strokeDasharray="5 3"
                    dot={false}
                    isAnimationActive
                  />
                  <Line
                    type="monotone"
                    dataKey="ema"
                    name="EMA"
                    stroke="var(--chart-3)"
                    strokeWidth={1.6}
                    dot={false}
                    isAnimationActive
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Selected metric detail strip */}
          {selectedStats && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Current", value: `${formatNumber(selectedStats.latestValue)} ${selectedDef.unit}` },
                { label: "Personal avg", value: `${formatNumber(selectedStats.rollingMean)} ${selectedDef.unit}` },
                { label: "Population", value: `${formatNumber(selectedPopulation.min)} – ${formatNumber(selectedPopulation.max)}` },
                { label: "Sample size", value: `${selectedStats.sampleCount}` },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-border/60 bg-background/40 px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="tnum mt-1 truncate font-mono text-sm font-semibold text-foreground">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI briefing */}
        <div className="glass-card rounded-3xl p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-mono text-base font-semibold tracking-tight text-foreground">
            <Sparkles className="size-4 text-primary" /> AI Briefing
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A plain-language read of your personal baseline trends.
          </p>

          <AnimatePresence mode="wait">
            {briefState === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-6 flex flex-col items-center gap-3 py-10 text-center text-muted-foreground"
              >
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="text-sm">Reading your baselines…</p>
              </motion.div>
            )}

            {briefState === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-6 rounded-2xl border border-warn/40 bg-warn/8 p-4 text-center"
              >
                <Brain className="mx-auto size-5 text-warn" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  AI briefing unavailable
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Your baselines are still computed locally — the AI summary needs a
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
                className="mt-5 space-y-4"
              >
                <p className="text-sm leading-6 text-foreground/90">{brief.overallTrend}</p>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-ok/30 bg-ok/8 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ok">
                      <TrendingUp className="size-3" /> Improving
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {brief.improvingMetrics.length === 0 ? (
                        <li className="text-[11px] text-muted-foreground">None detected</li>
                      ) : (
                        brief.improvingMetrics.map((m) => (
                          <li key={m} className="text-[11px] text-muted-foreground">{m}</li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-crit/30 bg-crit/8 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-crit">
                      <TrendingDown className="size-3" /> Declining
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {brief.decliningMetrics.length === 0 ? (
                        <li className="text-[11px] text-muted-foreground">None detected</li>
                      ) : (
                        brief.decliningMetrics.map((m) => (
                          <li key={m} className="text-[11px] text-muted-foreground">{m}</li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>

                {brief.importantChanges.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Important changes
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {brief.importantChanges.map((change) => (
                        <li key={change} className="flex items-start gap-1.5 text-[12px] leading-5 text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-primary" />
                          {change}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {brief.recommendedActions.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Recommended actions
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {brief.recommendedActions.map((action) => (
                        <li key={action} className="flex items-start gap-1.5 text-[12px] leading-5 text-muted-foreground">
                          <Activity className="mt-0.5 size-3 shrink-0 text-primary" />
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {brief.monitoringAdvice.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Monitoring advice
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {brief.monitoringAdvice.map((advice) => (
                        <li key={advice} className="flex items-start gap-1.5 text-[12px] leading-5 text-muted-foreground">
                          <HeartPulse className="mt-0.5 size-3 shrink-0 text-primary" />
                          {advice}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="border-t border-border/50 pt-3">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Confidence</span>
                    <span className="tnum font-mono font-semibold text-foreground">
                      {brief.confidence}%
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background/60"
                    role="progressbar"
                    aria-valuenow={brief.confidence}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="AI briefing confidence"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${brief.confidence}%` }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
}
