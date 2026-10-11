"use client";

import { api } from "./api";
import { formatTranscript, mixToMono, type SpeechChunk } from "@/lib/transcript";
import type { Material } from "@/lib/types";

export const WHISPER_MODELS = {
  "Xenova/whisper-tiny": "Fastest (tiny, ~40 MB download)",
  "Xenova/whisper-base": "Balanced (base, ~80 MB)",
  "Xenova/whisper-small": "Most accurate (small, ~250 MB, slow without a GPU)",
} as const;

export interface TranscribeSettings {
  model: keyof typeof WHISPER_MODELS;
  language: string; // "" = detect automatically
  tidy: boolean; // ask Claude to turn the raw transcript into notes
  auto: boolean; // transcribe new recordings as soon as they are added
}

export const DEFAULT_SETTINGS: TranscribeSettings = { model: "Xenova/whisper-base", language: "", tidy: true, auto: true };
const KEY = "zilearn:transcribe";

export function loadSettings(): TranscribeSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: TranscribeSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export type Progress =
  | { phase: "decoding" }
  | { phase: "loading"; progress: number }
  | { phase: "transcribing"; done: number; total: number }
  | { phase: "saving" };

export function describeProgress(p: Progress): string {
  if (p.phase === "decoding") return "Reading the recording…";
  if (p.phase === "loading") return `Downloading the speech model (first time only)… ${Math.round(p.progress)}%`;
  if (p.phase === "transcribing") return p.total > 1 ? `Transcribing part ${Math.min(p.done + 1, p.total)} of ${p.total}…` : "Transcribing…";
  return "Saving the transcript…";
}

const RATE = 16000;
let worker: Worker | null = null;
let seq = 0;

/** Decode any audio (or video) file the browser can play into 16 kHz mono samples. */
async function decode(buf: ArrayBuffer): Promise<Float32Array> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: RATE });
  try {
    const audio = await ctx.decodeAudioData(buf);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    // Copy a single channel: the worker takes ownership of the buffer, which an AudioBuffer can't give away.
    return channels.length === 1 ? channels[0].slice() : mixToMono(channels);
  } finally {
    ctx.close().catch(() => {});
  }
}

function recognise(audio: Float32Array, s: TranscribeSettings, onProgress: (p: Progress) => void): Promise<SpeechChunk[]> {
  worker ??= new Worker("/whisper-worker.js", { type: "module" });
  const id = ++seq;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "status") onProgress(m.phase === "loading" ? { phase: "loading", progress: m.progress ?? 0 } : { phase: "transcribing", done: m.done, total: m.total });
      else {
        w.removeEventListener("message", onMessage);
        if (m.type === "result") resolve(m.chunks);
        else reject(new Error(`Transcription failed: ${m.message}`));
      }
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ type: "run", id, model: s.model, audio, language: s.language || undefined }, [audio.buffer]);
  });
}

/** Transcribe a stored recording on this device and save the text to the material. */
export async function transcribeMaterial(m: Pick<Material, "id" | "title">, s: TranscribeSettings, onProgress: (p: Progress) => void): Promise<Material> {
  onProgress({ phase: "decoding" });
  const res = await fetch(`/api/materials/${m.id}/file`);
  if (!res.ok) throw new Error("Could not load the recording.");
  let audio: Float32Array;
  try {
    audio = await decode(await res.arrayBuffer());
  } catch {
    throw new Error("This browser can't decode that recording. Try converting it to MP3 or WAV.");
  }
  const chunks = await recognise(audio, s, onProgress);
  const text = formatTranscript(chunks);
  if (!text) throw new Error("No speech was found in this recording.");
  onProgress({ phase: "saving" });
  return api<Material>(`/api/materials/${m.id}`, { method: "PATCH", json: { text, transcript: true, tidy: s.tidy } });
}

export function isRecording(m: Pick<Material, "mime" | "filename">): boolean {
  return /^(audio|video)\//.test(m.mime ?? "") || /\.(mp3|m4a|wav|ogg|oga|webm|aac|flac|opus|mp4|mov|m4v)$/i.test(m.filename ?? "");
}
