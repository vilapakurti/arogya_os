import { VoiceAssistantPanel } from "@/components/app/voice-assistant-panel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AnimatePresence, motion } from "framer-motion";
import { AudioLines, Mic, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

/**
 * FloatingVoiceAssistant — the Arogya Voice assistant available throughout
 * the authenticated application.
 *
 * A bottom-right floating microphone button opens the assistant panel on any
 * app page. The assistant is hidden on the /voice page itself, where the page
 * embeds the full-size panel (so there is never a duplicate chat on screen).
 * Esc or the close button dismisses it.
 */
export function FloatingVoiceAssistant() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  /* Esc closes the panel. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* The /voice page embeds the full assistant — no floating duplicate. */
  if (pathname === "/voice" || !user) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            style={{ transformOrigin: "bottom right" }}
            className="fixed bottom-24 right-4 z-50 sm:right-6"
          >
            <VoiceAssistantPanel
              variant="floating"
              onClose={() => setOpen(false)}
              className="w-[calc(100vw-32px)] max-w-[400px] shadow-2xl shadow-black/10"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating mic button */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="fixed bottom-5 right-4 z-50 sm:right-6"
      >
        <Button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close AI voice assistant" : "Open AI voice assistant"}
          aria-expanded={open}
          className="relative size-14 cursor-pointer rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 hover:bg-primary/90"
        >
          {open ? <X className="size-5" /> : <Mic className="size-5" />}
          {!open && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-ok">
              <AudioLines className="size-2.5 text-ok-foreground" />
            </span>
          )}
        </Button>
      </motion.div>
    </>
  );
}
