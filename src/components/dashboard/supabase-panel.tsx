import { Button } from "@/components/ui/button";
import type { SupabaseStatus } from "@/hooks/use-supabase-status";
import { Database, Loader2, RefreshCw } from "lucide-react";

interface SupabasePanelProps {
  status: SupabaseStatus;
  onRecheck: () => void;
}

/** Connectivity-only panel — confirms the app can reach Supabase. */
export function SupabasePanel({ status, onRecheck }: SupabasePanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-md border border-border/80 bg-background text-ok">
            <Database className="size-4" />
          </span>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              // data source
            </p>
            <h2 className="mt-1 font-mono text-lg font-semibold text-foreground">
              supabase · postgres
            </h2>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
          <span
            className={
              status.state === "connected"
                ? "size-1.5 rounded-full bg-ok"
                : status.state === "error"
                  ? "size-1.5 rounded-full bg-crit"
                  : "size-1.5 rounded-full bg-warn"
            }
          />
          <span
            className={
              status.state === "connected"
                ? "text-ok"
                : status.state === "error"
                  ? "text-crit"
                  : "text-warn"
            }
          >
            {status.state}
          </span>
        </span>
      </div>

      <div className="mt-5 rounded-md border border-border/70 bg-background/60 p-4 font-mono text-[12px] leading-6">
        {status.state === "unconfigured" && (
          <>
            <p>
              <span className="text-warn">[WARN]</span> supabase env vars not
              found
            </p>
            <p className="mt-1 text-muted-foreground">
              add <span className="text-foreground">VITE_SUPABASE_URL</span>{" "}
              and{" "}
              <span className="text-foreground">VITE_SUPABASE_ANON_KEY</span>{" "}
              in the Keys tab to connect.
            </p>
          </>
        )}
        {status.state === "checking" && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-ok" />
            $ ping supabase …
          </p>
        )}
        {status.state === "connected" && (
          <p>
            <span className="text-ok">[OK]</span> supabase reachable · anon
            key accepted
            {status.latencyMs != null && (
              <span className="tnum text-muted-foreground">
                {" "}
                · {status.latencyMs}ms
              </span>
            )}
          </p>
        )}
        {status.state === "error" && (
          <>
            <p>
              <span className="text-crit">[ERROR]</span> connection failed
            </p>
            <p className="mt-1 text-muted-foreground">{status.message}</p>
          </>
        )}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-4 cursor-pointer font-mono text-[12px]"
        onClick={onRecheck}
        disabled={status.state === "checking"}
      >
        <RefreshCw className="size-3.5" />
        re-check
      </Button>
    </div>
  );
}
