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

const CUE_TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->/;

/**
 * Read an .srt or .vtt captions file into timed chunks. Drops cue numbers, styling tags and the
 * repeated lines of "rolling" auto-captions (where each cue repeats the previous cue's last line).
 */
export function parseCaptions(raw: string): SpeechChunk[] {
  const out: SpeechChunk[] = [];
  let prev = new Set<string>();
  for (const block of raw.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => CUE_TIME.test(l));
    if (at < 0) continue;
    const [, h, m, s, ms] = lines[at].match(CUE_TIME)!;
    const start = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
    const text = lines
      .slice(at + 1)
      .map((l) => decodeEntities(l.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const fresh = text.filter((l) => !prev.has(l));
    prev = new Set(text);
    if (fresh.length) out.push({ start, end: null, text: fresh.join(" ") });
  }
  return out;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const STAMP = /\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/;

/** Whether a text has [mm:ss] markers to clean up. */
export function hasTimestamps(text: string | null | undefined): boolean {
  return STAMP.test(text ?? "");
}

/**
 * Remove [mm:ss] / [h:mm:ss] markers (and timestamp-only lines), keeping paragraphs and headings,
 * for reading a transcript as plain notes.
 */
export function stripTimestamps(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(new RegExp(`\\s*${STAMP.source}(?:\\s*[-–—:]\\s*${STAMP.source})?\\s*[-–—:]?\\s*`, "g"), " ").replace(/^(#+|[-*]|\d+\.)?\s+/, (m, mark) => (mark ? `${mark} ` : "")).trimEnd())
    .filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
