import { getAuthErrorMessage } from "@/lib/auth-errors";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  age: number | null;
  gender: string | null;
  preferred_language: string | null;
  /* ---- Patient Profile fields (migration 0007) ---- */
  date_of_birth: string | null;
  blood_group: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  bmi: number | null;
  bmi_category: string | null;
  age_category: string | null;
  pregnant: boolean | null;
  trimester: string | null;
  smoking_status: string | null;
  alcohol_status: string | null;
  exercise_level: string | null;
  known_conditions: string[] | null;
  family_history: string[] | null;
  allergies: string | null;
  current_medications: Medication[] | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignUpData {
  fullName: string;
  email: string;
  password: string;
}

export interface SignInData {
  email: string;
  password: string;
}

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** True when the current session was restored from a password-recovery link. */
  isRecovery: boolean;
  signUp: (data: SignUpData) => Promise<{ needsEmailConfirmation: boolean }>;
  signIn: (data: SignInData) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);

  const refreshProfile = useCallback(async (userId: string) => {
    if (!isSupabaseConfigured) return;
    const { data, error } = await getSupabase()
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (!error && data) {
      setProfile(data as Profile);
    } else {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      console.warn(
        "[ArogyaOS] Supabase is not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the Keys tab.",
      );
      setIsLoading(false);
      return;
    }

    const supabase = getSupabase();

    // Restore the persisted session (localStorage) on boot.
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        void refreshProfile(data.session.user.id);
      }
      setIsLoading(false);
    });

    // React to sign-in, sign-out, token refresh, and recovery links.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
        setSession(nextSession);
        if (nextSession?.user) void refreshProfile(nextSession.user.id);
        return;
      }
      if (
        event === "SIGNED_IN" ||
        event === "INITIAL_SESSION" ||
        event === "TOKEN_REFRESHED"
      ) {
        setIsRecovery(false);
        setSession(nextSession);
        if (nextSession?.user) void refreshProfile(nextSession.user.id);
        return;
      }
      if (event === "SIGNED_OUT") {
        setIsRecovery(false);
        setSession(null);
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [refreshProfile]);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;

    const signUp: AuthContextValue["signUp"] = async ({
      fullName,
      email,
      password,
    }) => {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured. Add your API keys first.");
      }
      const { data, error } = await getSupabase().auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });
      if (error) throw new Error(getAuthErrorMessage(error));
      if (!data.session) {
        // Email confirmation is enabled — account created, waiting for verify.
        return { needsEmailConfirmation: true };
      }
      if (user) await refreshProfile(user.id);
      return { needsEmailConfirmation: false };
    };

    const signIn: AuthContextValue["signIn"] = async ({ email, password }) => {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured. Add your API keys first.");
      }
      const { error } = await getSupabase().auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new Error(getAuthErrorMessage(error));
    };

    const signOut: AuthContextValue["signOut"] = async () => {
      await getSupabase().auth.signOut();
    };

    const sendPasswordReset: AuthContextValue["sendPasswordReset"] = async (
      email,
    ) => {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured. Add your API keys first.");
      }
      const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw new Error(getAuthErrorMessage(error));
    };

    const updatePassword: AuthContextValue["updatePassword"] = async (
      newPassword,
    ) => {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured. Add your API keys first.");
      }
      const { error } = await getSupabase().auth.updateUser({
        password: newPassword,
      });
      if (error) throw new Error(getAuthErrorMessage(error));
    };

    const updateProfile: AuthContextValue["updateProfile"] = async (patch) => {
      if (!isSupabaseConfigured || !user) {
        throw new Error("You must be signed in to update your profile.");
      }
      const { error } = await getSupabase()
        .from("profiles")
        .upsert({ id: user.id, updated_at: new Date().toISOString(), ...patch });
      if (error) throw new Error(getAuthErrorMessage(error));
      await refreshProfile(user.id);
    };

    return {
      isLoading,
      isAuthenticated: Boolean(session),
      session,
      user,
      profile,
      isRecovery,
      signUp,
      signIn,
      signOut,
      sendPasswordReset,
      updatePassword,
      updateProfile,
      refreshProfile: () => (user ? refreshProfile(user.id) : Promise.resolve()),
    };
  }, [isLoading, session, profile, isRecovery, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used within SupabaseAuthProvider");
  }
  return ctx;
}
