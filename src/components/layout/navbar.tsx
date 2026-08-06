import { ArogyaWordmark } from "@/components/brand/arogya-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

const PUBLIC_LINKS = [
  { label: "home", to: "/" },
  { label: "about", to: "/about" },
];

const APP_LINKS = [
  { label: "dashboard", to: "/dashboard" },
  { label: "upload report", to: "/upload" },
  { label: "health journey", to: "/journey" },
  { label: "health baseline", to: "/baseline" },
  { label: "doctor copilot", to: "/doctor-copilot" },
  { label: "voice assistant", to: "/voice" },
  { label: "profile", to: "/profile" },
];

export function Navbar() {
  const { isAuthenticated, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
  };

  const links = isAuthenticated ? APP_LINKS : PUBLIC_LINKS;

  return (
    <header className="sticky top-0 z-50">
      <div className="border-b border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-1.5 font-mono text-[11px] tracking-wide text-muted-foreground">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-ok" />
          </span>
          <span>ai health memory · your data stays yours · v0.1.0-beta</span>
        </div>
      </div>

      <div className="border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="ArogyaOS home" className="shrink-0">
            <ArogyaWordmark />
          </Link>

          <div className="hidden items-center gap-1 font-mono text-[13px] md:flex">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            {isAuthenticated ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="cursor-pointer font-mono text-[13px]"
                onClick={handleSignOut}
              >
                logout
              </Button>
            ) : (
              <>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="font-mono text-[13px]"
                >
                  <Link to="/login">login</Link>
                </Button>
                <Button asChild size="sm" className="gap-1.5 font-mono text-[13px]">
                  <Link to="/signup">
                    signup
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Toggle menu"
              className="cursor-pointer"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </Button>
          </div>
        </nav>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden border-t border-border/60 md:hidden"
            >
              <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4">
                {links.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2.5 font-mono text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  >
                    $ cd {link.label}
                  </Link>
                ))}
                <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-4">
                  {isAuthenticated ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full cursor-pointer font-mono"
                      onClick={handleSignOut}
                    >
                      logout
                    </Button>
                  ) : (
                    <>
                      <Button
                        asChild
                        variant="outline"
                        className="w-full font-mono"
                        onClick={() => setOpen(false)}
                      >
                        <Link to="/login">login</Link>
                      </Button>
                      <Button
                        asChild
                        className="w-full font-mono"
                        onClick={() => setOpen(false)}
                      >
                        <Link to="/signup">
                          signup <ArrowRight className="size-4" />
                        </Link>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
