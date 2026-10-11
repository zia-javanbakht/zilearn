import { structureCourse, toFlowchart, toMindmap } from "@/lib/brainmap";
import { buildTree, getCourse, listMaterials, listTopics, replaceTopics, updateCourse } from "@/lib/store";
import { fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function view(id: string) {
  const course = getCourse(id)!;
  const tree = buildTree(listTopics(id));
  return { tree, mindmap: toMindmap(course.name, tree), flowchart: toFlowchart(course.name, tree), summary: course.summary };
}

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  return ok(view(id));
});

/** (Re)build the brainmap from all materials. Existing marks carry over to matching topics. */
export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const course = getCourse(id);
  if (!course) return fail("Course not found", 404);
  const materials = listMaterials(id, true);
  if (!materials.length) return fail("Add some materials first.");
  const { topics, summary, by } = await structureCourse(course, materials);
  replaceTopics(id, topics);
  updateCourse(id, { summary });
  return ok({ ...view(id), by });
});
