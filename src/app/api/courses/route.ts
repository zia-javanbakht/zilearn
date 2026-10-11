import { createCourse, listCourses } from "@/lib/store";
import { body, fail, handle, ok } from "@/lib/http";
import { check, CourseInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = handle(() => ok(listCourses()));

export const POST = handle(async (req: Request) => {
  const v = check(CourseInput, await body(req));
  if (!v.ok) return fail(v.error);
  return ok(createCourse(v.data), 201);
});
