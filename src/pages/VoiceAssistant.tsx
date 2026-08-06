import { VoiceAssistantPanel } from "@/components/app/voice-assistant-panel";
import { Caret } from "@/components/landing/terminal-window";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  AudioLines,
  Database,
  Mic,
  ShieldCheck,
  Sparkles,
  Volume2,
} from "lucide-react";

/**
 * AI Voice Health Assistant — the /voice module page.
 *
 * The flagship voice interface over the existing ArogyaOS AI stack. The page
 * showcases the feature and embeds the full assistant panel (the floating
 * assistant is hidden here to avoid a duplicate chat). Voice input uses the
 * browser Web Speech API, output uses browser speechSynthesis, and every
 * answer is grounded in the user's own reports, metrics, baselines and AI
 * analyses through the existing secure Convex action — no new Gemini
 * endpoint, no external speech API, no keys on the client.
 */

const CAPABILITIES = [
  {
    icon: Mic,
    title: "Speak naturally",
    body: "Web Speech API in your browser — no external speech service. Live transcript while you talk, auto-stop after silence.",
  },
  {
    icon: Volume2,
    title: "Hear the answers",
    body: "Every reply is read aloud with browser speechSynthesis. Pause, resume, stop, or pick a voice.",
  },
  {
    icon: Database,
    title: "Grounded in your records",
    body: "Before answering, the assistant auto-collects your latest report, OCR, metrics, personal baselines, AI analyses and journey timeline.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    body: "Session verified server-side, answers generated on the secure Convex backend. Conversation lives only in your current session.",
  },
];

const EXAMPLE_PROMPTS = [
  "Explain my blood report.",
  "What is my latest HbA1c?",
  "Summarize my health.",
  "What should I ask my doctor?",
  "Compare this report with my previous one.",
  "Read my latest AI analysis.",
  "What foods should I avoid?",
  "Show my health journey.",
];

const STEPS = [
  {
    step: "01",
    title: "Tap the microphone",
    body: "Allow microphone access once. The waveform confirms you’re being heard.",
  },
  {
    step: "02",
    title: "Ask anything",
    body: "Speak a question or pick a quick action. Live transcript appears as you talk.",
  },
  {
    step: "03",
    title: "Listen to the answer",
    body: "Arogya Voice answers from your own records and reads the reply aloud.",
  },
];

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Mic;
  title: string;
  body: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-border/60 bg-background/40 p-4"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
        <Icon className="size-4" />
      </span>
      <h3 className="mt-3 text-[13.5px] font-semibold tracking-tight text-foreground">{title}</h3>
      <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{body}</p>
    </motion.div>
  );
}

export default function VoiceAssistant() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-6xl"
    >
      {/* Header */}
      <p className="font-mono text-[12px] text-muted-foreground">
        <span className="text-primary">$</span> arogya module · voice-assistant
      </p>
      <div className="mt-3">
        <h1 className="flex items-center gap-2 font-mono text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          AI Voice Health Assistant <Caret className="ml-1.5" />
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-7 text-muted-foreground">
          Speak naturally to your health history. Arogya Voice turns speech into questions,
          answers them from your own reports and baselines, and reads the reply back — a voice
          interface over the AI stack you already use.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Feature highlights">
        <Badge className="border-ok/40 bg-ok/15 text-ok">
          <Mic className="size-3" /> Web Speech input
        </Badge>
        <Badge className="border-primary/40 bg-primary/12 text-primary">
          <Volume2 className="size-3" /> Reads answers aloud
        </Badge>
        <Badge className="border-border/60 bg-accent/60 text-muted-foreground">
          <Database className="size-3" /> Grounded in your records
        </Badge>
        <Badge className="border-border/60 bg-accent/60 text-muted-foreground">
          <Sparkles className="size-3" /> No external speech API
        </Badge>
      </div>

      {/* Two-column: story + assistant */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0 space-y-6">
          {/* How it works */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
            className="glass-card rounded-3xl p-5 sm:p-6"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <AudioLines className="size-4" />
              </span>
              <div>
                <h2 className="font-mono text-[15px] font-semibold tracking-tight text-foreground">
                  How it works
                </h2>
                <p className="text-[11px] text-muted-foreground">Three steps, no setup</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {STEPS.map((item) => (
                <div
                  key={item.step}
                  className="rounded-2xl border border-border/60 bg-background/40 p-4"
                >
                  <p className="font-mono text-[11px] font-semibold text-primary">{item.step}</p>
                  <h3 className="mt-2 text-[13px] font-semibold tracking-tight text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Capabilities */}
          <div className="grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((capability) => (
              <FeatureCard key={capability.title} {...capability} />
            ))}
          </div>

          {/* Example prompts */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="glass-card rounded-3xl p-5 sm:p-6"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Sparkles className="size-4" />
              </span>
              <div>
                <h2 className="font-mono text-[15px] font-semibold tracking-tight text-foreground">
                  Things you can ask
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  All answered from your own uploaded records
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <span
                  key={prompt}
                  className="rounded-full border border-border/60 bg-background/40 px-3 py-1.5 font-mono text-[11.5px] text-foreground/80"
                >
                  “{prompt}”
                </span>
              ))}
            </div>
          </motion.div>

          {/* Privacy */}
          <div className="flex items-start gap-3 rounded-2xl border border-ok/30 bg-ok/8 p-4">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
            <p className="text-[12px] leading-5 text-muted-foreground">
              Your voice and conversation stay between you and your browser. Speech is processed
              on-device by the browser, and each question is answered server-side on the secure
              ArogyaOS backend with your session verified. This assistant is educational — it is
              not medical advice.
            </p>
          </div>
        </div>

        {/* Embedded assistant */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <VoiceAssistantPanel variant="page" />
        </div>
      </div>
    </motion.section>
  );
}
