import { cn } from "@/lib/utils";

/** Terminal-prompt style logo glyph: a green block with a `>` caret + caret block. */
export function ArogyaMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" fill="none" className="size-[18px]">
        <path
          d="M6 6.5 9.5 10 6 13.5"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="11.8"
          y="11.75"
          width="2.6"
          height="1.9"
          fill="currentColor"
          opacity="0.95"
        />
      </svg>
    </span>
  );
}

/** Wordmark: "arogya" in ink + "OS" in terminal green, set in mono. */
export function ArogyaWordmark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-base font-semibold tracking-tight",
        className,
      )}
    >
      <ArogyaMark className={markClassName} />
      <span className="text-foreground">
        arogya<span className="text-primary">OS</span>
      </span>
    </span>
  );
}
