import { generateLessonDoc, lessonToMarkdown } from "@/lib/lesson";
import { getLesson, getTopic, saveLesson } from "@/lib/store";
import { requestSignal } from "@/lib/ai";
import { fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function depthOf(req: Request) {
  const d = Number(new URL(req.url).searchParams.get("depth") ?? 1);
  return Math.min(4, Math.max(1, Number.isFinite(d) ? Math.round(d) : 1));
}

// One generation per topic and depth at a time: reopening the lesson joins the running request.
const inFlight = new Map<string, ReturnType<typeof run>>();

async function run(id: string, depth: number) {
  const doc = await generateLessonDoc(id, depth);
  const content = lessonToMarkdown(doc);
  saveLesson(id, depth, content, doc.by, doc);
  return { content, generated_by: doc.by, depth, printable: true };
}

function generate(id: string, depth: number) {
  const key = `${id}:${depth}`;
  let p = inFlight.get(key);
  if (!p) {
    // Shared by every request waiting on it and cached when done, so it isn't tied to the first request's lifetime.
    p = requestSignal.exit(() => run(id, depth)).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return p;
}

/** Get the lesson for a topic at a depth, generating it the first time. */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const depth = depthOf(req);
  if (!getTopic(id)) return fail("This topic no longer exists. Rebuild the study plan.", 404);
  const cached = getLesson(id, depth);
  if (cached) return ok({ content: cached.content, generated_by: cached.generated_by, depth, printable: true });
  return ok(await generate(id, depth));
});

/** Regenerate. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const depth = depthOf(req);
  if (!getTopic(id)) return fail("This topic no longer exists. Rebuild the study plan.", 404);
  return ok(await generate(id, depth));
});
