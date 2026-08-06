import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useSpeechRecognition — browser Web Speech API (SpeechRecognition).
 *
 * No external speech API: this uses the browser's built-in speech-to-text.
 * Exposes the listening state, a live interim transcript (shown while the
 * user speaks), the accumulated final transcript, and a normalized error.
 * Listening auto-stops after a period of silence and after a hard time cap,
 * so the caller can send the finished sentence without the user tapping stop.
 *
 * Graceful fallback: when SpeechRecognition is unsupported, `supported` is
 * false and the caller falls back to typed input.
 */

/* Minimal structural types — the DOM lib does not ship SpeechRecognition. */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const SILENCE_TIMEOUT_MS = 2600; // auto-stop after this much silence
const MAX_LISTEN_MS = 15_000; // hard cap per listening session

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Maps the engine's raw error codes to friendly, actionable messages. */
function friendlySpeechError(error: string): string | null {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission denied — allow microphone access in your browser to speak.";
    case "no-speech":
      return "I didn’t catch that. Try speaking again.";
    case "audio-capture":
      return "No microphone was found on this device.";
    case "network":
      return "Speech recognition hit a network issue. Try again.";
    case "aborted":
      return null; // user-initiated stop — not an error
    default:
      return "Speech recognition had a problem. Please try again.";
  }
}

export interface SpeechRecognitionState {
  supported: boolean;
  listening: boolean;
  /** Live, non-final transcript while the user is speaking. */
  interimTranscript: string;
  /** Accumulated final transcript from the current listening session. */
  finalTranscript: string;
  /** Normalized friendly error, or null when healthy. */
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Clears transcripts after the caller has consumed the final text. */
  reset: () => void;
}

export function useSpeechRecognition(
  /** Called once with the finished sentence after a listening session ends. */
  onFinal?: (text: string) => void,
  lang = "en-US",
): SpeechRecognitionState {
  const supportedRef = useRef<boolean>(getCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    recognitionRef.current?.stop();
  }, [clearTimers]);

  const reset = useCallback(() => {
    finalRef.current = "";
    setFinalTranscript("");
    setInterimTranscript("");
  }, []);

  const start = useCallback(() => {
    if (!supportedRef.current || recognitionRef.current) return;
    const Ctor = getCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = langRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalRef.current = `${finalRef.current} ${transcript}`.trim();
        } else {
          interim += transcript;
        }
      }
      setInterimTranscript(interim);
      setFinalTranscript(finalRef.current);

      // Restart the silence timer — auto-stop when speech pauses.
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        recognitionRef.current?.stop();
      }, SILENCE_TIMEOUT_MS);
    };

    recognition.onerror = (event) => {
      setError(friendlySpeechError(event.error));
    };

    recognition.onend = () => {
      clearTimers();
      recognitionRef.current = null;
      setListening(false);
      const finished = finalRef.current.trim();
      if (finished) onFinalRef.current?.(finished);
    };

    recognitionRef.current = recognition;
    setError(null);
    setInterimTranscript("");
    try {
      recognition.start();
      maxTimerRef.current = setTimeout(() => {
        recognitionRef.current?.stop();
      }, MAX_LISTEN_MS);
    } catch {
      recognitionRef.current = null;
      setError("Could not start the microphone. Please try again.");
    }
  }, [clearTimers]);

  // Abort the engine on unmount so the mic is always released.
  useEffect(
    () => () => {
      clearTimers();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [clearTimers],
  );

  return {
    supported: supportedRef.current,
    listening,
    interimTranscript,
    finalTranscript,
    error,
    start,
    stop,
    reset,
  };
}
