import { aiEnabled, provider, transcribeVideoUrl } from "./ai";
import { decodeEntities, formatTranscript, type SpeechChunk } from "./transcript";

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?]+)/);
      if (m) return m[2];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export interface YoutubeInfo {
  title: string;
  author: string | null;
  transcript: string | null;
  /** Where the transcript came from, for the note shown under the material. */
  source: "captions" | "auto-captions" | "ai" | null;
  language: string | null;
}

interface Track {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

const HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  // Skips the EU cookie-consent interstitial, which has no captions in it.
  cookie: "CONSENT=YES+cb; SOCS=CAI",
};

const get = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...HEADERS, ...init.headers }, signal: AbortSignal.timeout(15000) });

/** Caption tracks for a video: the player API first (what YouTube's apps use), then the watch page as a fallback. */
async function captionTracks(id: string): Promise<Track[]> {
  const page = await get(`https://www.youtube.com/watch?v=${id}&hl=en`).then((r) => r.text());
  const key = page.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/)?.[1];
  if (key) {
    try {
      const r = await get(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } }, videoId: id }),
      });
      const j = (await r.json()) as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } } };
      const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length) return tracks;
    } catch {
      /* fall through to the page */
    }
  }
  const m = page.match(/"captionTracks":(\[.*?\])/);
  return m ? (JSON.parse(m[1]) as Track[]) : [];
}

/** Prefer captions written by a person, in English, then English auto-captions, then anything. */
export function pickTrack(tracks: Track[]): Track | undefined {
  const en = (t: Track) => t.languageCode.toLowerCase().startsWith("en");
  const human = (t: Track) => t.kind !== "asr";
  return tracks.find((t) => en(t) && human(t)) ?? tracks.find(en) ?? tracks.find(human) ?? tracks[0];
}

/** YouTube's timed-text XML, either the classic <text start dur> form or the newer <p t d> form (milliseconds). */
export function parseTimedText(xml: string): SpeechChunk[] {
  const out: SpeechChunk[] = [];
  for (const m of xml.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>|<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const start = m[1] !== undefined ? Number(m[1]) : Number(m[3]) / 1000;
    // Entities are sometimes encoded twice (&amp;#39;), so decode, strip tags, decode again.
    const text = decodeEntities(decodeEntities(m[2] ?? m[4]).replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push({ start, end: null, text });
  }
  return out;
}

/**
 * Title and transcript of a YouTube video. Uses the video's captions when it has any; otherwise, when
 * Gemini is the AI provider, asks Gemini to transcribe the video (it can watch public YouTube links).
 * Best-effort: every step can fail offline or when YouTube changes, and the material is still added.
 */
export async function fetchYoutube(url: string): Promise<YoutubeInfo> {
  const id = youtubeId(url);
  const info: YoutubeInfo = { title: "YouTube video", author: null, transcript: null, source: null, language: null };
  try {
    const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (r.ok) {
      const j = (await r.json()) as { title?: string; author_name?: string };
      info.title = j.title ?? info.title;
      info.author = j.author_name ?? null;
    }
  } catch {
    /* offline */
  }
  if (!id) return info;
  try {
    const track = pickTrack(await captionTracks(id));
    if (track) {
      const xml = await get(track.baseUrl.replace(/&fmt=[^&]*/, "")).then((r) => r.text());
      const text = formatTranscript(parseTimedText(xml));
      if (text) Object.assign(info, { transcript: text, source: track.kind === "asr" ? "auto-captions" : "captions", language: track.languageCode });
    }
  } catch {
    /* captions unavailable */
  }
  if (!info.transcript && aiEnabled() && provider() === "gemini") {
    try {
      const text = await transcribeVideoUrl(`https://www.youtube.com/watch?v=${id}`);
      if (text) Object.assign(info, { transcript: text, source: "ai" });
    } catch (err) {
      console.error("Gemini could not transcribe the video", err);
    }
  }
  return info;
}

/** The note shown under a YouTube material, saying where its text came from. */
export function youtubeNote(yt: YoutubeInfo, aiName: string): string {
  const by = yt.author ? ` Channel: ${yt.author}.` : "";
  const lang = yt.language && !yt.language.startsWith("en") ? ` (language: ${yt.language})` : "";
  if (yt.source === "captions") return `Transcript imported from the video's captions${lang}.${by}`;
  if (yt.source === "auto-captions") return `Transcript imported from YouTube's automatic captions${lang}, so expect some recognition errors.${by}`;
  if (yt.source === "ai") return `This video has no captions, so ${aiName} watched it and wrote the transcript.${by}`;
  return `No transcript available for this video. Use "Try again" later, or paste a summary or your notes.${by}`;
}
