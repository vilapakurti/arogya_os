import { SectionHeading } from "@/components/landing/section-heading";
import { motion } from "framer-motion";
import {
  BarChart3,
  CalendarClock,
  FileHeart,
  Network,
  Receipt,
  Workflow,
} from "lucide-react";

const FEATURES = [
  {
    icon: FileHeart,
    index: "01",
    title: "unified records",
    body: "A single longitudinal patient record across every department — admission to discharge, lab to pharmacy.",
    tag: "online",
    ok: true,
  },
  {
    icon: CalendarClock,
    index: "02",
    title: "intelligent scheduling",
    body: "Chair, room, and staff capacity modeled in real time. No double-booking, ever.",
    tag: "online",
    ok: true,
  },
  {
    icon: Receipt,
    index: "03",
    title: "revenue cycle",
    body: "Claims, eligibility, and remittance in one pipeline. Denials surfaced before they cost you.",
    tag: "beta",
    ok: false,
  },
  {
    icon: Workflow,
    index: "04",
    title: "care workflows",
    body: "Order sets, handoffs, and discharge paths as versioned, auditable state machines.",
    tag: "online",
    ok: true,
  },
  {
    icon: BarChart3,
    index: "05",
    title: "population analytics",
    body: "Risk stratification and cohort views computed continuously across your live census.",
    tag: "beta",
    ok: false,
  },
  {
    icon: Network,
    index: "06",
    title: "FHIR-first interop",
    body: "R4 APIs by default. Your EHR, wearables, and payer feeds speak the same protocol.",
    tag: "online",
    ok: true,
  },
];

export function Features() {
  return (
    <section id="features" className="border-t border-border/60 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          kicker="core services"
          title="Everything a care system needs. Nothing it doesn't."
          description="Each module is a compiled, independently deployable service — composed through one control plane."
        />

        <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.article
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: (i % 3) * 0.08, duration: 0.45 }}
              className="group relative bg-card p-6 transition-colors hover:bg-accent/25"
            >
              <div className="flex items-start justify-between">
                <span className="flex size-10 items-center justify-center rounded-md border border-border/80 bg-background text-foreground transition-colors group-hover:border-ok/40 group-hover:text-ok">
                  <f.icon className="size-5" />
                </span>
                <span className="font-mono text-[11px] text-muted-foreground/60">
                  [{f.index}]
                </span>
              </div>
              <h3 className="mt-5 font-mono text-lg font-semibold tracking-tight text-foreground">
                {f.title}
              </h3>
              <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                {f.body}
              </p>
              <p className="mt-5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <span
                  className={
                    f.ok
                      ? "size-1.5 rounded-full bg-ok"
                      : "size-1.5 rounded-full bg-warn"
                  }
                />
                status:{" "}
                <span className={f.ok ? "text-ok" : "text-warn"}>{f.tag}</span>
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
