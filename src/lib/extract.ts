import JSZip from "jszip";
import { markDisplayMaths } from "./mathLines";
import { aiEnabled, generateText, providerName } from "./ai";
import { findScannedPages, ocrLayerPages, pageList } from "./ocr";
import { fixMathGlyphs, isPoor, mathsHeavy, OCR_PRODUCER, pageQuality, pagesFromLines, pdfLines, wordCounts, type GlyphReport } from "./pdfText";
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

export { titleFromFilename } from "./text";

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
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
  // Lines with font sizes: running heads and page numbers dropped, larger lines marked as headings.
  const layered = await ocrLayerPages(pdf);
  const { pages: raw, running } = pagesFromLines(await pdfLines(pdf), { ocrPages: layered });
  const scan = await findScannedPages(pdf, raw);
  const meta = (await pdf.getMetadata().catch(() => null)) as { info?: { Producer?: string; Creator?: string } } | null;
  const scanner = OCR_PRODUCER.test(`${meta?.info?.Producer ?? ""} ${meta?.info?.Creator ?? ""}`);
  // Repair the whole document at once: a word spelled right on one page vouches for a fix on another.
  // Ligature slots are read before the symbol-font glyphs, which share some of their codes.
  const { text: rep, report } = repairText(joinPages(raw));
  const { text: repaired, report: glyphs } = fixMathGlyphs(rep);
  const pages = splitPages(repaired, raw.length);
  const scanned = new Set(scan.pages);
  const counts = wordCounts(repaired);
  const poor = pages.flatMap((p, i) => (!scanned.has(i + 1) && isPoor(pageQuality(p, counts), scanner || layered.has(i + 1)) ? [i + 1] : []));
  const maths = pages.flatMap((p, i) => (!scanned.has(i + 1) && mathsHeavy(raw[i]) ? [i + 1] : []));
  const fixes = [repairNote(report), glyphNote(glyphs, running)].filter(Boolean).join(" ");
  const info: ScanInfo = { pages: scan.pages, total: scan.total, ...(poor.length ? { poor } : {}), ...(maths.length ? { maths } : {}) };
  // Text guessed from a scan is never as good as reading the page itself: when the PDF came from scanning
  // software, every page goes to the AI, otherwise every page that carries an OCR layer.
  const ocred = pages.flatMap((_, i) => (!scanned.has(i + 1) && (scanner || layered.has(i + 1)) ? [i + 1] : []));
  const reread = [...new Set([...scan.pages, ...poor, ...maths, ...(aiEnabled() ? ocred : [])])].sort((a, b) => a - b);

  if (aiEnabled() && reread.length && buf.length < 30 * 1024 * 1024) {
    const read = await transcribePages(buf, reread);
    if (read.size) {
      const all = pages.map((p, i) => read.get(i + 1) ?? markDisplayMaths(p));
      const missed = reread.filter((n) => !read.has(n));
      const unreadScans = scan.pages.filter((n) => !read.has(n));
      const by = providerName();
      const what = [
        scan.pages.length ? `${scan.pages.length} scanned` : "",
        ocred.length ? `${ocred.length} with a scanned text layer` : poor.length ? `${poor.length} with a poor text layer` : "",
        maths.length ? `${maths.length} with equations` : "",
      ].filter(Boolean);
      return {
        text: all.join("\n\n").trim() ? joinPages(all) : "",
        status: unreadScans.length > scan.pages.length / 2 && scan.pages.length > raw.length / 2 ? "partial" : "ready",
        note: `${by} read ${read.size} page${read.size === 1 ? "" : "s"} from the PDF itself (${what.join(", ")}).${missed.length ? ` Pages ${pageList(missed)} couldn't be read this way and keep the PDF's own text.` : ""}${fixes ? ` ${fixes}` : ""}`,
        scan: { ...info, text_by: scan.pages.length ? "ai" : null, ai_pages: [...read.keys()].sort((a, b) => a - b) },
      };
    }
  }

  const notes: string[] = [];
  if (scan.pages.length) {
    const which = scan.pages.length === raw.length ? "This PDF is scanned pages (pictures without text)" : `Page${scan.pages.length === 1 ? "" : "s"} ${pageList(scan.pages)} ${scan.pages.length === 1 ? "is a picture" : "are pictures"} without text`;
    notes.push(`${which}. Use “Add text layer” to read ${scan.pages.length === 1 ? "it" : "them"} with OCR on this computer${aiEnabled() ? "" : ", or choose an AI provider in Settings to transcribe"}.`);
  }
  if (poor.length)
    notes.push(`The PDF's own text on page${poor.length === 1 ? "" : "s"} ${pageList(poor)} is a poor OCR layer, so words and equations there are garbled. ${aiEnabled() ? `“Read again” asks ${providerName()} to transcribe those pages from the PDF.` : "With an AI provider (Settings), “Read again” transcribes those pages from the PDF."}`);
  else if (maths.length >= 2) notes.push(`Equations on pages ${pageList(maths)} lose their layout in the PDF's text. ${aiEnabled() ? `“Read again” asks ${providerName()} to write them out as LaTeX.` : "With an AI provider (Settings), “Read again” writes them out as LaTeX."}`);
  if (fixes) notes.push(fixes);
  const textPages = raw.length - scan.pages.length;
  // Display equations marked as maths, so they aren't read as sentences.
  const t = repaired.replace(/^--- Page \d+ ---$/gm, "").trim() ? markDisplayMaths(repaired) : "";
  return {
    text: t,
    // A few pictured pages in a long document still leave plenty to study from.
    status: !t ? "partial" : textPages >= Math.max(1, raw.length / 2) ? "ready" : "partial",
    note: !t && !notes.length ? "No text found in this file." : notes.join(" ") || null,
    ...(scan.pages.length || poor.length || maths.length ? { scan: info } : {}),
  };
}

