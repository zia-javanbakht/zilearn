import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { dataDir, newId } from "./db";
import { providerName } from "./ai";
import { extractFile, guessKind, titleFromFilename } from "./extract";
import { deleteMaterial, findMaterialByHash, findMaterialByUrl, getMaterial, insertMaterial, listMaterials, updateMaterial } from "./store";
import { CAPTIONS, isJunk, isUnsupported, linkFromShortcut, MEDIA, mediaStem, SHORTCUT } from "./filetypes";
import { formatTranscript, parseCaptions } from "./transcript";
import { fetchYoutube, youtubeId, youtubeNote } from "./youtube";
import { MATERIAL_KINDS, type Material, type MaterialKind } from "./types";

/**
 * Importing files, whole folders and zip archives into a course. Folder structure is used as a hint:
 * a PDF inside "Tutorials/" becomes a tutorial, and a generic name like "notes.pdf" in "Week 3/"
 * is titled "Week 3 › notes". Files already in the course (same content) are skipped, so importing
 * the same folder again only adds what is new. Videos get their transcript from a captions file next
 * to them (.srt/.vtt with the same name) or are transcribed in the browser; saved YouTube links
 * (.url/.webloc shortcuts) are imported with the video's transcript.
 */

export const MAX_FILE = 150 * 1024 * 1024;
export const MAX_MEDIA = 1024 * 1024 * 1024; // lecture recordings are big; they are only stored, never parsed on the server
const MAX_LINK_BYTES = 30 * 1024 * 1024;

/** Largest file accepted for this name: recordings may be much bigger than documents. */
export function sizeLimit(name: string, mime = ""): number {
  return MEDIA.test(name) || /^(audio|video)\//.test(mime) ? MAX_MEDIA : MAX_FILE;
}

export function sizeLabel(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${bytes / 1024 ** 3} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}
const MAX_ZIP_ENTRIES = 1000;
const MAX_ZIP_BYTES = 1024 * 1024 * 1024; // uncompressed total, guards against zip bombs

export interface ImportResult {
  materials: Material[];
  skipped: { name: string; reason: string }[];
}

const FOLDER_HINTS: [RegExp, MaterialKind][] = [
  [/\b(past|sample|mock|practice)?\s*(exams?|papers?|midterms?|finals?|quizz?(es)?|tests?)\b/i, "sample_exam"],
  [/\btut(orial)?s?\b|\bproblem\s*sets?\b|\bexercises?\b/i, "tutorial"],
  [/\bworkshops?\b|\blabs?\b|\bpracticals?\b/i, "workshop"],
  [/\bslides?\b|\bdecks?\b|\bpresentations?\b/i, "slides"],
  [/\brecordings?\b|\baudio\b|\bmemos?\b|\bpodcasts?\b/i, "audio_memo"],
  [/\breadings?\b|\barticles?\b|\bpapers?\b|\bbooks?\b|\btextbooks?\b|\bchapters?\b/i, "reading"],
  [/\blectures?\b|\bnotes?\b|\bhandouts?\b/i, "lecture_notes"],
];

/** Kind from the file name, falling back to the nearest folder that says what's inside. */
export function kindFor(name: string, mime: string, relPath?: string | null): MaterialKind {
  const fromName = guessKind(name, mime);
  if (fromName !== "pdf" && fromName !== "other") return fromName;
  const folders = (relPath ?? "").replace(/\\/g, "/").split("/").slice(0, -1).reverse();
  for (const f of folders) for (const [re, kind] of FOLDER_HINTS) if (re.test(f.replace(/[_-]+/g, " "))) return kind;
  return fromName;
}

const GENERIC = /^(notes?|slides?|lecture( notes)?|tutorial|lab|workshop|solutions?|answers?|questions?|exam|quiz|handout|summary|readme|index|main|document|untitled|recording|audio|\d+)$/i;

/** Title from the file name; generic names get their folder as context. */
export function titleFor(name: string, relPath?: string | null): string {
  const base = titleFromFilename(name);
  const parent = (relPath ?? "").replace(/\\/g, "/").split("/").slice(0, -1).pop();
  return parent && GENERIC.test(base) ? `${titleFromFilename(parent)} › ${base}` : base;
}

