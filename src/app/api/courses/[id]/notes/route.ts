import { generateNotes, parseScope } from "@/lib/generate";
import { getCourse, listNotes, saveNote } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => ok(listNotes((await params).id)));

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const b = await body<{ scope?: unknown; style?: string }>(req);
  const style = b.style === "detailed" || b.style === "cheatsheet" ? b.style : "concise";
  const n = await generateNotes(id, parseScope(b.scope), style);
  return ok(saveNote({ course_id: id, title: n.title, scope: n.scope, content: n.content, generated_by: n.by }), 201);
});