/** What the page cleanup did, for the material's note. */
function glyphNote(g: GlyphReport, running: number): string {
  const bits: string[] = [];
  if (running >= 3) bits.push("running headers and page numbers removed");
  if (g.mathpi || g.controls >= 3 || g.integrals) bits.push("maths symbols from the PDF's symbol fonts restored");
  return bits.length ? `${bits.join("; ").replace(/^./, (c) => c.toUpperCase())}.` : "";
}

/** Pages read per AI call: a page of dense maths is 1-2k tokens of LaTeX. */
const BATCH = 6;

/**
 * Transcribe some pages (1-based) from the PDF itself, a few per call, so a long maths-heavy document
 * fits. Returns the pages read; a batch that fails leaves its pages out.
 */
export async function transcribePages(buf: Buffer, pages: number[]): Promise<Map<number, string>> {
  const batches: number[][] = [];
  for (let i = 0; i < pages.length; i += BATCH) batches.push(pages.slice(i, i + BATCH));
  const out = new Map<number, string>();
  let next = 0;
  const work = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        const part = await pickPages(buf, batch);
        const { text: md } = await generateText({
          effort: "low",
          maxTokens: 16000,
          prompt: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.toString("base64") } },
            { type: "text", text: TRANSCRIBE(batch.length) },
          ],
        });
        const read = transcribedPages(md, batch.length);
        // Without page markers the answer can't be placed, unless there was only one page.
        if (read.length === 1 && batch.length > 1 && !/^\s*=+\s*Page/im.test(md)) continue;
        read.forEach((t, k) => {
          if (t.trim() && batch[k]) out.set(batch[k], t.trim());
        });
      } catch (err) {
        console.error("AI transcription of PDF pages failed", err);
      }
    }
  };
  await Promise.all([work(), work(), work()]);
  return out;
}

const TRANSCRIBE = (n: number) =>
  `Transcribe ${n === 1 ? "this page" : `these ${n} pages`} of a PDF into clean Markdown, so a student can learn from it. Start each page with a line "=== Page N ===" (N counts from 1 in this document).
- Headings as Markdown headings (# for the document title, ## for sections, ### below), with their numbers.
- Every equation in LaTeX: inline as $...$, display as $$...$$ on its own lines, keeping its number as \\tag{n}. Keep primes, bars, hats, tildes, transposes and inverses, bold vectors and tensors, and blackboard bold exactly as printed.
- Tables as Markdown tables, with their printed captions. For a figure, copy its printed caption word for word ("Figure 4. Illustration of …") on a line of its own, followed by a one-sentence description of what it shows in square brackets; don't copy the labels inside figures into the text.
- Leave out running headers and footers, page numbers, and line-end hyphens (join the word). In slides, also leave out the navigation (a sidebar or bar listing the sections, frame counters such as "3/6") and the furniture of title and section-divider slides (course code, lecturer, date, "Part I"): write only a heading for a divider.
- If the page is a scan, fix OCR errors from the context, but never invent what you can't read: write [unreadable] instead.
Output only the transcription.`;

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
  // Fixed dates, so the same pages give the same bytes (and can be cached) on every run.
  const epoch = new Date(0);
  out.setCreationDate(epoch);
  out.setModificationDate(epoch);
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
