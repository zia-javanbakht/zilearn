import { generateExam, parseScope } from "@/lib/generate";
import { getCourse, listExams, saveExam } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";
import { check, ExamInput } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => ok(listExams((await params).id)));

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const v = check(ExamInput, await body(req));
  if (!v.ok) return fail(v.error);
  const b = v.data;
  const exam = await generateExam(id, { scope: parseScope(b.scope), questionCount: b.questionCount, mix: b.mix, durationMinutes: b.durationMinutes, depth: b.depth });
  if (!exam.questions.length) return fail("No questions could be written for that scope. Try the whole course, or add materials.");
  const title = b.title || exam.title;
  const duration = b.durationMinutes;
  return ok(saveExam({ course_id: id, title, duration_minutes: duration, questions: exam.questions, generated_by: exam.by }), 201);
});
