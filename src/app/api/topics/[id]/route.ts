import { editTopic, getTopic, linksForTopic, getTopicsByIds, removeTopic, setMastery, listCourses } from "@/lib/store";
import { UserError } from "@/lib/ai";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";
import type { Mastery } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const t = getTopic(id);
  if (!t) return fail("Not found", 404);
  const links = linksForTopic(id);
  const others = new Map(getTopicsByIds(links.map((l) => (l.from_topic === id ? l.to_topic : l.from_topic))).map((o) => [o.id, o]));
  const courses = new Map(listCourses().map((c) => [c.id, c.name]));
  return ok({
    topic: t,
    related: links
      .map((l) => {
        const o = others.get(l.from_topic === id ? l.to_topic : l.from_topic);
        return o && { topic_id: o.id, title: o.title, course_id: o.course_id, course_name: courses.get(o.course_id), relation: l.relation, score: l.score };
      })
      .filter(Boolean),
  });
});

/** Mark a topic, or edit it: `title`, `summary`, and `parent_id` (null moves it to the top level). */
export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = await body<{ mastery?: Mastery | null; applyToBranch?: boolean; title?: string; summary?: string; parent_id?: string | null }>(req);
  if (!getTopic(id)) return fail("Not found", 404);
  if ("mastery" in b) {
    const m = b.mastery === "know" || b.mastery === "familiar" || b.mastery === "dont_know" ? b.mastery : null;
    setMastery(id, m, b.applyToBranch !== false);
  }
  if (b.title !== undefined || b.summary !== undefined || b.parent_id !== undefined) {
    if (b.title !== undefined && !b.title.trim()) return fail("A topic needs a name.");
    try {
      return ok(editTopic(id, { title: b.title?.slice(0, 200), summary: b.summary?.slice(0, 2000), parent_id: b.parent_id }));
    } catch (err) {
      throw new UserError((err as Error).message);
    }
  }
  return ok({ ok: true });
});

/** Delete a topic and its branch; `?keepChildren=1` deletes only the topic and moves its subtopics up. */
export const DELETE = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const keepChildren = new URL(req.url).searchParams.get("keepChildren") === "1";
  return removeTopic(id, keepChildren) ? ok({ ok: true }) : fail("Not found", 404);
});
