import { generateExam, parseScope } from "@/lib/generate";
import { getCourse, listExams, saveExam } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => ok(listExams((await params).id)));

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const b = await body<{ scope?: unknown; questionCount?: number; mix?: { mcq: number; short: number; long: number }; durationMinutes?: number; depth?: number; title?: string }>(req);
  const duration = Math.min(240, Math.max(5, Number(b.durationMinutes) || 60));
  const exam = await generateExam(id, {
    scope: parseScope(b.scope),
    questionCount: Number(b.questionCount) || 10,
    mix: b.mix ?? { mcq: 5, short: 3, long: 2 },
    durationMinutes: duration,
    depth: b.depth ? Math.min(4, Math.max(1, Math.round(Number(b.depth)))) : undefined,
  });
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : exam.title;
  return ok(saveExam({ course_id: id, title, duration_minutes: duration, questions: exam.questions, generated_by: exam.by }), 201);
});
