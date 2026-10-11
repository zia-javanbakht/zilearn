import { buildPlan, fmtDate } from "@/lib/plan";
import { buildTree, getCourse, getPlan, listMaterials, listTopics, savePlan, updateCourse } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  return ok(getPlan(id));
});

/** Build (or rebuild) the progressive plan from the current marks. Completed depths are kept. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = await body<{ exam_date?: string | null; target_level?: number; hours_per_day?: number; start_date?: string }>(req);
  let course = getCourse(id);
  if (!course) return fail("Course not found", 404);
  const patch: Record<string, unknown> = {};
  if ("exam_date" in b) patch.exam_date = b.exam_date || null;
  if (b.target_level) patch.target_level = b.target_level;
  if (b.hours_per_day) patch.hours_per_day = b.hours_per_day;
  if (Object.keys(patch).length) course = updateCourse(id, patch)!;

  const tree = buildTree(listTopics(id));
  if (!tree.length) return fail("Build the brainmap first.");
  const draft = buildPlan({
    roots: tree,
    targetLevel: course.target_level,
    startDate: b.start_date || fmtDate(new Date()),
    examDate: course.exam_date,
    hoursPerDay: course.hours_per_day,
    materialKinds: new Map(listMaterials(id).map((m) => [m.id, m.kind])),
  });
  return ok(savePlan({ course_id: id, ...draft }));
});
