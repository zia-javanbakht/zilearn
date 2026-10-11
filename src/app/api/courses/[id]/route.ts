import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { buildTree, deleteCourse, getCourse, getPlan, listMaterials, listTopics, updateCourse } from "@/lib/store";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";
import { check, CoursePatch } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const course = getCourse(id);
  if (!course) return fail("Course not found", 404);
  const plan = getPlan(id);
  return ok({
    course,
    materials: listMaterials(id),
    tree: buildTree(listTopics(id)),
    planProgress: plan ? { total: plan.items.length, done: plan.items.filter((i) => i.done).length } : null,
  });
});

export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const v = check(CoursePatch, await body(req));
  if (!v.ok) return fail(v.error);
  const c = updateCourse(id, v.data);
  return c ? ok(c) : fail("Course not found", 404);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  deleteCourse(id);
  await fs.rm(path.join(dataDir(), "uploads", id), { recursive: true, force: true });
  return ok({ ok: true });
});
