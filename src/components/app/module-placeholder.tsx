import { Caret } from "@/components/landing/terminal-window";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface ModulePlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function ModulePlaceholder({
  icon: Icon,
  title,
  description,
}: ModulePlaceholderProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-2xl"
    >
      <p className="font-mono text-[12px] text-muted-foreground">
        <span className="text-primary">$</span> arogya module · {title.toLowerCase().replace(/\s+/g, "-")}
      </p>
      <div className="glass-card mt-5 rounded-3xl p-8 sm:p-10">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
          <Icon className="size-6" />
        </span>
        <h1 className="mt-5 font-mono text-2xl font-semibold tracking-tight text-foreground">
          {title}
          <Caret className="ml-1.5" />
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-7 text-muted-foreground">
          {description}
        </p>
        <div className="mt-6 rounded-xl border border-border/70 bg-background/60 p-4 font-mono text-[12px] leading-6 text-muted-foreground">
          <p>
            <span className="text-warn">[INFO]</span> module not yet provisioned
          </p>
          <p className="mt-1">
            $ arogya provision {title.toLowerCase().replace(/\s+/g, "-")} --stage auth
            <span className="text-ok"> · auth ✓</span>
          </p>
        </div>
      </div>
    </motion.section>
  );
}
