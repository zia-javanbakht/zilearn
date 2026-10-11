import { createCourse, listCourses } from "@/lib/store";
import { body, fail, handle, ok } from "@/lib/http";
import type { Course } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handle(() => ok(listCourses()));

export const POST = handle(async (req: Request) => {
  const b = await body<Partial<Course>>(req);
  if (!b.name || !String(b.name).trim()) return fail("A course name is required.");
  return ok(createCourse({ ...b, name: String(b.name) }), 201);
});
