/** Helpers for turning speech-recognition output into readable, searchable text. Pure (used in the browser and tests). */

export interface SpeechChunk {
  start: number; // seconds
  end: number | null;
  text: string;
}

// Whisper emits these for silence or music; they are noise in study notes.
const NOISE = /^\s*[\[(](?:blank_audio|music|silence|applause|laughter|inaudible|no speech)[\])]\s*$/i;

export function stamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/**
 * Join chunks into paragraphs of roughly `paragraphSec` seconds, each starting with a [mm:ss] marker
 * so the student can find the spot in the recording. Drops noise tags and Whisper's repeated-line loops.
 */
export function formatTranscript(chunks: SpeechChunk[], paragraphSec = 60): string {
  const paras: string[] = [];
  let current: string[] = [];
  let paraStart = 0;
  let last = "";
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text || NOISE.test(text)) continue;
    if (text === last) continue;
    last = text;
    if (!current.length) paraStart = c.start;
    else if (
      // Break at a sentence end once a paragraph is long enough, or anyway if it runs far too long.
      (c.start - paraStart >= paragraphSec && /[.!?]["')]?$/.test(current[current.length - 1])) ||
      c.start - paraStart >= paragraphSec * 2
    ) {
      paras.push(`[${stamp(paraStart)}] ${current.join(" ")}`);
      current = [];
      paraStart = c.start;
    }
    current.push(text);
  }
  if (current.length) paras.push(`[${stamp(paraStart)}] ${current.join(" ")}`);
  return paras.join("\n\n");
}

/** Average channels into one (speech recognition wants mono). */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}
