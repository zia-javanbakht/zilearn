import { setPlanItemDone } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const b = await body<{ done?: boolean }>(req);
  const item = setPlanItemDone((await params).id, Boolean(b.done));
  return item ? ok(item) : fail("Not found", 404);
});
