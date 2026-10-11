import { generateLesson } from "@/lib/generate";
import { getLesson, saveLesson } from "@/lib/store";
import { handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function depthOf(req: Request) {
  const d = Number(new URL(req.url).searchParams.get("depth") ?? 1);
  return Math.min(4, Math.max(1, Number.isFinite(d) ? Math.round(d) : 1));
}

/** Get the lesson for a topic at a depth, generating it the first time. */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const depth = depthOf(req);
  const cached = getLesson(id, depth);
  if (cached) return ok({ ...cached, depth });
  const { content, by } = await generateLesson(id, depth);
  saveLesson(id, depth, content, by);
  return ok({ content, generated_by: by, depth });
});

/** Regenerate. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const depth = depthOf(req);
  const { content, by } = await generateLesson(id, depth);
  saveLesson(id, depth, content, by);
  return ok({ content, generated_by: by, depth });
});
