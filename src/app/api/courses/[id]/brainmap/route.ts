import { after } from "next/server";
import { refreshLinks } from "@/lib/kb";
import { structureCourse } from "@/lib/brainmap";
import { buildTree, getCourse, listMaterials, listTopics, replaceTopics, setMastery, updateCourse } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";
import type { Mastery } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function view(id: string) {
  const course = getCourse(id)!;
  const tree = buildTree(listTopics(id));
  // The client draws the diagrams from the tree, so marking a topic doesn't need a round trip.
  return { tree, summary: course.summary };
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
  // Cross-course links take a while on big libraries; compute them after answering.
  after(refreshLinks);
  updateCourse(id, { summary });
  return ok({ ...view(id), by });
});

/** Mark the whole course at once (every top-level branch). */
export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const b = await body<{ mastery?: Mastery | null }>(req);
  const m = b.mastery === "know" || b.mastery === "familiar" || b.mastery === "dont_know" ? b.mastery : null;
  for (const t of listTopics(id)) if (!t.parent_id) setMastery(t.id, m, true);
  return ok(view(id));
});
