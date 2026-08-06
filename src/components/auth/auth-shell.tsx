import { ArogyaMark, ArogyaWordmark } from "@/components/brand/arogya-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Link } from "react-router";

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className="auth-gradient relative min-h-screen overflow-hidden">
      {/* ambient blobs — positioned & z-0, always behind the content */}
      <div
        className="blob left-[-6rem] top-[-4rem] size-80 bg-ok/40"
        aria-hidden="true"
      />
      <div
        className="blob right-[-5rem] top-24 size-72 bg-warn/40 [animation-delay:-5s]"
        aria-hidden="true"
      />
      <div
        className="blob bottom-[-6rem] left-1/3 size-80 bg-primary/30 [animation-delay:-9s]"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" aria-label="ArogyaOS home">
            <ArogyaWordmark />
          </Link>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center px-4 pb-16 pt-4">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="glass-card w-full max-w-md rounded-3xl p-8 sm:p-10"
          >
            <div className="flex flex-col items-center text-center">
              <ArogyaMark className="size-12 rounded-2xl" />
              <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {subtitle}
              </p>
            </div>
            <div className="mt-8">{children}</div>
          </motion.div>
        </main>

        <footer className="px-6 pb-6 text-center font-mono text-[11px] text-muted-foreground/70">
          ArogyaOS · AI Health Memory · your data stays yours
        </footer>
      </div>
    </div>
  );
}
