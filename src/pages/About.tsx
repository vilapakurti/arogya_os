import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { motion } from "framer-motion";
import { Brain, Languages, Route, ScanLine, Stethoscope } from "lucide-react";
import { Link } from "react-router";

const PILLARS = [
  {
    icon: ScanLine,
    title: "Reports → Action",
    body: "Upload any lab report and get a plain-language plan you can actually follow.",
  },
  {
    icon: Route,
    title: "A living journey",
    body: "Every metric becomes a chapter in your personal health timeline.",
  },
  {
    icon: Brain,
    title: "Your own baseline",
    body: "The APBE engine learns what 'normal' means for you — not the population average.",
  },
  {
    icon: Stethoscope,
    title: "Doctor visit copilot",
    body: "Walk into every consultation with a clear brief and the right questions.",
  },
  {
    icon: Languages,
    title: "Speak your language",
    body: "Ask about your health in Hindi, Tamil, Marathi, and more.",
  },
];

export default function About() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen bg-background"
    >
      <Navbar />
      <main>
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28">
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-mono text-[12px] font-medium tracking-[0.14em] text-primary"
            >
              <span className="text-muted-foreground/60">// </span>about
              arogyaos
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mt-4 font-mono text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
            >
              Your health data,
              <br />
              finally <span className="text-primary">working for you</span>.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 }}
              className="mx-auto mt-6 max-w-xl text-[15px] leading-7 text-muted-foreground sm:text-base"
            >
              ArogyaOS is an AI health memory — a private space where your
              medical reports become insights, your trends become a journey,
              and every doctor visit starts with you already prepared.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
              className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Link
                to="/signup"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-6 font-mono text-sm text-primary-foreground transition-colors hover:bg-primary/90"
              >
                create account
              </Link>
              <Link
                to="/login"
                className="inline-flex h-10 items-center rounded-lg border border-border bg-background px-6 font-mono text-sm transition-colors hover:bg-accent/60"
              >
                sign in
              </Link>
            </motion.div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-5xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {PILLARS.map((p, i) => (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: (i % 3) * 0.08, duration: 0.45 }}
                className="rounded-xl border border-border bg-card p-6 transition-colors hover:bg-accent/25"
              >
                <span className="flex size-10 items-center justify-center rounded-md border border-border/80 bg-background text-ok">
                  <p.icon className="size-5" />
                </span>
                <h2 className="mt-4 font-mono text-base font-semibold text-foreground">
                  {p.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {p.body}
                </p>
              </motion.div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </motion.div>
  );
}
