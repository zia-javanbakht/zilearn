import { cardsFromMistakes } from "@/lib/generate";
import { addCards, getExam } from "@/lib/store";
import { fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Turn the questions the student got wrong into flashcards. */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const exam = getExam((await params).id);
  if (!exam) return fail("Not found", 404);
  if (!exam.grades) return fail("Grade the exam first.");
  const cards = cardsFromMistakes(exam.questions, exam.grades);
  return ok({ added: cards.length ? addCards(exam.course_id, cards, "exam", exam.generated_by) : 0, mistakes: cards.length });
});
