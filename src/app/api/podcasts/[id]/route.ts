import { deleteRow } from "@/lib/store";
import { handle, ok, type Ctx } from "@/lib/http";

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  deleteRow("podcasts", (await params).id);
  return ok({ ok: true });
});
