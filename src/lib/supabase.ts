import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase connectivity module.
 *
 * Configure in the Keys tab:
 *   VITE_SUPABASE_URL      — project URL, e.g. https://xyz.supabase.co
 *   VITE_SUPABASE_ANON_KEY — public anon/publishable key
 *
 * The client is also the app-wide Supabase auth + data client.
 */

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** The Supabase client appends "/rest/v1/" itself, so drop any suffix a user
 *  may have copied from the dashboard API settings. */
export function normalizeSupabaseUrl(url: string): string {
  return url.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

const supabaseUrl = rawUrl ? normalizeSupabaseUrl(rawUrl) : undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && anonKey);

let client: SupabaseClient | null = null;

/** Lazily initialized Supabase client. Throws if not configured. */
export function getSupabase(): SupabaseClient {
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the Keys tab.",
    );
  }
  if (!client) {
    client = createClient(supabaseUrl, anonKey, {
      auth: {
        // Persist the session to localStorage so logins survive page
        // refreshes, auto-refresh the access token before it expires, and
        // detect sessions coming back from password-recovery links.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export interface SupabaseConnectionResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

/**
 * Verifies the application can communicate with Supabase without touching any
 * table: it hits the PostgREST root endpoint with the anon key.
 *
 * - HTTP 2xx        → connected, key accepted
 * - HTTP 401/403    → key rejected
 * - HTTP 404        → server + auth OK (OpenAPI endpoint disabled) → connected
 * - anything else   → server reachable but unexpected response
 * - network failure → connection error
 */
export async function verifySupabaseConnection(): Promise<SupabaseConnectionResult> {
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      error: "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.",
    };
  }
  const started = performance.now();
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (res.ok) return { ok: true, latencyMs };
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: `Supabase rejected the anon key (HTTP ${res.status}).`,
        latencyMs,
      };
    }
    if (res.status === 404) return { ok: true, latencyMs };
    return {
      ok: false,
      error: `Supabase returned an unexpected response (HTTP ${res.status}).`,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Network error reaching Supabase.",
      latencyMs,
    };
  }
}
