import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { deleteMaterial, getMaterial, updateMaterial } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const m = getMaterial((await params).id);
  return m ? ok(m) : fail("Not found", 404);
});

export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const b = await body<{ title?: string; kind?: string; text?: string }>(req);
  const m = updateMaterial((await params).id, b);
  return m ? ok(m) : fail("Not found", 404);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const m = getMaterial(id);
  if (m?.path) await fs.rm(path.join(dataDir(), m.path), { force: true });
  deleteMaterial(id);
  return ok({ ok: true });
});
