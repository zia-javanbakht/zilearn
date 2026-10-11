import { stripHtml } from "./extract";

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?]+)/);
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
}

/** Fetch title and (when captions exist) the transcript of a YouTube video. Best-effort. */
export async function fetchYoutube(url: string): Promise<YoutubeInfo> {
  const id = youtubeId(url);
  let title = "YouTube video";
  let author: string | null = null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const j = (await r.json()) as { title?: string; author_name?: string };
      title = j.title ?? title;
      author = j.author_name ?? null;
    }
  } catch {
    /* offline */
  }
  let transcript: string | null = null;
  if (id) {
    try {
      const page = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
        headers: { "accept-language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(15000),
      }).then((r) => r.text());
      const m = page.match(/"captionTracks":(\[.*?\])/);
      if (m) {
        const tracks = JSON.parse(m[1]) as { baseUrl: string; languageCode: string; kind?: string }[];
        const track = tracks.find((t) => t.languageCode.startsWith("en") && t.kind !== "asr") ?? tracks.find((t) => t.languageCode.startsWith("en")) ?? tracks[0];
        if (track) {
          const xml = await fetch(track.baseUrl, { signal: AbortSignal.timeout(15000) }).then((r) => r.text());
          const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((x) => stripHtml(x[1]).trim());
          transcript = lines.join(" ").replace(/\s+/g, " ").trim() || null;
        }
      }
    } catch {
      /* captions unavailable */
    }
  }
  return { title, author, transcript };
}
