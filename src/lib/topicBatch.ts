import { db, newId } from "./db";
import { buildTree, descendants, flattenTree, getTopic, listTopics, normTitle, removeTopic, removedTitles, setMastery, setRemovedTitles } from "./store";
import type { Mastery, Topic } from "./types";

/*
 * Editing many brainmap topics at once: move (cut and paste, drag and drop), copy, delete, mark,
 * rewrite the whole outline as text, and undo the last of these.
 */

type Row = Record<string, unknown>;

/** The listed topics of a course in map order, leaving out any whose ancestor is also listed. */
export function topMost(all: Topic[], ids: string[]): Topic[] {
  const want = new Set(ids);
  const byId = new Map(all.map((t) => [t.id, t]));
  const covered = (t: Topic) => {
    for (let p = t.parent_id, hops = 0; p && hops < 1000; p = byId.get(p)?.parent_id ?? null, hops++) if (want.has(p)) return true;
    return false;
  };
  return flattenTree(buildTree(all)).filter((n) => want.has(n.id) && !covered(n)) as Topic[];
}

function branchIds(all: Topic[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of all) if (t.parent_id && out.has(t.parent_id) && !out.has(t.id)) (out.add(t.id), (grew = true));
  }
  return out;
}

function checkParent(courseId: string, parentId: string | null | undefined): string | null {
  if (!parentId) return null;
  if (getTopic(parentId)?.course_id !== courseId) throw new Error("That topic isn't in this course any more.");
  return parentId;
}

/**
 * Put topics (with their subtopics) under another topic, or at the top level, before `beforeId` or last.
 * Moved topics count as the student's own, so rebuilding the map leaves them where they were put.
 */
export function moveTopics(courseId: string, ids: string[], parentId: string | null, beforeId: string | null = null): string[] {
  const all = listTopics(courseId);
  const parent = checkParent(courseId, parentId);
  const tops = topMost(all, ids);
  if (!tops.length) return [];
  if (parent && tops.some((t) => branchIds(all, t.id).has(parent))) throw new Error("A topic can't move under itself or one of its own subtopics.");
  const moving = new Set(tops.map((t) => t.id));
  const siblings = all.filter((t) => (t.parent_id ?? null) === parent && !moving.has(t.id)).sort((a, b) => a.position - b.position);
  let at = beforeId ? siblings.findIndex((t) => t.id === beforeId) : -1;
  if (at < 0) at = siblings.length;
  const order = [...siblings.slice(0, at), ...tops, ...siblings.slice(at)];
  const d = db();
  d.transaction(() => {
    const place = d.prepare("UPDATE topics SET position = ? WHERE id = ?");
    const move = d.prepare("UPDATE topics SET parent_id = ?, position = ?, manual = 1 WHERE id = ?");
    order.forEach((t, i) => (moving.has(t.id) ? move.run(parent, i, t.id) : place.run(i, t.id)));
  })();
  return tops.map((t) => t.id);
}

/**
 * Copy topics with all their subtopics under another topic (or to the top level). Copies keep the
 * description, key terms, sources and marks, but start unstudied. Returns the new topics' ids.
 */