const MIME: Record<string, string> = {
  pdf: "application/pdf", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  webm: "audio/webm", aac: "audio/aac", flac: "audio/flac", mp4: "video/mp4", mov: "video/quicktime", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain", md: "text/markdown", html: "text/html", htm: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function mimeFromName(name: string): string {
  return MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

function validKind(v: unknown): MaterialKind | null {
  return MATERIAL_KINDS.includes(v as MaterialKind) ? (v as MaterialKind) : null;
}

/** Store and read one file. */
export async function importFile(
  courseId: string,
  f: { name: string; mime: string; buf: Buffer; relPath?: string | null; kind?: unknown },
  result: ImportResult,
): Promise<void> {
  const label = f.relPath || f.name;
  if (f.relPath && isJunk(f.relPath)) return; // silently: nobody wants to hear about .DS_Store
  if (isUnsupported(f.name)) return void result.skipped.push({ name: label, reason: "not a study file" });
  const limit = sizeLimit(f.name, f.mime);
  if (f.buf.length > limit) return void result.skipped.push({ name: label, reason: `larger than ${sizeLabel(limit)}` });
  if (/\.zip$/i.test(f.name)) return importZip(courseId, f.name, f.buf, f.kind, result);
  if (!f.buf.length) return void result.skipped.push({ name: label, reason: "empty file" });
  if (SHORTCUT.test(f.name)) {
    const url = linkFromShortcut(f.buf.toString("utf8"));
    if (!url) return void result.skipped.push({ name: label, reason: "a shortcut without a web link" });
    const title = titleFor(f.name.replace(SHORTCUT, "").replace(/\s+-\s+YouTube$/i, ""), f.relPath);
    return importLink(courseId, url, { kind: f.kind, title, relPath: f.relPath, dedupe: true }, result);
  }
  if (CAPTIONS.test(f.name) && attachCaptions(courseId, f.name, f.buf.toString("utf8"), f.relPath, result)) return;

  const sha256 = crypto.createHash("sha256").update(f.buf).digest("hex");
  const dup = findMaterialByHash(courseId, sha256) ?? result.materials.find((m) => m.sha256 === sha256);
  if (dup) return void result.skipped.push({ name: label, reason: `already added as "${dup.title}"` });

  const mime = f.mime || mimeFromName(f.name);
  const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const rel = path.join("uploads", courseId, `${newId()}-${safe}`);
  await fs.mkdir(path.join(dataDir(), "uploads", courseId), { recursive: true });
  await fs.writeFile(path.join(dataDir(), rel), f.buf);
  const ex = CAPTIONS.test(f.name) ? captionsText(f.buf.toString("utf8"), f.name) : await extractFile(f.buf, f.name, mime);
  if (MEDIA.test(f.name) || /^(audio|video)\//.test(mime)) {
    // Captions imported before their video (e.g. "lecture.en.vtt" sorts ahead of "lecture.webm") become its transcript.
    const caps = siblings(courseId, f.relPath || f.name).find((m) => CAPTIONS.test(m.filename ?? ""));
    if (caps) {
      const full = getMaterial(caps.id);
      if (full?.text) Object.assign(ex, { text: full.text, status: "ready", note: `Transcript from the captions file ${caps.filename}.` });
      deleteMaterial(caps.id);
      result.materials = result.materials.filter((m) => m.id !== caps.id);
    }
  }
  const m = insertMaterial({
    course_id: courseId,
    kind: validKind(f.kind) ?? kindFor(f.name, mime, f.relPath),
    title: titleFor(f.name, f.relPath),
    source_type: "file",
    filename: f.name,
    mime: mime || null,
    path: rel,
    url: null,
    text: ex.text,
    status: ex.status,
    note: ex.note,
    sha256,
    rel_path: f.relPath || null,
    scan: "scan" in ex ? (ex.scan ?? null) : null,
  });
  result.materials.push({ ...m, sha256 });
}

function captionsText(raw: string, name: string): { text: string; status: "ready" | "partial"; note: string | null } {
  const text = formatTranscript(parseCaptions(raw));
  return text ? { text, status: "ready", note: `Captions from ${name}. [mm:ss] marks where each part is in the video.` } : { text: "", status: "partial", note: "This captions file has no text in it." };
}

/** Other materials in the course for the same recording (same folder and name, any extension). */
function siblings(courseId: string, relPathOrName: string): Material[] {
  const stem = mediaStem(relPathOrName);
  return listMaterials(courseId).filter((m) => m.source_type === "file" && mediaStem(m.rel_path || m.filename || "") === stem);
}

/**
 * A captions file whose video is already in the course becomes that video's transcript instead of a
 * separate material. Returns false when there is no such video (the captions are then kept on their own).
 */
function attachCaptions(courseId: string, name: string, raw: string, relPath: string | null | undefined, result: ImportResult): boolean {
  const video = siblings(courseId, relPath || name).find((m) => MEDIA.test(m.filename ?? "") || /^(audio|video)\//.test(m.mime ?? ""));
  if (!video) return false;
  const label = relPath || name;
  if (video.status === "ready") {
    result.skipped.push({ name: label, reason: `"${video.title}" already has a transcript` });
    return true;
  }
  const ex = captionsText(raw, name);
  if (!ex.text) {
    result.skipped.push({ name: label, reason: "no text in this captions file" });
    return true;
  }
  const updated = updateMaterial(video.id, { text: ex.text, note: `Transcript from the captions file ${name}.` });
  if (updated) {
    result.materials = result.materials.filter((m) => m.id !== video.id);
    result.materials.push(updated);
  }
  return true;
}

/** Read a response body, refusing anything larger than `limit` bytes. */
async function readLimited(r: Response, limit: number): Promise<Buffer> {
  if (Number(r.headers.get("content-length") ?? 0) > limit) throw new Error("file is too large to import from a link");
  if (!r.body) return Buffer.alloc(0);
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("file is too large to import from a link");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/**
 * Add a web link: a YouTube video (with its transcript when there is one) or any page or document,
 * whose text is fetched. `dedupe` skips links already in the course (used for folder imports).
 */
export async function importLink(
  courseId: string,
  url: string,
  opts: { kind?: unknown; title?: string; relPath?: string | null; dedupe?: boolean },
  result: ImportResult,
): Promise<void> {
  const label = opts.relPath || url;
  if (opts.dedupe) {
    const dup = findMaterialByUrl(courseId, url) ?? result.materials.find((m) => m.url === url);
    if (dup) return void result.skipped.push({ name: label, reason: `already added as "${dup.title}"` });
  }
  const base = { course_id: courseId, source_type: "url" as const, filename: null, mime: null, path: null, url, rel_path: opts.relPath || null };
  if (youtubeId(url)) {
    const yt = await fetchYoutube(url);
    result.materials.push(
      insertMaterial({
        ...base,
        kind: validKind(opts.kind) ?? "youtube",
        // A shortcut's file name is usually just the page title cut short; YouTube's own title is better.
        title: opts.relPath && yt.title !== "YouTube video" ? yt.title : opts.title?.trim() || yt.title,
        text: yt.transcript ?? "",
        status: yt.transcript ? "ready" : "partial",
        note: youtubeNote(yt, providerName()),
      }),
    );
    return;
  }
  let text = "";
  let title = opts.title?.trim() || url;
  let note: string | null = null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get("content-type") ?? "";
    const buf = await readLimited(r, MAX_LINK_BYTES);
    const name = new URL(url).pathname.split("/").pop() || "link";
    const ex = await extractFile(buf, ct.includes("html") ? `${name}.html` : name, ct.split(";")[0]);
    text = ex.text;
    note = ex.note;
    const t = buf.toString("utf8").match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    if (!opts.title && t) title = t[1].trim();
  } catch (err) {
    note = `Could not fetch this link (${err instanceof Error ? err.message : "error"}). Paste its content or your notes.`;
  }
  result.materials.push(insertMaterial({ ...base, kind: validKind(opts.kind) ?? "reading", title, text, status: text ? "ready" : "partial", note }));
}

/** Import every file in a zip (e.g. a course folder downloaded from a learning platform). */
export async function importZip(courseId: string, zipName: string, buf: Buffer, kind: unknown, result: ImportResult): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return void result.skipped.push({ name: zipName, reason: "not a readable zip file" });
  }
  const entries = Object.values(zip.files).filter((e) => !e.dir && !isJunk(e.name));
  if (entries.length > MAX_ZIP_ENTRIES) return void result.skipped.push({ name: zipName, reason: `more than ${MAX_ZIP_ENTRIES} files; unzip it and import the folder` });
  const root = titleFromFilename(zipName);
  let total = 0;
  for (const e of entries) {
    const name = e.name.split("/").pop()!;
    if (isUnsupported(name) || /\.zip$/i.test(name)) {
      result.skipped.push({ name: `${root}/${e.name}`, reason: /\.zip$/i.test(name) ? "zip inside a zip" : "not a study file" });
      continue;
    }
    const data = Buffer.from(await e.async("uint8array"));
    total += data.length;
    if (total > MAX_ZIP_BYTES) {
      result.skipped.push({ name: zipName, reason: "unpacks to more than 1 GB; the rest was skipped" });
      return;
    }
    await importFile(courseId, { name, mime: mimeFromName(name), buf: data, relPath: `${root}/${e.name}`, kind }, result);
  }
}
