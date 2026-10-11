import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Not a valid date");

export const CourseInput = z.object({
  name: z.string().trim().min(1, "A course name is required.").max(200),
  code: z.string().trim().max(40).nullish(),
  description: z.string().max(5000).nullish(),
  exam_date: date.nullish().or(z.literal("").transform(() => null)),
  target_level: z.coerce.number().int().min(1).max(4).optional(),
  hours_per_day: z.coerce.number().min(0.25).max(16).optional(),
});

export const CoursePatch = CourseInput.partial();

export const PlanInput = z.object({
  exam_date: date.nullish().or(z.literal("").transform(() => null)),
  target_level: z.coerce.number().int().min(1).max(4).optional(),
  hours_per_day: z.coerce.number().min(0.25).max(16).optional(),
  start_date: date.optional(),
});

/** Parse or return a readable error message. */
export function check<T extends z.ZodType>(schema: T, data: unknown): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "input"}: ${issue.message}` };
}
