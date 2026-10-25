import { addChat, answerQuestion, clearChat, listChat } from "@/lib/ask";
import { getCourse } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The conversation with this course so far. */
export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  return ok(listChat(id));
});

/** Ask a question ({question}); answered from the course materials, with citations. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const b = await body<{ question?: unknown }>(req);
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 2000) : "";
  if (!question) return fail("Type a question first.");
  const history = listChat(id, 12);
  const answer = await answerQuestion(id, question, history);
  // Saved only once answered, so a failed call doesn't leave a question without its answer.
  const asked = addChat(id, { role: "user", content: question, citations: [], generated_by: "student" });
  const reply = addChat(id, { role: "assistant", content: answer.text, citations: answer.citations, generated_by: answer.by });
  return ok({ question: asked, answer: reply }, 201);
});

/** Start the conversation over. */
export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  clearChat(id);
  return ok({ ok: true });
});
