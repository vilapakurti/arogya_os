import { isSupabaseConfigured, verifySupabaseConnection } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

export type SupabaseStatus =
  | { state: "unconfigured" }
  | { state: "checking" }
  | { state: "connected"; latencyMs: number | null }
  | { state: "error"; message: string };

/** Connectivity-only status for the console. Never queries or creates tables. */
export function useSupabaseStatus() {
  const [status, setStatus] = useState<SupabaseStatus>(
    isSupabaseConfigured ? { state: "checking" } : { state: "unconfigured" },
  );

  const check = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setStatus({ state: "unconfigured" });
      return;
    }
    setStatus({ state: "checking" });
    const result = await verifySupabaseConnection();
    if (result.ok) {
      setStatus({ state: "connected", latencyMs: result.latencyMs ?? null });
    } else {
      setStatus({ state: "error", message: result.error ?? "Unknown error" });
    }
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) void check();
  }, [check]);

  return { status, check };
}
