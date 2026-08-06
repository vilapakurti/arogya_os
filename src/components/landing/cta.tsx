import { Caret } from "@/components/landing/terminal-window";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { ArrowRight, Terminal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

export function Cta() {
  const { isAuthenticated } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSent(true);
    toast.success("Access request queued", {
      description: `We'll reach out to ${email} with onboarding steps.`,
    });
  };

  return (
    <section id="cta" className="border-t border-border/60 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-xl border border-border bg-card"
        >
          <div className="terminal-grid grid-fade pointer-events-none absolute inset-0 opacity-70" />
          <div className="relative px-6 py-14 text-center sm:px-12 sm:py-16">
            <p className="font-mono text-[12px] font-medium tracking-[0.14em] text-primary">
              <span className="text-muted-foreground/60">// </span>
              get started
            </p>
            <h2 className="mx-auto mt-3 max-w-2xl font-mono text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Bring your care systems online<span className="text-primary">.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-muted-foreground">
              Pilot ArogyaOS on one department in 30 days. Our engineering
              team handles migration, mapping, and training.
            </p>

            <div className="mx-auto mt-9 max-w-xl">
              <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-2 sm:flex-row"
              >
                <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]">
                  <Terminal className="size-4 shrink-0 text-ok" />
                  <span className="font-mono text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="access --email you@health.org"
                    className="h-10 border-0 bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0 focus-visible:border-transparent"
                    aria-label="Work email"
                  />
                </div>
                <Button type="submit" size="lg" className="shrink-0 font-mono">
                  {sent ? "queued ✓" : "request access"}
                  {!sent && <ArrowRight className="size-4" />}
                </Button>
              </form>
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                <span className="text-ok">✓</span> no credit card · no vendor
                lock-in · SOC 2 infrastructure <Caret className="ml-1" />
              </p>
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild variant="outline" className="font-mono text-sm">
                <Link to="/dashboard">
                  {isAuthenticated ? "open console" : "explore the console"}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="ghost" className="font-mono text-sm">
                <a href="#features">$ man arogya</a>
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
