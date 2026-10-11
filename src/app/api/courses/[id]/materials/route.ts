import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, newId } from "@/lib/db";
import { extractFile, guessKind, titleFromFilename } from "@/lib/extract";
import { fetchYoutube, youtubeId } from "@/lib/youtube";
import { getCourse, insertMaterial, listMaterials } from "@/lib/store";
import { fail, handle, ok, type Ctx } from "@/lib/http";
import { MATERIAL_KINDS, type Material, type MaterialKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILE = 150 * 1024 * 1024;
const MAX_LINK_BYTES = 30 * 1024 * 1024;

/** Read a response body, refusing anything larger than `limit` bytes. */
async function readLimited(r: Response, limit: number): Promise<Buffer> {
  const declared = Number(r.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error("file is too large to import from a link");
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

function kindOr(v: unknown, fallback: MaterialKind): MaterialKind {
  return MATERIAL_KINDS.includes(v as MaterialKind) ? (v as MaterialKind) : fallback;
}

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  return ok(listMaterials(id));
});

/**
 * Add materials. Accepts multipart form data (files[] plus optional kind) or JSON:
 *   { url, kind?, title? }   a YouTube or web link
 *   { text, title, kind? }   pasted notes
 */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id: courseId } = await params;
  if (!getCourse(courseId)) return fail("Course not found", 404);
  const created: Material[] = [];

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const kindOverride = form.get("kind");
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (!files.length) return fail("No files received.");
    for (const file of files) {
      if (file.size > MAX_FILE) {
        created.push(insertMaterial(stub(courseId, file.name, "File is larger than 150 MB and was skipped.")));
        continue;
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
      const rel = path.join("uploads", courseId, `${newId()}-${safe}`);
      await fs.mkdir(path.join(dataDir(), "uploads", courseId), { recursive: true });
      await fs.writeFile(path.join(dataDir(), rel), buf);
      const ex = await extractFile(buf, file.name, file.type);
      created.push(
        insertMaterial({
          course_id: courseId,
          kind: kindOr(kindOverride, guessKind(file.name, file.type)),
          title: titleFromFilename(file.name),
          source_type: "file",
          filename: file.name,
          mime: file.type || null,
          path: rel,
          url: null,
          text: ex.text,
          status: ex.status,
          note: ex.note,
        }),
      );
    }
    return ok(created, 201);
  }

  const b = (await req.json().catch(() => ({}))) as { url?: string; text?: string; title?: string; kind?: string };
  if (b.url) {
    const url = b.url.trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail("That doesn't look like a valid link.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("Only http and https links are supported.");
    if (youtubeId(url)) {
      const yt = await fetchYoutube(url);
      created.push(
        insertMaterial({
          course_id: courseId,
          kind: kindOr(b.kind, "youtube"),
          title: b.title?.trim() || yt.title,
          source_type: "url",
          filename: null,
          mime: null,
          path: null,
          url,
          text: yt.transcript ?? "",
          status: yt.transcript ? "ready" : "partial",
          note: yt.transcript ? `Transcript imported${yt.author ? ` (channel: ${yt.author})` : ""}.` : "No transcript available. Paste a summary or your notes for this video.",
        }),
      );
    } else {
      let text = "";
      let title = b.title?.trim() || url;
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
        if (!b.title && t) title = t[1].trim();
      } catch (err) {
        note = `Could not fetch this link (${err instanceof Error ? err.message : "error"}). Paste its content or your notes.`;
      }
      created.push(
        insertMaterial({ course_id: courseId, kind: kindOr(b.kind, "reading"), title, source_type: "url", filename: null, mime: null, path: null, url, text, status: text ? "ready" : "partial", note }),
      );
    }
    return ok(created, 201);
  }
  if (b.text && b.text.trim()) {
    created.push(
      insertMaterial({ course_id: courseId, kind: kindOr(b.kind, "lecture_notes"), title: b.title?.trim() || "Pasted notes", source_type: "text", filename: null, mime: null, path: null, url: null, text: b.text, status: "ready", note: null }),
    );
    return ok(created, 201);
  }
  return fail("Send files, a url, or text.");
});

function stub(courseId: string, name: string, note: string): Omit<Material, "id" | "created_at"> {
  return { course_id: courseId, kind: guessKind(name), title: titleFromFilename(name), source_type: "file", filename: name, mime: null, path: null, url: null, text: "", status: "error", note };
}
