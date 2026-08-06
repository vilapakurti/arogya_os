import { Caret, PromptLine, TerminalWindow } from "@/components/landing/terminal-window";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  FileHeart,
  Pill,
  Receipt,
  Stethoscope,
} from "lucide-react";
import { Link } from "react-router";

const MODULES = [
  { icon: FileHeart, name: "records-core", latency: "12ms", ok: true },
  { icon: CalendarClock, name: "scheduling", latency: "18ms", ok: true },
  { icon: Receipt, name: "billing-engine", latency: "9ms", ok: true },
  { icon: Pill, name: "pharmacy-dispense", latency: "22ms", ok: true },
  { icon: Activity, name: "analytics", latency: "31ms", ok: true },
  { icon: Stethoscope, name: "telehealth", latency: "14ms", ok: false },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.55, ease: "easeOut" as const },
  }),
};

export function Hero() {
  const { isAuthenticated } = useAuth();

  return (
    <section className="relative overflow-hidden">
      <div className="terminal-grid grid-fade pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/30 to-transparent" />

      <div className="relative mx-auto grid max-w-6xl gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-10 lg:pt-24">
        {/* copy */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.p
            variants={fadeUp}
            custom={0}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 font-mono text-[11px] text-muted-foreground"
          >
            <span className="size-1.5 rounded-full bg-ok" />
            $ arogya --version&nbsp;<span className="text-foreground">v0.1.0-beta</span>
          </motion.p>

          <motion.h1
            variants={fadeUp}
            custom={1}
            className="mt-6 font-mono text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[3.4rem]"
          >
            The operating system
            <br />
            for modern healthcare<span className="text-primary">.</span>
            <Caret className="ml-1.5" />
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={2}
            className="mt-6 max-w-lg text-[15px] leading-7 text-muted-foreground sm:text-base"
          >
            ArogyaOS unifies patient records, scheduling, billing, and
            analytics into one deterministic platform — engineered for the
            teams that run hospitals, clinics, and care networks.
          </motion.p>

          <motion.div
            variants={fadeUp}
            custom={3}
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Button
              asChild
              size="lg"
              className="gap-2 font-mono text-sm"
            >
              <Link to="/dashboard">
                {isAuthenticated ? "open console" : "launch console"}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="font-mono text-sm"
            >
              <a href="#modules">$ ls ./modules</a>
            </Button>
          </motion.div>

          <motion.div
            variants={fadeUp}
            custom={4}
            className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] text-muted-foreground"
          >
            {["HIPAA-ready", "SOC 2 Type II", "FHIR R4 native", "99.99% uptime"].map(
              (item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <span className="text-ok">✓</span> {item}
                </span>
              ),
            )}
          </motion.div>
        </motion.div>

        {/* terminal mock */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6, ease: "easeOut" }}
          className="relative"
        >
          <TerminalWindow
            title="arogyaos@st-marys: ~/console"
            badge="live"
            className="shadow-[0_1px_0_rgba(0,0,0,0.04)]"
            bodyClassName="p-5"
          >
            <PromptLine command="arogya os status --all" />
            <div className="mt-4 space-y-2.5">
              {MODULES.map((m, i) => (
                <motion.div
                  key={m.name}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.09, duration: 0.35 }}
                  className="flex items-center gap-3 rounded-md border border-border/70 bg-background/60 px-3 py-2"
                >
                  <m.icon
                    className={
                      m.ok ? "size-4 text-ok" : "size-4 text-warn"
                    }
                  />
                  <span className="flex-1 truncate text-[13px] text-foreground/90">
                    {m.name}
                  </span>
                  <span
                    className={
                      m.ok
                        ? "font-mono text-[11px] uppercase tracking-wider text-ok"
                        : "font-mono text-[11px] uppercase tracking-wider text-warn"
                    }
                  >
                    {m.ok ? "online" : "beta"}
                  </span>
                  <span className="tnum hidden font-mono text-[11px] text-muted-foreground sm:inline">
                    {m.latency}
                  </span>
                </motion.div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  bed utilization
                </p>
                <p className="tnum mt-1 font-mono text-lg font-semibold text-foreground">
                  82%<span className="text-[11px] font-normal text-muted-foreground"> ██████████░░</span>
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  queue · floor 3
                </p>
                <p className="tnum mt-1 font-mono text-lg font-semibold text-foreground">
                  12<span className="text-[11px] font-normal text-muted-foreground"> avg wait 8m</span>
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
              <p>
                <span className="text-ok">[OK]</span> fhir sync complete ·
                1,284 records
              </p>
              <p className="mt-1">
                <span className="text-warn">[WARN]</span> telehealth cert
                renewal in 14 days
              </p>
            </div>
            <PromptLine command="watch --interval 30 care-flow" className="mt-3" />
            <Caret />
          </TerminalWindow>

          {/* floating chips */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.9, duration: 0.4 }}
            className="absolute -left-3 top-16 hidden rounded-md border border-border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground shadow-sm lg:block"
          >
            <span className="text-ok">▲</span> 99.99% uptime
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.05, duration: 0.4 }}
            className="absolute -right-2 bottom-20 hidden rounded-md border border-border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground shadow-sm lg:block"
          >
            <span className="text-warn">●</span> 12 beds free
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