export function copyTopics(courseId: string, ids: string[], parentId: string | null): string[] {
  const all = listTopics(courseId);
  const parent = checkParent(courseId, parentId);
  const tops = topMost(all, ids);
  const kids = new Map<string, Topic[]>();
  for (const t of all) if (t.parent_id) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
  const d = db();
  const made: string[] = [];
  d.transaction(() => {
    let { pos } = d.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM topics WHERE course_id = ?").get(courseId) as { pos: number };
    const ins = d.prepare(
      `INSERT INTO topics (id, course_id, parent_id, title, summary, keywords, material_ids, importance, position, mastery, achieved_depth, manual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
    );
    const fts = d.prepare("INSERT INTO topics_fts (title, summary, keywords, topic_id, course_id) VALUES (?, ?, ?, ?, ?)");
    const copy = (t: Topic, under: string | null, position: number, title: string): string => {
      const id = newId();
      ins.run(id, courseId, under, title, t.summary, JSON.stringify(t.keywords), JSON.stringify(t.material_ids), t.importance, position, t.mastery);
      fts.run(title, t.summary, t.keywords.join(" "), id, courseId);
      for (const c of kids.get(t.id) ?? []) copy(c, id, c.position, c.title);
      return id;
    };
    for (const t of tops) made.push(copy(t, parent, pos++, (t.parent_id ?? null) === parent ? `${t.title} (copy)` : t.title));
  })();
  return made;
}

/** Delete topics with their branches, or only the topics themselves (their subtopics move up a level). */
export function removeTopics(courseId: string, ids: string[], keepChildren = false): number {
  const all = listTopics(courseId);
  const targets = keepChildren ? all.filter((t) => ids.includes(t.id)) : topMost(all, ids);
  let n = 0;
  db().transaction(() => {
    for (const t of targets) if (removeTopic(t.id, keepChildren)) n++;
  })();
  return n;
}

/** Mark topics; each one's subtopics take the same mark. */
export function markTopics(courseId: string, ids: string[], mastery: Mastery | null) {
  const tops = topMost(listTopics(courseId), ids);
  db().transaction(() => tops.forEach((t) => setMastery(t.id, mastery, true)))();
}

export interface OutlineItem {
  /** An existing topic, or none for a new one. */
  id?: string | null;
  title: string;
  depth: number;
}

export interface OutlineChanges {
  added: number;
  renamed: number;
  moved: number;
  removed: number;
}

/**
 * Make the map match an edited outline: topics are renamed, re-ordered and re-parented to follow it,
 * new lines become topics, and topics left out are deleted (their lessons with them).
 */
export function applyOutline(courseId: string, items: OutlineItem[]): OutlineChanges {
  const all = listTopics(courseId);
  const byId = new Map(all.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack: string[] = [];
  const plan: { id: string; old: Topic | null; title: string; parent: string | null; position: number }[] = [];
  let prevDepth = -1;
  for (const it of items) {
    const title = it.title.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) continue;
    const depth = Math.max(0, Math.min(Math.floor(it.depth) || 0, prevDepth + 1));
    prevDepth = depth;
    const old = it.id && byId.has(it.id) && !seen.has(it.id) ? byId.get(it.id)! : null;
    const id = old?.id ?? newId();
    seen.add(id);
    stack.length = depth;
    plan.push({ id, old, title, parent: depth ? stack[depth - 1] : null, position: plan.length });
    stack[depth] = id;
  }
  const dropped = all.filter((t) => !seen.has(t.id));
  const changes: OutlineChanges = { added: 0, renamed: 0, moved: 0, removed: dropped.length };
  const d = db();
  d.transaction(() => {
    d.prepare("UPDATE topics SET parent_id = NULL WHERE course_id = ?").run(courseId);
    const removed = removedTitles(courseId);
    const left = new Set(plan.map((p) => normTitle(p.title)));
    for (const t of dropped) {
      d.prepare("UPDATE plan_items SET topic_id = NULL WHERE topic_id = ?").run(t.id);
      d.prepare("DELETE FROM topics_fts WHERE topic_id = ?").run(t.id);
      d.prepare("DELETE FROM topics WHERE id = ?").run(t.id);
      if (!left.has(normTitle(t.title))) removed.add(normTitle(t.title));
    }
    const ins = d.prepare(
      `INSERT INTO topics (id, course_id, parent_id, title, summary, keywords, material_ids, importance, position, mastery, achieved_depth, manual)
       VALUES (?, ?, NULL, ?, '', '[]', '[]', 2, ?, NULL, 0, 1)`,
    );
    const upd = d.prepare("UPDATE topics SET title = ?, position = ?, manual = manual OR ? WHERE id = ?");
    for (const p of plan) {
      if (!p.old) {
        ins.run(p.id, courseId, p.title, p.position);
        d.prepare("INSERT INTO topics_fts (title, summary, keywords, topic_id, course_id) VALUES (?, ?, ?, ?, ?)").run(p.title, "", "", p.id, courseId);
        removed.delete(normTitle(p.title));
        changes.added++;
        continue;
      }
      const renamed = p.title !== p.old.title;
      const moved = (p.old.parent_id ?? null) !== p.parent;
      upd.run(p.title, p.position, renamed || moved ? 1 : 0, p.id);
      if (renamed) {
        d.prepare("UPDATE topics_fts SET title = ? WHERE topic_id = ?").run(p.title, p.id);
        if (normTitle(p.title) !== normTitle(p.old.title)) {
          if (!left.has(normTitle(p.old.title))) removed.add(normTitle(p.old.title));
          removed.delete(normTitle(p.title));
        }
        changes.renamed++;
      }
      if (moved) changes.moved++;
    }
    const setParent = d.prepare("UPDATE topics SET parent_id = ? WHERE id = ?");
    for (const p of plan) if (p.parent) setParent.run(p.parent, p.id);
    setRemovedTitles(courseId, removed);
  })();
  return changes;
}

/* ---------------- Undo ---------------- */

interface Snapshot {
  topics: Row[];
  removed: string | null;
  /** Lessons, links and card and plan references of the topics the change was about to delete. */
  lessons: Row[];
  links: Row[];
  cards: { id: string; topic_id: string }[];
  plan: { id: string; topic_id: string }[];
}

const KEEP_UNDO = 20;

function inList(ids: string[]) {
  return ids.map(() => "?").join(",") || "NULL";
}

/** Remember the course's topics before a change, so `undoTopics` can put them back. */
export function snapshotTopics(courseId: string, label: string, dropping: string[] = []) {
  const d = db();
  const gone = new Set<string>();
  for (const id of dropping) for (const x of [id, ...descendants(courseId, id).map((t) => t.id)]) gone.add(x);
  const ids = [...gone];
  const snap: Snapshot = {
    topics: d.prepare("SELECT * FROM topics WHERE course_id = ?").all(courseId) as Row[],
    removed: (d.prepare("SELECT removed_topics FROM courses WHERE id = ?").get(courseId) as { removed_topics: string | null } | undefined)?.removed_topics ?? null,
    lessons: ids.length ? (d.prepare(`SELECT * FROM lessons WHERE topic_id IN (${inList(ids)})`).all(...ids) as Row[]) : [],
    links: ids.length ? (d.prepare(`SELECT * FROM links WHERE from_topic IN (${inList(ids)}) OR to_topic IN (${inList(ids)})`).all(...ids, ...ids) as Row[]) : [],
    cards: ids.length ? (d.prepare(`SELECT id, topic_id FROM cards WHERE topic_id IN (${inList(ids)})`).all(...ids) as Snapshot["cards"]) : [],
    plan: ids.length ? (d.prepare(`SELECT id, topic_id FROM plan_items WHERE topic_id IN (${inList(ids)})`).all(...ids) as Snapshot["plan"]) : [],
  };
  d.prepare("INSERT INTO topic_undo (course_id, label, data) VALUES (?, ?, ?)").run(courseId, label, JSON.stringify(snap));
  d.prepare("DELETE FROM topic_undo WHERE course_id = ? AND id NOT IN (SELECT id FROM topic_undo WHERE course_id = ? ORDER BY id DESC LIMIT ?)").run(courseId, courseId, KEEP_UNDO);
}

/** What the next undo would undo, if anything. */
export function lastUndo(courseId: string): string | null {
  const r = db().prepare("SELECT label FROM topic_undo WHERE course_id = ? ORDER BY id DESC LIMIT 1").get(courseId) as { label: string } | undefined;
  return r?.label ?? null;
}

function insertRow(table: string, row: Row, verb = "INSERT") {
  const cols = Object.keys(row);
  db()
    .prepare(`${verb} INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

/** Put the course's topics back as they were before the last change. Returns its label, or null. */
export function undoTopics(courseId: string): string | null {
  const d = db();
  const r = d.prepare("SELECT id, label, data FROM topic_undo WHERE course_id = ? ORDER BY id DESC LIMIT 1").get(courseId) as
    | { id: number; label: string; data: string }
    | undefined;
  if (!r) return null;
  const snap = JSON.parse(r.data) as Snapshot;
  const was = new Map(snap.topics.map((t) => [t.id as string, t]));
  d.transaction(() => {
    d.prepare("UPDATE topics SET parent_id = NULL WHERE course_id = ?").run(courseId);
    for (const t of listTopics(courseId)) {
      if (was.has(t.id)) continue;
      d.prepare("UPDATE plan_items SET topic_id = NULL WHERE topic_id = ?").run(t.id);
      d.prepare("DELETE FROM topics WHERE id = ?").run(t.id);
    }
    const have = new Set(listTopics(courseId).map((t) => t.id));
    for (const row of snap.topics) {
      const flat: Row = { ...row, parent_id: null };
      if (have.has(row.id as string)) {
        const cols = Object.keys(flat).filter((c) => c !== "id");
        d.prepare(`UPDATE topics SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => flat[c] as string | number | null), row.id as string);
      } else insertRow("topics", flat);
    }
    const setParent = d.prepare("UPDATE topics SET parent_id = ? WHERE id = ?");
    for (const row of snap.topics) if (row.parent_id) setParent.run(row.parent_id as string, row.id as string);
    for (const l of snap.lessons) insertRow("lessons", l, "INSERT OR IGNORE");
    for (const l of snap.links) if (getTopic(l.from_topic as string) && getTopic(l.to_topic as string)) insertRow("links", l, "INSERT OR IGNORE");
    for (const c of snap.cards) d.prepare("UPDATE cards SET topic_id = ? WHERE id = ? AND topic_id IS NULL").run(c.topic_id, c.id);
    for (const p of snap.plan) d.prepare("UPDATE plan_items SET topic_id = ? WHERE id = ? AND topic_id IS NULL").run(p.topic_id, p.id);
    d.prepare("UPDATE courses SET removed_topics = ? WHERE id = ?").run(snap.removed, courseId);
    d.prepare("DELETE FROM topics_fts WHERE course_id = ?").run(courseId);
    const fts = d.prepare("INSERT INTO topics_fts (title, summary, keywords, topic_id, course_id) VALUES (?, ?, ?, ?, ?)");
    for (const t of listTopics(courseId)) fts.run(t.title, t.summary, t.keywords.join(" "), t.id, courseId);
    d.prepare("DELETE FROM topic_undo WHERE id = ?").run(r.id);
  })();
  return r.label;
}
