import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { getMaterial } from "@/lib/store";
import { fail, handle, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

// Only types the browser renders without running scripts are shown inline.
const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|audio\/|video\/|text\/plain)/;

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const m = getMaterial((await params).id);
  if (!m?.path) return fail("No file", 404);
  const root = path.resolve(dataDir());
  const full = path.resolve(root, m.path);
  if (!full.startsWith(root + path.sep)) return fail("Bad path", 400);
  const buf = await fs.readFile(full).catch(() => null);
  if (!buf) return fail("File is missing on disk", 404);
  const mime = m.mime || "application/octet-stream";
  const inline = INLINE.test(mime);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": inline ? mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(m.filename ?? "file")}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
});
