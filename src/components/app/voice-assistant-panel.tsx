import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import {
  friendlyAssistantError,
  loadVoiceSnapshot,
  QUICK_ACTIONS,
  sendVoiceMessage,
  type VoiceMessage,
  type VoiceSnapshot,
} from "@/lib/voice-assistant";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  AudioLines,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  UploadCloud,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

/**
 * Arogya Voice — AI Voice Health Assistant panel.
 *
 * A voice interface over the existing ArogyaOS AI stack: speech-to-text via
 * the browser Web Speech API, answers grounded in the user's own health
 * snapshot via the existing `copilotChat:chat` Convex action, and text-to-
 * speech via browser speechSynthesis. Conversation history lives in this
 * component + sessionStorage for the current browser session — never stored
 * on a server.
 *
 * The voice footer offers a language quick-picker for the major Indian
 * languages (Hindi, Telugu, Tamil, Malayalam, Kannada) in addition to the
 * fine-grained voice dropdown. Picking a language resolves the best available
 * voice and falls back to a language hint so browsers with network TTS can
 * still speak it.
 */

/* ------------------------------- atoms ------------------------------- */

/** Animated waveform bars used while listening. */
function Waveform() {
  return (
    <div className="flex h-7 items-center gap-[3px] text-primary" role="img" aria-label="Listening">
      {Array.from({ length: 7 }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-current"
          style={{ height: 20 }}
          animate={{ scaleY: [0.25, 1, 0.25] }}
          transition={{ repeat: Infinity, duration: 0.85, delay: i * 0.09, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/** Animated "thinking" indicator shown while Gemini responds. */
function ThinkingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-1.5 self-start rounded-2xl border border-border/60 bg-background/60 px-4 py-3"
      role="status"
      aria-label="Arogya Voice is thinking"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-primary/70"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </motion.div>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------------------- Indian language presets --------------------- */

const INDIAN_LANGUAGES: { code: string; label: string; native: string }[] = [
  { code: "hi-IN", label: "Hindi", native: "हिन्दी" },
  { code: "te-IN", label: "Telugu", native: "తెలుగు" },
  { code: "ta-IN", label: "Tamil", native: "தமிழ்" },
  { code: "ml-IN", label: "Malayalam", native: "മലയാളം" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ" },
];

/** Primary BCP-47 subtags of the presets (e.g. "hi", "te", "ta"…). */
const INDIAN_PRIMARIES = new Set(INDIAN_LANGUAGES.map((l) => l.code.split("-")[0].toLowerCase()));

function voicePrimary(voice: SpeechSynthesisVoice | null): string {
  return (voice?.lang ?? "").toLowerCase().split("-")[0];
}

/* ------------------------------ component ---------------------------- */

interface VoiceAssistantPanelProps {
  variant?: "floating" | "page";
  onClose?: () => void;
  className?: string;
}

export function VoiceAssistantPanel({
  variant = "floating",
  onClose,
  className = "",
}: VoiceAssistantPanelProps) {
  const { user, session } = useAuth();

  /* ---- health snapshot (auto-collected context, reused queries) ---- */
  const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
  const [snapshotState, setSnapshotState] = useState<"loading" | "ready" | "error" | "empty">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setSnapshotState("loading");
    setSnapshot(null);
    loadVoiceSnapshot(user.id)
      .then((loaded) => {
        if (cancelled) return;
        setSnapshot(loaded);
        setSnapshotState(loaded.reportCount === 0 ? "empty" : "ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setSnapshotState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [user, attempt]);

  /* ---- conversation (session-scoped + sessionStorage persistence) ---- */
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const pendingRef = useRef(false);
  const messagesRef = useRef<VoiceMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const storageKey = user ? `arogya:voice:${user.id}` : null;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* Hydrate once from sessionStorage (same browser tab session). */
  useEffect(() => {
    if (!storageKey || hydrated) return;
    setHydrated(true);
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as VoiceMessage[];
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch {
      /* ignore corrupt storage */
    }
  }, [storageKey, hydrated]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      /* storage may be unavailable — conversation still works in memory */
    }
  }, [messages, storageKey]);

  /* ---- voice output (TTS) ---- */
  const tts = useSpeechSynthesis();
  const [autoSpeak, setAutoSpeak] = useState(true);
  const lastSpokenRef = useRef<number | null>(null);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant") ?? null;

  /* Read every AI reply aloud automatically. */
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!autoSpeak || !tts.supported || pending || !lastMessage) return;
    if (lastMessage.role === "assistant" && lastMessage.timestamp !== lastSpokenRef.current) {
      lastSpokenRef.current = lastMessage.timestamp;
      tts.speak(lastMessage.content);
    }
  }, [lastMessage, autoSpeak, pending, tts]);

  /* ---- sending ---- */
  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || pendingRef.current) return;
      const accessToken = session?.access_token;
      const chatContext = snapshot?.chatContext;
      if (!accessToken || !chatContext) return;

      pendingRef.current = true;
      setPending(true);
      setError(null);
      setInput("");
      tts.stop();

      const userMessage: VoiceMessage = { role: "user", content: question, timestamp: Date.now() };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const outcome = await sendVoiceMessage({
          accessToken,
          question,
          history: messagesRef.current,
          chatContext,
        });
        if (outcome.ok) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: outcome.reply, timestamp: Date.now() },
          ]);
        } else {
          setError({ code: outcome.code, message: outcome.message });
        }
      } catch {
        setError({ code: "server", message: "Could not reach the assistant. Please try again." });
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [session, snapshot, tts],
  );

  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  /* ---- voice input (SpeechRecognition) ---- */
  const recognitionResetRef = useRef<() => void>(() => {});
  const recognition = useSpeechRecognition(
    useCallback((finished: string) => {
      recognitionResetRef.current();
      void sendRef.current(finished);
    }, []),
  );
  useEffect(() => {
    recognitionResetRef.current = recognition.reset;
  }, [recognition.reset]);

  const ready = snapshotState === "ready";
  const canListen = recognition.supported && ready && !pending && !recognition.listening;
  const canSend = ready && !pending;

  const toggleListening = useCallback(() => {
    if (recognition.listening) recognition.stop();
    else if (canListen) recognition.start();
  }, [recognition, canListen]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void send(input);
      }
    },
    [send, input],
  );

  /* Auto-scroll to the newest content. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, recognition.interimTranscript, recognition.listening]);

  const handleClose = useCallback(() => {
    recognition.stop();
    tts.stop();
    onClose?.();
  }, [recognition, tts, onClose]);

  const speaking = tts.speaking && !tts.paused;

  /* Indian voices first in the fine-grained dropdown, so they're easy to find. */
  const sortedVoices = useMemo(() => {
    return [...tts.voices].sort((a, b) => {
      const aIndian = INDIAN_PRIMARIES.has(voicePrimary(a)) ? 0 : 1;
      const bIndian = INDIAN_PRIMARIES.has(voicePrimary(b)) ? 0 : 1;
      return aIndian - bIndian || a.name.localeCompare(b.name);
    });
  }, [tts.voices]);

  /** True when the given language preset is the active TTS language. */
  const isLangActive = (code: string) => {
    if (!code) {
      return (
        !tts.lang &&
        (!tts.voice || !INDIAN_PRIMARIES.has(voicePrimary(tts.voice)))
      );
    }
    if (tts.lang === code) return true;
    if (!tts.voice) return false;
    return voicePrimary(tts.voice) === code.split("-")[0].toLowerCase();
  };

  /* ------------------------------ render ------------------------------ */

  const statusText = recognition.listening
    ? "Listening…"
    : pending
      ? "Thinking…"
      : speaking
        ? "Speaking…"
        : "Online · grounded in your records";

  return (
    <section
      role="dialog"
      aria-label="Arogya AI voice health assistant"
      className={`glass-card flex flex-col overflow-hidden rounded-3xl ${
        variant === "page" ? "h-[640px]" : "h-[min(600px,calc(100dvh-150px))]"
      } ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <AudioLines className="size-4" />
          {recognition.listening && (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-crit">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-crit opacity-75" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-mono text-[15px] font-semibold tracking-tight text-foreground">
            Arogya Voice
          </h2>
          <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                recognition.listening ? "bg-crit" : speaking ? "bg-warn" : "bg-ok"
              }`}
              aria-hidden
            />
            {statusText}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={autoSpeak ? "Turn off read-aloud answers" : "Turn on read-aloud answers"}
          aria-pressed={autoSpeak}
          className="cursor-pointer text-muted-foreground"
          onClick={() => setAutoSpeak((v) => !v)}
        >
          {autoSpeak ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </Button>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close voice assistant"
            className="cursor-pointer text-muted-foreground"
            onClick={handleClose}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <div
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-label="Conversation with Arogya Voice"
      >
        {snapshotState === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm">Loading your health snapshot…</p>
          </div>
        )}

        {snapshotState === "error" && (
          <div
            className="m-auto w-full max-w-sm rounded-2xl border border-warn/40 bg-warn/8 p-5 text-center"
            role="alert"
          >
            <AlertTriangle className="mx-auto size-5 text-warn" />
            <p className="mt-2 text-sm font-medium text-foreground">Couldn’t load your health data</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {loadError === "SCHEMA_NOT_APPLIED"
                ? "The database schema isn’t applied yet — run migrations 0001–0002 in the Supabase SQL Editor."
                : "Something went wrong reading your records. Your data is safe — try again."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 cursor-pointer"
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RefreshCw className="size-3.5" /> Retry
            </Button>
          </div>
        )}

        {snapshotState === "empty" && (
          <div className="m-auto w-full max-w-sm rounded-2xl border border-primary/20 bg-primary/6 p-5 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <UploadCloud className="size-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">
              Upload your first medical report to chat with your health
            </p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Arogya Voice answers from your own reports, metrics, baselines and AI analyses —
              there’s nothing to talk about yet.
            </p>
            <Link
              to="/upload"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <UploadCloud className="size-4" /> Upload Report
            </Link>
          </div>
        )}

        {messages.length === 0 && snapshotState === "ready" && !pending && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-2xl border border-primary/20 bg-primary/6 px-4 py-3"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Mic className="size-3.5" /> Ready when you are
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
              Tap the microphone and speak naturally — or type below. Answers are read aloud and
              grounded in your own records.
            </p>
          </motion.div>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <motion.div
              key={`${message.timestamp}-${message.content.slice(0, 12)}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={isUser ? "self-end" : "self-start"}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${
                  isUser
                    ? "border border-primary/25 bg-primary/12 text-foreground"
                    : "border border-border/60 bg-background/60 text-foreground/90"
                }`}
              >
                {message.content}
              </div>
              <p className="mt-1 px-1 text-[10px] text-muted-foreground/70">
                {formatTime(message.timestamp)}
              </p>
            </motion.div>
          );
        })}

        {/* Live transcript + waveform while listening */}
        {recognition.listening && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="self-end"
          >
            <div className="flex items-center gap-2.5 rounded-2xl border border-crit/30 bg-crit/8 px-3.5 py-2.5 text-[13px] text-foreground/90">
              <Waveform />
              <span className="max-w-[220px] italic leading-5">
                {recognition.interimTranscript || "Listening…"}
              </span>
            </div>
          </motion.div>
        )}

        {pending && <ThinkingBubble />}

        {error && !pending && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="max-w-[90%] self-start rounded-2xl border border-warn/40 bg-warn/8 px-4 py-3"
            role="alert"
          >
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-warn">
              <AlertTriangle className="size-3.5" /> Couldn’t get an answer
            </p>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {friendlyAssistantError(error.code, error.message)}
            </p>
          </motion.div>
        )}

        {recognition.error && !recognition.listening && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[90%] self-start rounded-2xl border border-warn/40 bg-warn/8 px-4 py-3"
            role="alert"
          >
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-warn">
              <Mic className="size-3.5" /> Microphone
            </p>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{recognition.error}</p>
          </motion.div>
        )}

        <div ref={endRef} />
      </div>

      {/* Quick actions */}
      {ready && (
        <div className="border-t border-border/60 px-3 pt-2">
          <div
            className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Suggested questions"
          >
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={!canSend}
                onClick={() => void send(action.prompt)}
                className="shrink-0 cursor-pointer rounded-full border border-border/60 bg-background/40 px-3 py-1.5 text-left text-[11.5px] font-medium text-foreground/85 transition-all hover:border-primary/40 hover:bg-primary/8 hover:text-primary disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input row */}
      <div className="border-t border-border/60 p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!ready || pending}
            placeholder={recognition.supported ? "Type or speak…" : "Type your question…"}
            aria-label="Ask a question about your health"
            className="h-11 min-w-0 flex-1 rounded-2xl border border-border/70 bg-background/50 px-3.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          <Button
            type="button"
            onClick={toggleListening}
            disabled={!canListen && !recognition.listening}
            aria-label={recognition.listening ? "Stop listening" : "Start listening"}
            className={`h-11 w-11 shrink-0 cursor-pointer rounded-2xl ${
              recognition.listening
                ? "bg-crit text-crit-foreground hover:bg-crit/90"
                : "border border-border/70 bg-background/50 text-primary hover:bg-primary/10"
            }`}
          >
            {recognition.listening ? <Square className="size-4" /> : <Mic className="size-4" />}
          </Button>
          <Button
            type="button"
            onClick={() => void send(input)}
            disabled={!canSend || !input.trim()}
            aria-label="Send question"
            className="h-11 w-11 shrink-0 cursor-pointer rounded-2xl"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Language quick-picker — Indian languages included */}
      {tts.supported && (
        <div className="flex items-center gap-2 border-t border-border/40 bg-background/25 px-3 py-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Language
          </span>
          <div
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Choose the language for read-aloud answers"
          >
            <button
              type="button"
              onClick={() => tts.selectLanguage("")}
              aria-pressed={isLangActive("")}
              className={`shrink-0 cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                isLangActive("")
                  ? "border-primary/50 bg-primary/12 text-primary"
                  : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
            >
              Default
            </button>
            {INDIAN_LANGUAGES.map((language) => {
              const active = isLangActive(language.code);
              return (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => tts.selectLanguage(language.code)}
                  aria-pressed={active}
                  className={`shrink-0 cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                    active
                      ? "border-primary/50 bg-primary/12 text-primary"
                      : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  {language.native} {language.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Voice output controls */}
      <div className="flex items-center gap-1.5 border-t border-border/40 bg-background/25 px-3 py-2">
        <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Voice
        </span>
        {tts.supported ? (
          <>
            {speaking ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 cursor-pointer text-muted-foreground"
                  aria-label={tts.paused ? "Resume speaking" : "Pause speaking"}
                  onClick={() => (tts.paused ? tts.resume() : tts.pause())}
                >
                  {tts.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 cursor-pointer text-muted-foreground"
                  aria-label="Stop speaking"
                  onClick={tts.stop}
                >
                  <Square className="size-3.5" />
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!lastAssistant}
                className="size-7 cursor-pointer text-muted-foreground"
                aria-label="Read the last answer aloud"
                onClick={() => lastAssistant && tts.speak(lastAssistant.content)}
              >
                <Play className="size-3.5" />
              </Button>
            )}
            <select
              value={tts.voice?.name ?? ""}
              onChange={(e) => {
                const next = tts.voices.find((v) => v.name === e.target.value) ?? null;
                tts.setVoice(next);
              }}
              aria-label="Choose a voice"
              className="hidden h-7 min-w-0 flex-1 cursor-pointer rounded-lg border border-border/60 bg-background/50 px-2 text-[11px] text-foreground outline-none focus:border-primary/60 sm:block"
            >
              <option value="">Default browser voice</option>
              {sortedVoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} · {v.lang}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">not supported by this browser</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/80">
          <ShieldCheck className="size-3 text-ok" />
          {tts.supported ? (autoSpeak ? "answers read aloud" : "read-aloud off") : "typed answers"}
        </span>
      </div>
    </section>
  );
}
