import { getMaterial } from "@/lib/store";
import { addBranch } from "@/lib/digest";
import { fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Add one material's topics to the course brainmap as a new branch, without rebuilding the whole map. */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const m = getMaterial(id);
  if (!m) return fail("Not found", 404);
  const r = addBranch(m);
  return "error" in r ? fail(r.error) : ok(r, 201);
});
