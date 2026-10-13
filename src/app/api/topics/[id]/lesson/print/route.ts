import { lessonToTex, markdownLessonToTex } from "@/lib/latex";
import { lessonWithDiagramEdits } from "@/lib/diagramEdits";
import { getCourse, getLesson, getTopic } from "@/lib/store";
import { texDownload, texFileName } from "@/lib/texPdf";
import { DEPTH_LEVELS } from "@/lib/types";
import { fail, handle, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The lesson as a LaTeX document using the Z class (`?format=tex`, the default), or compiled to PDF
 * (`?format=pdf`) with the TeX installed on this computer.
 */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const url = new URL(req.url);
  const depth = Math.min(4, Math.max(1, Math.round(Number(url.searchParams.get("depth")) || 1)));
  const topic = getTopic(id);
  if (!topic) return fail("This topic no longer exists.", 404);
  const lesson = getLesson(id, depth);
  if (!lesson) return fail("Open the lesson first, so there is something to print.", 404);
  const level = DEPTH_LEVELS[depth - 1];
  const source = lesson.doc
    ? lessonToTex(lessonWithDiagramEdits(lesson.doc))
    : markdownLessonToTex({ title: topic.title, depth, level: level.name, goal: level.goal, map: { course: getCourse(topic.course_id)?.name ?? "", path: [] } }, lesson.content);
  return texDownload(source, texFileName(topic.title, `-level-${depth}`), url.searchParams.get("format"));
});
