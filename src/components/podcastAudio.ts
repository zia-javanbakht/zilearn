"use client";

import type { Podcast } from "@/lib/types";
import { api } from "./api";

/** Open-weight Kokoro voices that sound good together (American English). */
export const VOICES = {
  af_heart: "Heart (female)",
  af_bella: "Bella (female)",
  am_michael: "Michael (male)",
  am_fenrir: "Fenrir (male)",
  bf_emma: "Emma (British female)",
  bm_george: "George (British male)",
} as const;
export type Voice = keyof typeof VOICES;

export type RecordProgress =
  | { phase: "loading"; progress: number }
  | { phase: "speaking"; done: number; total: number }
  | { phase: "encoding" }
  | { phase: "saving" };

export function describeRecordProgress(p: RecordProgress): string {
  if (p.phase === "loading") return `Downloading the voice model (first time only)… ${Math.round(p.progress)}%`;
  if (p.phase === "speaking") return `Recording line ${Math.min(p.done + 1, p.total)} of ${p.total}…`;
  if (p.phase === "encoding") return "Encoding the MP3…";
  return "Saving…";
}

let worker: Worker | null = null;
let seq = 0;

/** Read the script aloud with neural voices on this device, encode an MP3 and store it with the episode. */
export async function recordPodcast(
  p: Podcast,
  voices: { A: Voice; B: Voice },
  onProgress: (x: RecordProgress) => void,
): Promise<Podcast> {
  worker ??= new Worker("/tts-worker.js", { type: "module" });
  const w = worker;
  const id = ++seq;
  const { mp3, marks } = await new Promise<{ mp3: ArrayBuffer; marks: number[] }>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "status") onProgress(m);
      else {
        w.removeEventListener("message", onMessage);
        if (m.type === "result") resolve(m);
        else reject(new Error(`Recording failed: ${m.message}`));
      }
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ type: "run", id, segments: p.segments, voices });
  });
  onProgress({ phase: "saving" });
  const fd = new FormData();
  fd.append("audio", new File([mp3], "episode.mp3", { type: "audio/mpeg" }));
  fd.append("marks", JSON.stringify(marks));
  return api<Podcast>(`/api/podcasts/${p.id}/audio`, { method: "PUT", body: fd });
}

/** Which segment is playing at `t` seconds, given each segment's start time. */
export function segmentAt(marks: number[], t: number): number {
  let lo = 0;
  let hi = marks.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
