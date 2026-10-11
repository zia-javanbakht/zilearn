import { completeTopicDepth, getTopic } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Mark a topic as studied to a level (from the lesson view). */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getTopic(id)) return fail("Not found", 404);
  const { depth } = await body<{ depth?: number }>(req);
  const d = Math.min(4, Math.max(1, Math.round(Number(depth) || 1)));
  return ok({ ticked: completeTopicDepth(id, d), depth: d });
});
