import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { Cta } from "@/components/landing/cta";
import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { Modules } from "@/components/landing/modules";
import { Security } from "@/components/landing/security";
import { Testimonials } from "@/components/landing/testimonials";
import { motion } from "framer-motion";

const STATS = [
  { value: "99.99%", label: "platform uptime · 12mo" },
  { value: "2.1M", label: "records migrated" },
  { value: "480+", label: "care teams online" },
  { value: "−38%", label: "denied claims" },
];

function StatsBar() {
  return (
    <section className="border-y border-border/60 bg-card/40">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden px-4 py-8 sm:px-6 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.07, duration: 0.4 }}
            className="flex flex-col items-center gap-1 px-4 py-2 text-center"
          >
            <span className="tnum font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {s.value}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {s.label}
            </span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen bg-background"
    >
      <Navbar />
      <main>
        <Hero />
        <StatsBar />
        <Features />
        <Modules />
        <Security />
        <Testimonials />
        <Cta />
      </main>
      <Footer />
    </motion.div>
  );
}
