import { useAuthContext } from "@/components/auth/supabase-auth-provider";

/**
 * Application-wide auth hook backed by Supabase Auth + profiles.
 * Replaces the template's Convex-based hook — callers keep using:
 *   const { isLoading, isAuthenticated, user, signOut } = useAuth();
 */
export function useAuth() {
  return useAuthContext();
}
