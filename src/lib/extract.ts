import JSZip from "jszip";
import { aiEnabled, generateText, providerName } from "./ai";
import type { MaterialKind } from "./types";

export interface Extracted {
  text: string;
  status: "ready" | "partial" | "error";
  note: string | null;
}

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|webm|aac|flac|opus)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|avi)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|tex|rtf|py|java|c|cpp|js|ts|r|m|sql)$/i;

export function guessKind(filename: string, mime = ""): MaterialKind {
  const n = filename.toLowerCase();
  if (/(sample|past|mock|practice)?[\s_-]*(exam|midterm|final|paper|quiz|test)\b/.test(n) && !/notes?\b/.test(n)) return "sample_exam";
  if (/tutorial|\btut\d*\b/.test(n)) return "tutorial";
  if (/workshop|\blab\d*\b|practical/.test(n)) return "workshop";
  if (VIDEO_EXT.test(n) || mime.startsWith("video/")) return "video";
  if (AUDIO_EXT.test(n) || mime.startsWith("audio/")) return "audio_memo";
  if (/\.(pptx?|key|odp)$/.test(n) || /slides?|deck/.test(n)) return "slides";
  if (/notes?|lecture|handout|summary/.test(n)) return "lecture_notes";
  if (/reading|paper|article|chapter/.test(n)) return "reading";
  if (n.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  return "other";
}

export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractFile(buf: Buffer, filename: string, mime: string): Promise<Extracted> {
  const n = filename.toLowerCase();
  try {
    if (n.endsWith(".pdf") || mime === "application/pdf") return await extractPdf(buf);
    if (n.endsWith(".docx")) return await extractDocx(buf);
    if (n.endsWith(".pptx")) return await extractPptx(buf);
    if (n.endsWith(".html") || n.endsWith(".htm")) return ok(stripHtml(buf.toString("utf8")));
    if (TEXT_EXT.test(n) || mime.startsWith("text/")) return ok(buf.toString("utf8"));
    if (IMAGE_EXT.test(n) || mime.startsWith("image/")) return await extractImage(buf, mime || "image/png");
    if (AUDIO_EXT.test(n) || VIDEO_EXT.test(n) || mime.startsWith("audio/") || mime.startsWith("video/")) {
      return {
        text: "",
        status: "partial",
        note: "Recording saved. Use Transcribe to turn it into text on this device (nothing is uploaded), or paste your own notes.",
      };
    }
    return { text: "", status: "partial", note: "Unsupported file type. Add a description or notes for this item." };
  } catch (err) {
    return { text: "", status: "error", note: `Could not read this file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function ok(text: string): Extracted {
  const t = text.trim();
  return t ? { text: t, status: "ready", note: null } : { text: "", status: "partial", note: "No text found in this file." };
}

async function extractPdf(buf: Buffer): Promise<Extracted> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((p, i) => `--- Page ${i + 1} ---\n${p.trim()}`);
  const joined = pages.join("\n\n");
  const letters = joined.replace(/--- Page \d+ ---/g, "").replace(/\s/g, "").length;
  if (letters / Math.max(1, pages.length) > 80) return ok(joined);

  // Little or no embedded text: probably a scan. Claude can read the PDF directly.
  if (aiEnabled() && buf.length < 30 * 1024 * 1024) {
    const { text: md, truncated } = await generateText({
      effort: "low",
      maxTokens: 32000,
      prompt: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
        {
          type: "text",
          text: "Transcribe this document into clean Markdown. Keep headings, lists, equations (as LaTeX) and tables. Describe important diagrams in one or two sentences in [brackets]. Output only the transcription.",
        },
      ],
    });
    return truncated
      ? { text: md, status: "partial", note: `Scanned PDF transcribed by ${providerName()}, but it was too long to finish. Split the PDF for the rest.` }
      : { text: md, status: "ready", note: `Scanned PDF transcribed by ${providerName()}.` };
  }
  return { text: joined, status: "partial", note: "This PDF has little selectable text (likely scanned). Choose an AI provider in Settings to transcribe it, or paste notes." };
}

async function extractDocx(buf: Buffer): Promise<Extracted> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer: buf });
  return ok(res.value);
}

async function extractPptx(buf: Buffer): Promise<Extracted> {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => num(a) - num(b));
  const out: string[] = [];
  for (const f of slideFiles) {
    const xml = await zip.file(f)!.async("string");
    const paras = xml
      .split(/<\/a:p>/)
      .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(""))
      .map((s) => s.trim())
      .filter(Boolean);
    const n = num(f);
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    let notes = "";
    if (notesFile) {
      const nx = await notesFile.async("string");
      notes = [...nx.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(" ").trim();
    }
    if (!paras.length && !notes) continue;
    const [title, ...rest] = paras;
    out.push(`Slide ${n}: ${title ?? "(untitled)"}\n${rest.map((r) => `- ${r}`).join("\n")}${notes ? `\nSpeaker notes: ${notes}` : ""}`);
  }
  return ok(out.join("\n\n"));
}

async function extractImage(buf: Buffer, mime: string): Promise<Extracted> {
  if (!aiEnabled()) return { text: "", status: "partial", note: "Image saved. Choose an AI provider in Settings to read text from images, or type notes." };
  const media = (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime) ? mime : "image/png") as
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp";
  const { text: md } = await generateText({
    effort: "low",
    maxTokens: 8000,
    prompt: [
      { type: "image", source: { type: "base64", media_type: media, data: buf.toString("base64") } },
      { type: "text", text: "Transcribe all text in this image (e.g. handwritten notes, a whiteboard, a slide) into Markdown. Describe any diagram briefly in [brackets]. Output only the transcription." },
    ],
  });
  return { text: md, status: "ready", note: `Image transcribed by ${providerName()}.` };
}

function num(f: string) {
  return Number(f.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function stripHtml(html: string) {
  return decodeXml(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Turn a raw speech-recognition transcript into study notes with Claude. Keeps the [mm:ss] markers
 * so the student can jump back to the recording. Returns null when Claude isn't available or the
 * transcript is too long to rewrite in one pass (the raw transcript is kept then).
 */
export async function tidyTranscript(title: string, kind: string, raw: string): Promise<string | null> {
  if (!aiEnabled() || raw.length > 150_000) return null;
  const { text, truncated } = await generateText({
    effort: "low",
    maxTokens: 32000,
    context: `<transcript title="${title.replace(/"/g, "'")}" kind="${kind}">\n${raw}\n</transcript>`,
    prompt: `Above is an automatic speech-to-text transcript of a student's recording (a lecture, tutorial or voice memo). Rewrite it as clean study notes in Markdown:
- Fix obvious recognition errors using the context (technical terms, names, formulas). Write maths in LaTeX ($...$).
- Organise it under headings by topic, in the order it was said. Start each heading with the [mm:ss] marker where that part begins.
- Keep every substantive point, definition, example, and anything flagged as important or examinable ("this will be on the exam"). Drop filler, repetition and small talk.
- Do not add facts that are not in the recording.`,
  });
  return truncated || !text ? null : text;
}
