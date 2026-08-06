import { SupabaseStartup } from "@/components/startup/supabase-startup";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/layout/app-shell";
import { SupabaseAuthProvider } from "@/components/auth/supabase-auth-provider";
import { ThemeProvider } from "next-themes";
import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const About = lazy(() => import("./pages/About.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const Signup = lazy(() => import("./pages/Signup.tsx"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const Onboarding = lazy(() => import("./pages/Onboarding.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const UploadReport = lazy(() => import("./pages/UploadReport.tsx"));
const HealthJourney = lazy(() => import("./pages/HealthJourney.tsx"));
const HealthBaseline = lazy(() => import("./pages/HealthBaseline.tsx"));
const DoctorCopilot = lazy(() => import("./pages/DoctorCopilot.tsx"));
const VoiceAssistant = lazy(() => import("./pages/VoiceAssistant.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

function Root() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<About />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Protected */}
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={<UploadReport />} />
          <Route path="/journey" element={<HealthJourney />} />
          {/* The timeline lives inside Health Journey; keep old links working. */}
          <Route path="/timeline" element={<Navigate to="/journey" replace />} />
          <Route path="/baseline" element={<HealthBaseline />} />
          <Route path="/doctor-copilot" element={<DoctorCopilot />} />
          {/* Keep the legacy copilot path working. */}
          <Route path="/copilot" element={<Navigate to="/doctor-copilot" replace />} />
          <Route path="/voice" element={<VoiceAssistant />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <SupabaseStartup />
      <SupabaseAuthProvider>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </SupabaseAuthProvider>
    </ThemeProvider>
    <VlyToolbar />
  </StrictMode>,
);
