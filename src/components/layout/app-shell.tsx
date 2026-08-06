import { ArogyaMark } from "@/components/brand/arogya-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { toast } from "sonner";

const APP_LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/upload", label: "Upload Report" },
  { to: "/journey", label: "Health Journey" },
  { to: "/baseline", label: "Health Baseline" },
  { to: "/copilot", label: "Doctor Copilot" },
  { to: "/voice", label: "Voice Assistant" },
  { to: "/profile", label: "Profile" },
];

function initialsOf(name?: string | null, email?: string | null) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return `${parts[0][0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return (email?.[0] ?? "U").toUpperCase();
}

export function AppShell() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/login", { replace: true });
  };

  return (
    <div className="auth-gradient min-h-screen">
      <header className="glass-card sticky top-3 z-50 mx-auto mt-3 flex max-w-6xl items-center justify-between gap-3 rounded-2xl px-4 py-2.5 sm:px-5">
        <Link to="/dashboard" aria-label="ArogyaOS dashboard" className="shrink-0">
          <span className="flex items-center gap-2 font-mono text-base font-semibold tracking-tight text-foreground">
            <ArogyaMark className="size-7" />
            <span className="hidden sm:inline">
              arogya<span className="text-primary">OS</span>
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {APP_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <span className="hidden items-center gap-2 rounded-full border border-border/60 bg-background/60 py-1 pl-1 pr-3 sm:flex">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {initialsOf(profile?.full_name, user?.email)}
            </span>
            <span className="max-w-[120px] truncate text-xs font-medium text-foreground">
              {profile?.full_name ?? user?.email}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            className="cursor-pointer"
            onClick={handleSignOut}
          >
            <LogOut className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Toggle menu"
            className="cursor-pointer lg:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-card mx-3 mt-2 rounded-2xl p-2 lg:hidden"
          >
            {APP_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 text-left text-sm font-medium text-crit transition-colors hover:bg-crit/10"
            >
              <LogOut className="size-4" /> Logout
            </button>
          </motion.nav>
        )}
      </AnimatePresence>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
