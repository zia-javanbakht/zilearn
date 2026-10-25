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

/** A number in a range, or the default when it is missing or not a number (never NaN). */
const num = (min: number, max: number, fallback: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().finite().optional())
    .catch(undefined)
    .transform((v) => (v === undefined ? fallback : Math.min(max, Math.max(min, v))));

export const ExamInput = z.object({
  scope: z.unknown().optional(),
  questionCount: num(1, 40, 10).transform(Math.round),
  mix: z
    .object({ mcq: num(0, 100, 0), short: num(0, 100, 0), long: num(0, 100, 0) })
    .catch({ mcq: 5, short: 3, long: 2 })
    .optional()
    // All weights zero (or none given) means the default mix.
    .transform((m) => (m && m.mcq + m.short + m.long > 0 ? m : { mcq: 5, short: 3, long: 2 })),
  durationMinutes: num(5, 240, 60).transform(Math.round),
  depth: num(1, 4, 0).transform((d) => (d ? Math.round(d) : undefined)),
  title: z.string().trim().max(120).optional().catch(undefined),
});

export const CardsInput = z.object({ count: num(5, 60, 20).transform(Math.round) });
export const PodcastInput = z.object({ minutes: num(3, 40, 10) });

/** Parse or return a readable error message. */
export function check<T extends z.ZodType>(schema: T, data: unknown): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "input"}: ${issue.message}` };
}
