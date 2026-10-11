import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { getMaterial } from "@/lib/store";
import { fail, handle, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const m = getMaterial((await params).id);
  if (!m?.path) return fail("No file", 404);
  const full = path.resolve(dataDir(), m.path);
  if (!full.startsWith(path.resolve(dataDir()))) return fail("Bad path", 400);
  const buf = await fs.readFile(full);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": m.mime || "application/octet-stream",
      "content-disposition": `inline; filename="${encodeURIComponent(m.filename ?? "file")}"`,
    },
  });
});
