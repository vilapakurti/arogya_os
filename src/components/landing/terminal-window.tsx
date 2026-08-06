import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface TerminalWindowProps {
  title?: string;
  badge?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/** Reusable terminal window frame: title bar + mono body on a faint grid. */
export function TerminalWindow({
  title = "arogyaos@care: ~",
  badge,
  className,
  bodyClassName,
  children,
}: TerminalWindowProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/80 bg-card",
        className,
      )}
    >
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/70 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-crit/70" />
          <span className="size-2.5 rounded-full bg-warn/80" />
          <span className="size-2.5 rounded-full bg-ok/80" />
        </div>
        <span className="ml-2 truncate font-mono text-[11px] text-muted-foreground">
          {title}
        </span>
        {badge && (
          <span className="ml-auto hidden rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
            {badge}
          </span>
        )}
      </div>
      {/* body */}
      <div
        className={cn(
          "terminal-grid font-mono text-[13px] leading-relaxed",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Blinking block caret, e.g. after a prompt. */
export function Caret({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "terminal-cursor inline-block h-[1.05em] w-[0.55em] translate-y-[0.18em] rounded-[1px] bg-ok",
        className,
      )}
      aria-hidden="true"
    />
  );
}

/** One terminal prompt line: `$ command` in green. */
export function PromptLine({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  return (
    <p className={cn("whitespace-pre-wrap text-foreground/90", className)}>
      <span className="text-primary">$ </span>
      {command}
    </p>
  );
}
