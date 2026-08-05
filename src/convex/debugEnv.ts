"use node";

/**
 * TEMPORARY diagnostic action — remove after the env investigation is done.
 *
 * Returns ONLY presence booleans for the backend environment; never the
 * secret values themselves.
 */

import { action } from "./_generated/server";

export const debugEnv = action({
  args: {},
  handler: async (): Promise<{
    deployment: string | null;
    hasGemini: boolean;
    hasSupabaseUrl: boolean;
    hasSupabaseAnon: boolean;
  }> => {
    return {
      deployment: process.env.CONVEX_DEPLOYMENT ?? null,
      hasGemini: Boolean(process.env.GEMINI_API_KEY),
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasSupabaseAnon: Boolean(process.env.SUPABASE_ANON_KEY),
    };
  },
});
