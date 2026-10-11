import { getExam, setMastery } from "@/lib/store";
import { fail, handle, ok, type Ctx } from "@/lib/http";
import type { Mastery } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Update brainmap marks from exam performance per topic. */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const exam = getExam((await params).id);
  if (!exam) return fail("Not found", 404);
  if (!exam.grades) return fail("Grade the exam first.");
  const per = new Map<string, { score: number; max: number }>();
  for (const g of exam.grades) {
    const q = exam.questions.find((x) => x.id === g.question_id);
    if (!q?.topic_id) continue;
    const p = per.get(q.topic_id) ?? { score: 0, max: 0 };
    p.score += g.score;
    p.max += g.max;
    per.set(q.topic_id, p);
  }
  const updates: { topic_id: string; mastery: Mastery }[] = [];
  for (const [topicId, p] of per) {
    const r = p.max ? p.score / p.max : 0;
    const mastery: Mastery = r >= 0.8 ? "know" : r >= 0.5 ? "familiar" : "dont_know";
    setMastery(topicId, mastery, false);
    updates.push({ topic_id: topicId, mastery });
  }
  return ok({ updated: updates });
});
