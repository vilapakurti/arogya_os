import { SectionHeading } from "@/components/landing/section-heading";
import { motion } from "framer-motion";

const MODULE_ROWS = [
  { module: "records-core", version: "v2.4.1", status: "online", desc: "longitudinal patient record" },
  { module: "scheduling", version: "v1.9.0", status: "online", desc: "capacity & appointment engine" },
  { module: "billing-engine", version: "v2.1.3", status: "online", desc: "claims · eligibility · remittance" },
  { module: "pharmacy-dispense", version: "v1.2.0", status: "online", desc: "e-prescribing & inventory" },
  { module: "telehealth", version: "v0.9.4", status: "beta", desc: "virtual visits & e-consults" },
  { module: "analytics", version: "v3.0.2", status: "online", desc: "population health & risk" },
];

export function Modules() {
  return (
    <section id="modules" className="border-t border-border/60 bg-card/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          kicker="module registry"
          title="One kernel. A fleet of modules."
          description="Versioned, individually rolled back, and composed per facility. Read from the same registry your console does."
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="mt-14 overflow-hidden rounded-lg border border-border bg-background"
        >
          {/* header row */}
          <div className="grid grid-cols-[1fr_auto_auto_1.4fr] items-center gap-4 border-b border-border bg-muted/60 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground sm:px-5">
            <span>module</span>
            <span className="hidden sm:block">version</span>
            <span>status</span>
            <span className="hidden text-right md:block">description</span>
          </div>

          {MODULE_ROWS.map((row, i) => (
            <motion.div
              key={row.module}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="group grid grid-cols-[1fr_auto_auto_1.4fr] items-center gap-4 border-b border-border/60 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-accent/25 sm:px-5"
            >
              <span className="flex items-center gap-2.5 font-mono text-[13px] text-foreground">
                <span className="font-mono text-[11px] text-muted-foreground/50">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {row.module}
              </span>
              <span className="tnum hidden font-mono text-[12px] text-muted-foreground sm:block">
                {row.version}
              </span>
              <span
                className={
                  row.status === "online"
                    ? "inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-ok"
                    : "inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-warn"
                }
              >
                <span
                  className={
                    row.status === "online"
                      ? "size-1.5 rounded-full bg-ok"
                      : "size-1.5 rounded-full bg-warn"
                  }
                />
                {row.status}
              </span>
              <span className="hidden text-right font-mono text-[12px] text-muted-foreground md:block">
                {row.desc}
              </span>
            </motion.div>
          ))}
        </motion.div>

        <p className="mt-4 text-center font-mono text-[11px] text-muted-foreground">
          $ arogya registry sync --all &nbsp;·&nbsp; 6 of 6 modules tracked
        </p>
      </div>
    </section>
  );
}
