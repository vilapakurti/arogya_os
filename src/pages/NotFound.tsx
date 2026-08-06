import { ArogyaWordmark } from "@/components/brand/arogya-mark";
import { Caret } from "@/components/landing/terminal-window";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col bg-background"
    >
      <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
        <Link to="/">
          <ArogyaWordmark />
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-lg text-center">
          <p className="font-mono text-[12px] tracking-[0.14em] text-muted-foreground">
            $ curl -s arogya.com/this-page
          </p>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="tnum mt-4 font-mono text-7xl font-semibold tracking-tight text-foreground"
          >
            404<span className="text-primary">.</span>
          </motion.h1>
          <p className="mt-4 font-mono text-sm text-muted-foreground">
            <span className="text-crit">[ERROR]</span> route not found — the
            page you requested does not exist in this release.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild variant="outline" className="font-mono">
              <Link to="/">
                <ArrowLeft className="size-4" /> cd ~
              </Link>
            </Button>
            <Button asChild className="font-mono">
              <Link to="/dashboard">open console</Link>
            </Button>
          </div>
          <p className="mt-6 font-mono text-[11px] text-muted-foreground">
            arogyaos@care: ~ <Caret />
          </p>
        </div>
      </div>
    </motion.div>
  );
}
