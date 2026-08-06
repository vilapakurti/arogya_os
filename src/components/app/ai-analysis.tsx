import { Caret } from "@/components/landing/terminal-window";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AI_UNAVAILABLE_MESSAGE, type AiInsight, type AiSeverity } from "@/lib/insights";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Brain,
  CloudOff,
  Dumbbell,
  HeartPulse,
  ListChecks,
  MessageCircleQuestion,
  Salad,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const SEVERITY_STYLES: Record<AiSeverity, { badge: string; label: string }> = {
  LOW: { badge: "border-ok/30 bg-ok/15 text-ok", label: "Low" },
  MEDIUM: { badge: "border-warn/30 bg-warn/15 text-warn", label: "Medium" },
  HIGH: { badge: "border-crit/30 bg-crit/15 text-crit", label: "High" },
};

function Card({
  icon,
  title,
  children,
  delay = 0,
  className = "",
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className={`rounded-3xl border border-border/60 bg-background/50 p-5 sm:p-6 ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          {icon}
        </span>
        <h3 className="font-mono text-[14px] font-semibold tracking-tight text-foreground">
          {title}
        </h3>
      </div>
      <div className="mt-4">{children}</div>
    </motion.div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground/70">No specific points to list.</p>;
  }
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="flex items-start gap-2.5 text-[13px] leading-6 text-foreground/90"
        >
          <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary/70" />
          <span>{item}</span>
        </motion.li>
      ))}
    </ul>
  );
}

function StatusChip({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  const styles =
    s === "high"
      ? "border-crit/30 bg-crit/10 text-crit"
      : s === "low"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
        : "border-ok/30 bg-ok/10 text-ok";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles}`}
    >
      {s || "normal"}
    </span>
  );
}

/**
 * AI Analysis section (Feature 3). Renders the full Gemini analysis in themed
 * cards, or the required "AI Analysis currently unavailable." state when the
 * secure AI call failed (OCR + metrics are still saved in that case).
 */
export function AiAnalysisSection({
  insight,
  unavailable,
  model,
}: {
  insight: AiInsight | null;
  unavailable: boolean;
  model?: string | null;
}) {
  if (unavailable || !insight) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-warn/40 bg-warn/8 p-6 sm:p-8"
      >
        <div className="flex items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn">
            <CloudOff className="size-6" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
              {AI_UNAVAILABLE_MESSAGE}
            </h3>
            <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
              Your report, extracted text, and metrics are safely saved — the analysis
              can be retried later from the Reports page.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  const severity = SEVERITY_STYLES[insight.severity];
  const abnormal = insight.abnormalValues ?? [];

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-xl font-semibold tracking-tight text-foreground">
          <Brain className="size-5 text-primary" />
          AI Analysis
          <Caret className="ml-1" />
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {model && (
            <span className="rounded-full border border-border/60 bg-background/60 px-3 py-1 font-mono text-[11px] text-muted-foreground">
              {model}
            </span>
          )}
          <Badge className={`border ${severity.badge}`}>Severity · {severity.label}</Badge>
          <span className="flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-medium text-muted-foreground">
            Confidence
            <span className="font-mono font-semibold text-foreground">
              {insight.confidence}%
            </span>
          </span>
        </div>
      </div>

      <div className="w-48">
        <Progress
          value={insight.confidence}
          className="h-1.5"
          aria-label={`AI confidence ${insight.confidence} percent`}
        />
      </div>

      {/* Health summary */}
      <Card icon={<HeartPulse className="size-4.5" />} title="Health Summary" delay={0.05}>
        <p className="text-[14px] leading-7 text-foreground/90">
          {insight.summary || "No summary was generated for this report."}
        </p>
      </Card>

      {/* Two-column grid of findings */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card
          icon={<ListChecks className="size-4.5" />}
          title="Important Findings"
          delay={0.1}
        >
          <BulletList items={insight.importantObservations} />
        </Card>

        <Card
          icon={<Activity className="size-4.5" />}
          title="Abnormal Values"
          delay={0.14}
        >
          {abnormal.length === 0 ? (
            <p className="text-[13px] text-muted-foreground/70">
              No out-of-range values were flagged.
            </p>
          ) : (
            <ul className="space-y-2">
              {abnormal.map((item, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.3 }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {item.metric}
                    </span>
                    <span className="font-mono text-[12px] text-muted-foreground">
                      {item.value}
                      {item.unit ? ` ${item.unit}` : ""}
                    </span>
                  </span>
                  <StatusChip status={item.status ?? "normal"} />
                </motion.li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          icon={<Sparkles className="size-4.5" />}
          title="Lifestyle Advice"
          delay={0.18}
        >
          <BulletList items={insight.lifestyleRecommendations} />
        </Card>

        <Card icon={<Salad className="size-4.5" />} title="Diet Suggestions" delay={0.22}>
          <BulletList items={insight.dietRecommendations} />
        </Card>

        <Card
          icon={<Dumbbell className="size-4.5" />}
          title="Exercise Suggestions"
          delay={0.26}
        >
          <BulletList items={insight.exerciseRecommendations} />
        </Card>

        <Card
          icon={<MessageCircleQuestion className="size-4.5" />}
          title="Questions for Doctor"
          delay={0.3}
        >
          {insight.doctorQuestions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground/70">
              No suggested questions were generated.
            </p>
          ) : (
            <ol className="space-y-2.5">
              {insight.doctorQuestions.map((q, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.3 }}
                  className="flex items-start gap-2.5 text-[13px] leading-6 text-foreground/90"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 font-mono text-[10px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span>{q}</span>
                </motion.li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* Disclaimer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-start gap-2.5 rounded-2xl border border-border/60 bg-background/40 p-4"
      >
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-[12px] leading-6 text-muted-foreground">
          This analysis is educational information generated by AI — it is not a medical
          diagnosis and does not replace professional care. Always discuss your results
          with a qualified doctor.
        </p>
      </motion.div>

      {/* Severity legend for extra clarity when values are flagged */}
      {abnormal.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.44 }}
          className="flex items-center gap-2 text-[11px] text-muted-foreground/80"
        >
          <AlertTriangle className="size-3.5 text-warn" />
          Flags use the reference ranges from your report; a flagged value is a reason to
          talk to your doctor, not to panic.
        </motion.div>
      )}
    </motion.section>
  );
}
