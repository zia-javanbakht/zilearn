import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { deleteRow, getPodcast } from "@/lib/store";
import { handle, ok, type Ctx } from "@/lib/http";

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const id = (await params).id;
  const p = getPodcast(id);
  if (p?.audio) await fs.rm(path.join(dataDir(), p.audio), { force: true });
  deleteRow("podcasts", id);
  return ok({ ok: true });
});
