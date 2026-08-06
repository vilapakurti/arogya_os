import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useSpeechSynthesis — browser speechSynthesis (text-to-speech).
 *
 * Reads assistant replies aloud with zero external APIs. Exposes a voice
 * selector (defaults to the browser voice), a language quick-picker that can
 * fall back to a language hint when no local voice exists, Play / Pause /
 * Resume / Stop controls, and speaking state for the "speaking" animation.
 * `speak` cancels any in-flight utterance first, so rapid consecutive replies
 * never overlap.
 *
 * Language support: when the user picks a language (e.g. hi-IN) but the
 * browser has no installed voice for it, the utterance still gets
 * `utterance.lang` set — Chromium/Edge will then synthesize through their
 * network voices for that language. This is how the Indian languages
 * (Hindi/Telugu/Tamil/Malayalam/Kannada) work on most machines.
 */

export interface SpeechSynthesisState {
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  voices: SpeechSynthesisVoice[];
  /** The selected voice, or null for the browser default. */
  voice: SpeechSynthesisVoice | null;
  /** BCP-47 language tag override used when no explicit voice is selected. */
  lang: string;
  setVoice: (voice: SpeechSynthesisVoice | null) => void;
  setLang: (lang: string) => void;
  /**
   * Picks the best voice for a BCP-47 tag (prefers Google network voices,
   * then exact tag, then primary-subtag match). If no voice exists for the
   * language, falls back to the language hint so the browser's TTS engine can
   * still try to synthesize in that language.
   */
  selectLanguage: (langTag: string) => void;
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
  const [lang, setLangState] = useState("");

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const langRef = useRef("");
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    voicesRef.current = voices;
  }, [voices]);

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
      // Without an explicit voice, honor the language quick-picker. Setting
      // lang alone lets Chrome/Edge use a network voice for that language.
      if (!voiceRef.current && langRef.current) utterance.lang = langRef.current;
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

  /** Choosing an explicit voice overrides any language-only selection. */
  const setVoice = useCallback((next: SpeechSynthesisVoice | null) => {
    setVoiceState(next);
    setLangState("");
  }, []);

  const setLang = useCallback((next: string) => {
    setLangState(next);
  }, []);

  const selectLanguage = useCallback((langTag: string) => {
    const tag = langTag.trim();
    if (!tag) {
      setVoiceState(null);
      setLangState("");
      return;
    }
    const primary = tag.split("-")[0].toLowerCase();
    const available =
      typeof window !== "undefined" && window.speechSynthesis
        ? window.speechSynthesis.getVoices()
        : voicesRef.current;
    const list = available && available.length > 0 ? available : voicesRef.current;

    // Prefer a Google (network) voice for the language, then an exact BCP-47
    // match, then any voice with the same primary subtag.
    const googleMatch = list.find(
      (v) => v.lang.toLowerCase().split("-")[0] === primary && /google|neural/i.test(v.name),
    );
    const exact = list.find((v) => v.lang.toLowerCase() === tag.toLowerCase());
    const primaryMatch = list.find(
      (v) => v.lang.toLowerCase().split("-")[0] === primary,
    );
    const best = googleMatch ?? exact ?? primaryMatch ?? null;

    setVoiceState(best);
    // No installed voice for this language → keep the tag as a lang hint so
    // the browser can still try a network voice.
    setLangState(best ? "" : tag);
  }, []);

  return {
    supported,
    speaking,
    paused,
    voices,
    voice,
    lang,
    setVoice,
    setLang,
    selectLanguage,
    speak,
    pause,
    resume,
    stop,
  };
}
