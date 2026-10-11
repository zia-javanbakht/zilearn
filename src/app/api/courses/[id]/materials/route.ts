import { importFile, importLink, sizeLabel, sizeLimit, type ImportResult } from "@/lib/importer";
import { getCourse, insertMaterial, listMaterials } from "@/lib/store";
import { fail, handle, ok, type Ctx } from "@/lib/http";
import { MATERIAL_KINDS, type MaterialKind } from "@/lib/types";

function kindOr(v: unknown, fallback: MaterialKind): MaterialKind {
  return MATERIAL_KINDS.includes(v as MaterialKind) ? (v as MaterialKind) : fallback;
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  return ok(listMaterials(id));
});

/**
 * Add materials. Accepts multipart form data (files[] with optional paths[] and kind) or JSON:
 *   { url, kind?, title? }   a YouTube or web link
 *   { text, title, kind? }   pasted notes
 */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id: courseId } = await params;
  if (!getCourse(courseId)) return fail("Course not found", 404);

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const kindOverride = form.get("kind");
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    // Folder imports send each file's path inside the folder, in the same order as the files.
    const paths = form.getAll("paths").map(String);
    if (!files.length) return fail("No files received.");
    const result: ImportResult = { materials: [], skipped: [] };
    for (const [i, file] of files.entries()) {
      // Chrome sends a folder file's path inside the folder as its name, so split it back apart.
      const name = file.name.split(/[\\/]/).pop() || file.name;
      const fullPath = paths[i] || (name !== file.name ? file.name : "");
      const relPath = fullPath && fullPath !== name ? fullPath.replace(/\\/g, "/").slice(0, 500) : null;
      if (file.size > sizeLimit(name, file.type)) {
        result.skipped.push({ name: relPath || name, reason: `larger than ${sizeLabel(sizeLimit(name, file.type))}` });
        continue;
      }
      await importFile(courseId, { name, mime: file.type, buf: Buffer.from(await file.arrayBuffer()), relPath, kind: kindOverride }, result);
    }
    return ok(result, 201);
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
    const result: ImportResult = { materials: [], skipped: [] };
    await importLink(courseId, url, { kind: b.kind, title: b.title }, result);
    return ok(result, 201);
  }
  if (b.text && b.text.trim()) {
    const m = insertMaterial({ course_id: courseId, kind: kindOr(b.kind, "lecture_notes"), title: b.title?.trim() || "Pasted notes", source_type: "text", filename: null, mime: null, path: null, url: null, text: b.text, status: "ready", note: null });
    return ok({ materials: [m], skipped: [] }, 201);
  }
  return fail("Send files, a url, or text.");
});
