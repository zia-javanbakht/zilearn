import { editTopic, getCourse, listTopics } from "@/lib/store";
import { UserError } from "@/lib/ai";
import { body, fail, handle, ok, type Ctx } from "@/lib/http";
import { applyOutline, copyTopics, lastUndo, markTopics, moveTopics, removeTopics, snapshotTopics, topMost, undoTopics, type OutlineItem } from "@/lib/topicBatch";
import type { Mastery } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Batch {
  action?: "move" | "copy" | "delete" | "mark" | "outline" | "undo" | "edit";
  ids?: string[];
  parent_id?: string | null;
  before_id?: string | null;
  mastery?: Mastery | null;
  keep_children?: boolean;
  items?: OutlineItem[];
  /** For "edit": new titles and summaries, by topic. */
  edits?: { id: string; title?: string; summary?: string }[];
  /** For "edit": importance (1-3) for every listed topic. */
  importance?: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What can be undone next. */
export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  return ok({ undo: lastUndo(id) });
});

/**
 * Change many topics at once: move them (under `parent_id`, before `before_id`), copy them, delete them,
 * mark them, rewrite the map from an edited outline (`items`), or undo the last change.
 */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  if (!getCourse(id)) return fail("Course not found", 404);
  const b = await body<Batch>(req);
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 2000) : [];
  const all = listTopics(id);
  const names = (list: string[]) => {
    const tops = topMost(all, list);
    return tops.length === 1 ? `"${tops[0].title}"` : plural(tops.length, "topic");
  };
  try {
    switch (b.action) {
      case "undo": {
        const label = undoTopics(id);
        if (!label) return fail("Nothing to undo.", 409);
        return ok({ undone: label, undo: lastUndo(id) });
      }
      case "outline": {
        if (!Array.isArray(b.items) || !b.items.length) return fail("The outline is empty.");
        const items = b.items.slice(0, 2000).filter((x) => x && typeof x.title === "string");
        const keep = new Set(items.map((x) => x.id).filter(Boolean));
        snapshotTopics(id, "the outline edit", all.filter((t) => !keep.has(t.id)).map((t) => t.id));
        const changes = applyOutline(id, items);
        return ok({ changes, undo: lastUndo(id) });
      }
    }
    if (!ids.length) return fail("Select some topics first.");
    switch (b.action) {
      case "move": {
        snapshotTopics(id, `moving ${names(ids)}`);
        return ok({ ids: moveTopics(id, ids, b.parent_id ?? null, b.before_id ?? null), undo: lastUndo(id) });
      }
      case "copy": {
        snapshotTopics(id, `copying ${names(ids)}`);
        return ok({ ids: copyTopics(id, ids, b.parent_id ?? null), undo: lastUndo(id) });
      }
      case "delete": {
        snapshotTopics(id, `deleting ${names(ids)}`, b.keep_children ? ids : topMost(all, ids).map((t) => t.id));
        return ok({ removed: removeTopics(id, ids, !!b.keep_children), undo: lastUndo(id) });
      }
      case "edit": {
        const edits = new Map((Array.isArray(b.edits) ? b.edits : []).filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));
        if ([...edits.values()].some((e) => typeof e.title === "string" && !e.title.trim())) return fail("Every topic needs a name.");
        const inCourse = new Set(all.map((t) => t.id));
        snapshotTopics(id, `editing ${names(ids)}`);
        let changed = 0;
        for (const tid of ids) {
          if (!inCourse.has(tid)) continue;
          const e = edits.get(tid);
          const imp = b.importance === 1 || b.importance === 2 || b.importance === 3 ? b.importance : undefined;
          if (!e && imp === undefined) continue;
          editTopic(tid, { title: e?.title?.slice(0, 200), summary: e?.summary?.slice(0, 2000), importance: imp });
          changed++;
        }
        return ok({ changed, undo: lastUndo(id) });
      }
      case "mark": {
        const m = b.mastery === "know" || b.mastery === "familiar" || b.mastery === "dont_know" ? b.mastery : null;
        snapshotTopics(id, `marking ${names(ids)}`);
        markTopics(id, ids, m);
        return ok({ ok: true, undo: lastUndo(id) });
      }
      default:
        return fail("Unknown action.");
    }
  } catch (err) {
    throw new UserError((err as Error).message);
  }
});
