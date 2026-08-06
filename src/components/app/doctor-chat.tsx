import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  generateCopilotChat,
  type CopilotChatContext,
  type CopilotChatMessage,
} from "@/lib/copilot";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Brain,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ask Doctor Copilot — interactive chat panel.
 *
 * Renders the conversation UI for the Doctor Copilot page. Every answer is
 * grounded in the user's OWN health snapshot (`context`, assembled by
 * src/lib/copilot.ts from RLS-scoped reads) and sent to the secure
 * `copilotChat:chat` Convex action, which verifies the user's session
 * server-side. Conversation history lives only in this component's state for
 * the current session — it is never persisted.
 */

const SUGGESTED_PROMPTS = [
  "Explain my blood sugar.",
  "Why is my cholesterol high?",
  "Compare this report with my previous one.",
  "What should I ask my doctor?",
  "What lifestyle changes do you recommend?",
];

/** Maps structured error codes to friendly, non-alarming messages. */
function friendlyError(code: string, message: string): string {
  switch (code) {
    case "not_configured":
      return "The AI chat isn't configured on the server yet (GEMINI_API_KEY missing). Your visit preparation still works.";
    case "unauthorized":
      return "Your session could not be verified. Please sign in again.";
    case "rate_limited":
      return "The AI service's free-tier request quota is used up for today. It resets daily — try again later, or add a Gemini API key with billing enabled in the Keys tab.";
    case "timeout":
      return "The AI took too long to answer. Please try again.";
    case "empty_input":
      return message;
    default:
      return message || "Something went wrong. Please try again.";
  }
}

/** Animated typing indicator shown while Gemini is responding. */
function TypingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-1.5 self-start rounded-2xl border border-border/60 bg-background/60 px-4 py-3"
      role="status"
      aria-label="Copilot is thinking"
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

interface DoctorChatPanelProps {
  /** Health snapshot grounded in the signed-in user's own data (null while loading). */
  context: CopilotChatContext | null;
  /** Supabase access token used to verify the session server-side. */
  accessToken: string | null;
  className?: string;
}

export function DoctorChatPanel({ context, accessToken, className = "" }: DoctorChatPanelProps) {
  const [messages, setMessages] = useState<CopilotChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string; question: string } | null>(
    null,
  );
  const endRef = useRef<HTMLDivElement>(null);

  const canChat = Boolean(context && accessToken);

  /* Keep the newest message in view. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || pending || !context || !accessToken) return;
      const userMessage: CopilotChatMessage = { role: "user", content: question };
      const history = messages;
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setError(null);
      setPending(true);
      try {
        const outcome = await generateCopilotChat(
          accessToken,
          question,
          history.slice(-10),
          context,
        );
        if (outcome.ok) {
          setMessages((prev) => [...prev, { role: "assistant", content: outcome.reply }]);
        } else {
          setError({ code: outcome.code, message: outcome.message, question });
        }
      } catch {
        setError({ code: "server", message: "Could not reach the assistant. Please try again.", question });
      } finally {
        setPending(false);
      }
    },
    [pending, context, accessToken, messages],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send(input);
      }
    },
    [send, input],
  );

  const ready = canChat && messages.length === 0 && !pending;
  const loading = !canChat && messages.length === 0 && !pending;

  return (
    <section
      aria-label="Ask Doctor Copilot"
      className={`glass-card flex h-[560px] flex-col overflow-hidden rounded-3xl lg:h-[720px] ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-mono text-[15px] font-semibold tracking-tight text-foreground">
            Ask Doctor Copilot
          </h2>
          <p className="truncate text-[11px] text-muted-foreground">
            Answers grounded in your own reports and baselines
          </p>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-label="Conversation with Doctor Copilot"
      >
        {loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm">Loading your health snapshot…</p>
          </div>
        )}

        {ready && (
          <div className="space-y-4 pt-1">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="rounded-2xl border border-primary/20 bg-primary/6 px-4 py-3"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                <Brain className="size-3.5" /> Ready when you are
              </p>
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                Ask anything about your reports, trends, baselines, or what to discuss with your
                doctor.
              </p>
            </motion.div>
            <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void send(prompt)}
                  className="cursor-pointer rounded-full border border-border/60 bg-background/40 px-3 py-1.5 text-left text-[12px] font-medium text-foreground/85 transition-all hover:border-primary/40 hover:bg-primary/8 hover:text-primary"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          const isUser = message.role === "user";
          return (
            <motion.div
              key={`${index}-${message.content.slice(0, 12)}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${
                isUser
                  ? "self-end border border-primary/25 bg-primary/12 text-foreground"
                  : "self-start border border-border/60 bg-background/60 text-foreground/90"
              }`}
            >
              {message.content}
            </motion.div>
          );
        })}

        {pending && <TypingBubble />}

        {error && !pending && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="max-w-[90%] self-start rounded-2xl border border-warn/40 bg-warn/8 px-4 py-3"
            role="alert"
          >
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-warn">
              <AlertTriangle className="size-3.5" /> Couldn't get an answer
            </p>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {friendlyError(error.code, error.message)}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 cursor-pointer"
              onClick={() => void send(error.question)}
            >
              <RefreshCw className="size-3.5" /> Try again
            </Button>
          </motion.div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border/60 p-3.5">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!canChat || pending}
            placeholder={
              canChat
                ? "Ask about your reports, trends or doctor visit…"
                : "Loading your health data…"
            }
            rows={2}
            aria-label="Ask a question about your health"
            className="min-h-[56px] flex-1 resize-none rounded-2xl border border-border/70 bg-background/50 text-[13px]"
          />
          <Button
            type="button"
            onClick={() => void send(input)}
            disabled={!canChat || pending || !input.trim()}
            aria-label="Send question"
            className="h-14 w-12 shrink-0 cursor-pointer rounded-2xl"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <p className="mt-2 flex items-center justify-center gap-1 text-center text-[10px] text-muted-foreground/70">
          <ShieldCheck className="size-3 text-ok" />
          Grounded in your data and educational only — never medical advice. Enter to send.
        </p>
      </div>
    </section>
  );
}
