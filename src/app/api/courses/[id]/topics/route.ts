import { addTopic, getCourse } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Add a topic by hand: { title, summary?, parent_id? }. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const b = await body<{ title?: string; summary?: string; parent_id?: string | null }>(req);
  const title = b.title?.trim();
  if (!title) return fail("A topic needs a name.");
  return ok(addTopic(id, { title: title.slice(0, 200), summary: b.summary?.trim().slice(0, 2000), parent_id: b.parent_id ?? null }), 201);
});
