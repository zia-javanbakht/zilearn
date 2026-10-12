import JSZip from "jszip";
import { aiEnabled, generateText, providerName } from "./ai";
import { findScannedPages, pageList } from "./ocr";
import { repairNote, repairText } from "./textRepair";
import type { MaterialKind, ScanInfo } from "./types";

export interface Extracted {
  text: string;
  status: "ready" | "partial" | "error";
  note: string | null;
  scan?: ScanInfo;
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
    if (n.endsWith(".html") || n.endsWith(".htm")) return repaired(stripHtml(buf.toString("utf8")));
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

/** Text with extraction damage repaired, saying what was fixed. */
function repaired(text: string): Extracted {
  const { text: fixed, report } = repairText(text);
  return withNote(ok(fixed), repairNote(report));
}

function ok(text: string): Extracted {
  const t = text.trim();
  return t ? { text: t, status: "ready", note: null } : { text: "", status: "partial", note: "No text found in this file." };
}

async function extractPdf(buf: Buffer): Promise<Extracted> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const raw = (Array.isArray(text) ? text : [text]).map((p) => p.trim());
  const scan = await findScannedPages(pdf, raw);
  // Repair the whole document at once: a word spelled right on one page vouches for a fix on another.
  const { text: repaired, report } = repairText(joinPages(raw));
  const pages = splitPages(repaired, raw.length);
  const fixed = repairNote(report);
  if (!scan.pages.length) return withNote(ok(repaired), fixed);

  const scanned = new Set(scan.pages);
  const textPages = raw.length - scan.pages.length;
  const which = scan.pages.length === raw.length ? "This PDF is scanned pages (pictures without text)" : `Page${scan.pages.length === 1 ? "" : "s"} ${pageList(scan.pages)} ${scan.pages.length === 1 ? "is a picture" : "are pictures"} without text`;
  // Little or no embedded text: the AI can read the pages directly.
  if (aiEnabled() && buf.length < 30 * 1024 * 1024) {
    try {
      const part = scan.pages.length === raw.length ? buf : await pickPages(buf, scan.pages);
      const { text: md, truncated } = await generateText({
        effort: "low",
        maxTokens: 32000,
        prompt: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.toString("base64") } },
          {
            type: "text",
            text: `Transcribe this document into clean Markdown. Start each page with a line "=== Page N ===" (N counts from 1 in this document). Keep headings, lists, equations (as LaTeX) and tables. Describe important diagrams in one or two sentences in [brackets]. Spell words correctly where the scan is hard to read, using the context. Output only the transcription.`,
          },
        ],
      });
      const read = transcribedPages(md, scan.pages.length);
      const all = pages.map((p, i) => (scanned.has(i + 1) ? (read[scan.pages.indexOf(i + 1)] ?? "") : p));
      const result = repairText(joinPages(all)).text;
      const by = providerName();
      return {
        text: result,
        status: truncated ? "partial" : "ready",
        note: truncated
          ? `${which}; ${by} read them but the PDF was too long to finish. Split it for the rest, or add a text layer.`
          : `${which}; ${by} read ${scan.pages.length === 1 ? "it" : "them"}. Add a text layer to make the PDF itself searchable.`,
        scan: { ...scan, text_by: "ai" },
      };
    } catch (err) {
      console.error("AI transcription of scanned pages failed", err);
    }
  }
  return {
    text: repaired,
    // A few pictured pages in a long document still leave plenty to study from.
    status: textPages >= Math.max(1, raw.length / 2) ? "ready" : "partial",
    note: `${which}. Use “Add text layer” to read ${scan.pages.length === 1 ? "it" : "them"} with OCR on this computer${aiEnabled() ? "" : ", or choose an AI provider in Settings to transcribe"}.${fixed ? ` ${fixed}` : ""}`,
    scan,
  };
}

const PAGE = /^--- Page (\d+) ---$/m;

export function joinPages(pages: string[]): string {
  return pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join("\n\n");
}

/** The pages of a text made by joinPages (after editing it), `n` of them. */
export function splitPages(text: string, n: number): string[] {
  const out = Array.from({ length: n }, () => "");
  const parts = text.split(new RegExp(PAGE.source, "m"));
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const k = Number(parts[i]) - 1;
    if (k >= 0 && k < n) out[k] = parts[i + 1].trim();
  }
  return out;
}

/** An AI transcription cut at its "=== Page N ===" lines; without them, all of it is the first page. */
function transcribedPages(md: string, n: number): string[] {
  const parts = md.split(/^\s*=+\s*Page\s+(\d+)\s*=+\s*$/im);
  if (parts.length < 3) return [md.trim()];
  const out: string[] = Array.from({ length: n }, () => "");
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const k = Number(parts[i]) - 1;
    if (k >= 0 && k < n) out[k] = (out[k] ? out[k] + "\n\n" : "") + parts[i + 1].trim();
  }
  return out;
}

/** A PDF of just these pages (1-based), to send only the scanned ones to the AI. */
async function pickPages(buf: Buffer, pages: number[]): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, pages.map((n) => n - 1))) out.addPage(p);
  return Buffer.from(await out.save());
}

function withNote(e: Extracted, note: string | null): Extracted {
  return note && e.status === "ready" ? { ...e, note: e.note ? `${e.note} ${note}` : note } : e;
}

async function extractDocx(buf: Buffer): Promise<Extracted> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer: buf });
  return repaired(res.value);
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
  return repaired(out.join("\n\n"));
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
  return { text: repairText(md).text, status: "ready", note: `Image transcribed by ${providerName()}.` };
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
