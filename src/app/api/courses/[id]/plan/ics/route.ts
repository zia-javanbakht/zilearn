import { buildIcs } from "@/lib/ics";
import { getCourse, getPlan } from "@/lib/store";
import { fail, handle } from "@/lib/http";
import type { Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The study plan as an iCalendar file. Download it, or subscribe to the URL (webcal://) so the
 * calendar follows plan rebuilds. Query: start=HH:MM, mode=sessions|days, break=min, done=1,
 * from=YYYY-MM-DD, remind=min (or "none"), download=1.
 */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const course = getCourse(id);
  if (!course) return fail("Course not found", 404);
  const plan = getPlan(id);
  if (!plan) return fail("Create a study plan first.", 404);
  const q = new URL(req.url).searchParams;
  const start = /^\d{1,2}:\d{2}$/.test(q.get("start") ?? "") ? q.get("start")! : "18:00";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.get("from") ?? "") ? q.get("from")! : undefined;
  const remind = q.get("remind");
  const ics = buildIcs(course, plan.items, {
    start,
    mode: q.get("mode") === "days" ? "days" : "sessions",
    breakMinutes: Math.min(60, Math.max(0, Number(q.get("break") ?? 5) || 0)),
    includeDone: q.get("done") === "1",
    from,
    appUrl: `${new URL(req.url).origin}/courses/${id}#plan`,
    reminderMinutes: remind === "none" ? null : Math.min(1440, Math.max(0, Number(remind ?? 10) || 0)),
  });
  const name = `${course.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)} study plan.ics`;
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `${q.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-cache",
    },
  });
});
