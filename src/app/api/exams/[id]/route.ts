import { gradeExam } from "@/lib/generate";
import { deleteRow, getExam, saveExamResult } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const e = getExam((await params).id);
  return e ? ok(e) : fail("Not found", 404);
});

/** Submit answers (and optional self-marks for written questions) to be graded. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const exam = getExam(id);
  if (!exam) return fail("Not found", 404);
  const b = await body<{ answers?: Record<string, string>; selfMarks?: Record<string, number> }>(req);
  const answers = b.answers ?? exam.answers ?? {};
  const grades = await gradeExam(exam.questions, answers, b.selfMarks ?? {});
  saveExamResult(id, answers, grades);
  return ok(getExam(id));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  deleteRow("exams", (await params).id);
  return ok({ ok: true });
});
