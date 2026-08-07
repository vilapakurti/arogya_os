import { Caret } from "@/components/landing/terminal-window";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { computeProfileCompletion } from "@/lib/patient-profile";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Brain,
  FileUp,
  HeartPulse,
  Mic,
  Route,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";

const MODULES = [
  {
    to: "/upload",
    icon: FileUp,
    title: "Upload Report",
    desc: "Send a medical report to start your AI action plan.",
  },
  {
    to: "/journey",
    icon: Route,
    title: "Health Journey",
    desc: "Watch your health history unfold over time.",
  },
  {
    to: "/copilot",
    icon: Brain,
    title: "Doctor Copilot",
    desc: "Get a tailored brief before your next visit.",
  },
  {
    to: "/voice",
    icon: Mic,
    title: "Voice Assistant",
    desc: "Ask about your health in any language.",
  },
  {
    to: "/patient-profile",
    icon: HeartPulse,
    title: "Patient Profile",
    desc: "Keep your demographics and health history up to date.",
  },
];

export default function Dashboard() {
  const { profile } = useAuth();
  const firstName = profile?.full_name?.split(/\s+/)[0] ?? "there";
  const completion = useMemo(() => computeProfileCompletion(profile), [profile]);
  const profileIncomplete = completion.percent < 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-4xl"
    >
      <p className="font-mono text-[12px] text-muted-foreground">
        <span className="text-primary">$</span> arogya dashboard · signed in
      </p>
      <h1 className="mt-3 font-mono text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Welcome, {firstName}.
        <Caret className="ml-2" />
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
        Your AI health memory is ready. Choose a module to begin — each one is
        powered by your private, encrypted health data.
      </p>

      {/* Profile completion banner */}
      {profileIncomplete && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4 }}
          className="glass-card mt-8 rounded-2xl p-5"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warn/12 text-warn">
                <HeartPulse className="size-5" />
              </span>
              <div>
                <p className="font-mono text-sm font-semibold text-foreground">
                  Complete your health profile
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Complete your health profile to receive personalized AI
                  analysis.
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={completion.percent} className="h-2 w-40" />
                  <span className="tnum font-mono text-xs text-muted-foreground">
                    {completion.percent}%
                  </span>
                </div>
              </div>
            </div>
            <Button asChild className="h-10 shrink-0 cursor-pointer rounded-xl">
              <Link to="/patient-profile">
                Complete profile
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </motion.div>
      )}

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {MODULES.map((m, i) => (
          <motion.div
            key={m.to}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.06, duration: 0.4 }}
          >
            <Link
              to={m.to}
              className="glass-card group flex h-full flex-col rounded-2xl p-6 transition-transform duration-200 hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary transition-colors group-hover:bg-primary/20">
                  <m.icon className="size-5" />
                </span>
                <ArrowRight className="size-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <h2 className="mt-4 font-mono text-lg font-semibold text-foreground">
                {m.title}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {m.desc}
              </p>
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
