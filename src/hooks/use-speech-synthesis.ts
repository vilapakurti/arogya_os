import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useSpeechSynthesis — browser speechSynthesis (text-to-speech).
 *
 * Reads assistant replies aloud with zero external APIs. Exposes a voice
 * selector (defaults to the browser voice), Play / Pause / Resume / Stop
 * controls, and speaking state for the "speaking" animation. `speak` cancels
 * any in-flight utterance first, so rapid consecutive replies never overlap.
 */

export interface SpeechSynthesisState {
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  voices: SpeechSynthesisVoice[];
  /** The selected voice, or null for the browser default. */
  voice: SpeechSynthesisVoice | null;
  setVoice: (voice: SpeechSynthesisVoice | null) => void;
  speak: (text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

const MAX_SPEAK_CHARS = 2400; // trim long replies so the reader doesn't stall

function isSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function useSpeechSynthesis(): SpeechSynthesisState {
  const supported = isSupported();
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoiceState] = useState<SpeechSynthesisVoice | null>(null);

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  /* Voices load asynchronously in most browsers. */
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      const synth = window.speechSynthesis;
      const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_SPEAK_CHARS);
      if (!clean) return;

      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.05;
      utterance.pitch = 1;
      utterance.voice = voiceRef.current;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setPaused(false);
      setSpeaking(true);
      synth.speak(utterance);
    },
    [supported],
  );

  const pause = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, [supported]);

  const resume = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }, [supported]);

  const setVoice = useCallback((next: SpeechSynthesisVoice | null) => {
    setVoiceState(next);
  }, []);

  return { supported, speaking, paused, voices, voice, setVoice, speak, pause, resume, stop };
}
