import { aiEnabled } from "@/lib/ai";
import { levelBrief, lessonRequest, lessonToMarkdown, normalizeDoc } from "@/lib/lesson";
import { checkLesson } from "@/lib/lessonCheck";
import { enrichLesson } from "@/lib/lessonEnrich";
import { sourceQuestions } from "@/lib/lessonOffline";
import { tidyTerms } from "@/lib/lessonTerms";
import { getLesson, getTopic, saveLesson } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Ask the AI tutor to deepen a saved lesson, optionally on something the student names: { depth, request? }. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = await body<{ depth?: number; request?: string }>(req);
  const depth = Math.min(4, Math.max(1, Math.round(Number(b.depth) || 1)));
  if (!getTopic(id)) return fail("This topic no longer exists.", 404);
  if (!aiEnabled()) return fail("Deepening a lesson needs an AI provider. Choose one in Settings.", 400);
  const saved = getLesson(id, depth);
  if (!saved?.doc) return fail("Open the lesson first, so there is something to deepen.", 404);
  const doc = normalizeDoc(saved.doc);
  const { context, sources } = lessonRequest(id, depth);
  const changes = await enrichLesson(doc, context, { ...levelBrief(depth), request: b.request?.trim() || null });
  if (!changes.length) return ok({ content: saved.content, changes });
  tidyTerms(doc);
  await checkLesson(doc, sourceQuestions(sources));
  const content = lessonToMarkdown(doc);
  saveLesson(id, depth, content, doc.by, doc);
  return ok({ content, changes });
});
