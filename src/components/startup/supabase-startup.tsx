import { isSupabaseConfigured, verifySupabaseConnection } from "@/lib/supabase";
import { useEffect } from "react";

/** Module-level guard so the check runs once per session (StrictMode-safe). */
let verificationStarted = false;

/**
 * Verifies Supabase connectivity on application startup.
 * Logs "Supabase Connected" to the developer console on success and warns
 * (without crashing) on any failure. Renders nothing.
 */
export function SupabaseStartup() {
  useEffect(() => {
    if (verificationStarted) return;
    verificationStarted = true;

    void (async () => {
      if (!isSupabaseConfigured) {
        console.warn(
          "[Supabase] Not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the Keys tab.",
        );
        return;
      }
      const result = await verifySupabaseConnection();
      if (result.ok) {
        console.log(
          `[Supabase] Connected${
            result.latencyMs != null ? ` (${result.latencyMs}ms)` : ""
          }`,
        );
      } else {
        console.warn(
          `[Supabase] Connection failed: ${result.error ?? "unknown error"}`,
        );
      }
    })();
  }, []);

  return null;
}
