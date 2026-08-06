import { SectionHeading } from "@/components/landing/section-heading";
import { TerminalWindow } from "@/components/landing/terminal-window";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { KeyRound, Lock, ShieldCheck, UserCheck } from "lucide-react";

const COMPLIANCE = ["HIPAA", "SOC 2 Type II", "GDPR", "HITRUST"];
const CONTROLS = [
  { icon: Lock, title: "encryption at rest & in transit", body: "AES-256 and TLS 1.3 enforced platform-wide, keys rotated on schedule." },
  { icon: ShieldCheck, title: "phia by default", body: "Field-level access controls with full PHI audit trails on every read." },
  { icon: UserCheck, title: "role-based access", body: "12 starter roles, fine-grained scopes, and session revocation in seconds." },
  { icon: KeyRound, title: "zero standing privilege", body: "Ephemeral credentials for every integration and every human operator." },
];

const LOG_LINES = [
  { level: "OK", text: "hipaa 164.312 — encryption verified", tone: "ok" },
  { level: "OK", text: "rbac policy applied — 12 roles active", tone: "ok" },
  { level: "OK", text: "phi access audit — 0 anomalies", tone: "ok" },
  { level: "INFO", text: "backup snapshot 2026-08-04T09:00Z", tone: "muted" },
  { level: "WARN", text: "signing key rotation due in 14 days", tone: "warn" },
  { level: "OK", text: "pen test report 2026-Q3 — passed", tone: "ok" },
];

export function Security() {
  return (
    <section id="security" className="border-t border-border/60 py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
        >
          <SectionHeading
            align="left"
            kicker="security & compliance"
            title="Built like a critical system. Audited like one too."
            description="Security is not a feature layer — it's the substrate. Every access decision is logged, every credential is ephemeral, every control maps to a standard a regulator will actually ask about."
          />
          <div className="mt-6 flex flex-wrap gap-2">
            {COMPLIANCE.map((c) => (
              <Badge key={c} variant="outline" className="font-mono text-[11px]">
                <span className="mr-1 text-ok">✓</span> {c}
              </Badge>
            ))}
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {CONTROLS.map((c) => (
              <div key={c.title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background text-ok">
                  <c.icon className="size-4" />
                </span>
                <div>
                  <p className="font-mono text-[13px] font-semibold text-foreground">
                    {c.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                    {c.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <TerminalWindow
            title="tail -f /var/log/arogya/audit.log"
            badge="audit"
            bodyClassName="p-5"
          >
            <p className="text-muted-foreground">
              <span className="text-primary">$ </span>arogya audit --since
              24h
            </p>
            <div className="mt-3 space-y-2">
              {LOG_LINES.map((line, i) => (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span
                    className={
                      line.tone === "ok"
                        ? "text-ok"
                        : line.tone === "warn"
                          ? "text-warn"
                          : "text-muted-foreground"
                    }
                  >
                    [{line.level.padEnd(4)}]
                  </span>
                  <span className="text-foreground/80">{line.text}</span>
                </motion.p>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-ok" />
              continuous monitoring · 99.99% of checks passing
              <span className="ml-auto tnum">31d</span>
            </div>
          </TerminalWindow>
        </motion.div>
      </div>
    </section>
  );
}
