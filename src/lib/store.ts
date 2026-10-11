import { db, newId } from "./db";
import { chunkText } from "./text";
import type {
  Course,
  Exam,
  KnowledgeLink,
  Mastery,
  Material,
  Plan,
  PlanItem,
  Podcast,
  ReviewNote,
  Topic,
  TopicNode,
} from "./types";

type Row = Record<string, unknown>;

const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

/* ---------------- Courses ---------------- */

export function listCourses(): (Course & { material_count: number; topic_count: number })[] {
  return db()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM materials m WHERE m.course_id = c.id) AS material_count,
              (SELECT COUNT(*) FROM topics t WHERE t.course_id = c.id) AS topic_count
       FROM courses c ORDER BY c.created_at DESC`,
    )
    .all() as (Course & { material_count: number; topic_count: number })[];
}

export function getCourse(id: string): Course | null {
  return (db().prepare("SELECT * FROM courses WHERE id = ?").get(id) as Course) ?? null;
}

export function createCourse(input: Partial<Course> & { name: string }): Course {
  const id = newId();
  db()
    .prepare(
      `INSERT INTO courses (id, name, code, description, exam_date, target_level, hours_per_day)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name.trim(),
      input.code ?? null,
      input.description ?? null,
      input.exam_date ?? null,
      clampInt(input.target_level ?? 3, 1, 4),
      Math.max(0.25, Number(input.hours_per_day ?? 2)),
    );
  return getCourse(id)!;
}

export function updateCourse(id: string, patch: Partial<Course>): Course | null {
  const allowed = ["name", "code", "description", "exam_date", "target_level", "hours_per_day", "summary"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in patch) {
      let v = patch[k] as unknown;
      if (k === "target_level") v = clampInt(Number(v), 1, 4);
      if (k === "hours_per_day") v = Math.max(0.25, Number(v));
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }
  }
  if (sets.length) db().prepare(`UPDATE courses SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return getCourse(id);
}

export function deleteCourse(id: string) {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM chunks_fts WHERE course_id = ?").run(id);
    d.prepare("DELETE FROM topics_fts WHERE course_id = ?").run(id);
    d.prepare("DELETE FROM courses WHERE id = ?").run(id);
  })();
}

/* ---------------- Materials ---------------- */

export function listMaterials(courseId: string, withText = false): Material[] {
  const cols = withText ? "*" : "id, course_id, kind, title, source_type, filename, mime, path, url, substr(text, 1, 400) AS text, status, note, created_at";
  return db().prepare(`SELECT ${cols} FROM materials WHERE course_id = ? ORDER BY created_at`).all(courseId) as Material[];
}

export function getMaterial(id: string): Material | null {
  return (db().prepare("SELECT * FROM materials WHERE id = ?").get(id) as Material) ?? null;
}

export function insertMaterial(m: Omit<Material, "id" | "created_at">): Material {
  const id = newId();
  const d = db();
  d.transaction(() => {
    d.prepare(
      `INSERT INTO materials (id, course_id, kind, title, source_type, filename, mime, path, url, text, status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, m.course_id, m.kind, m.title, m.source_type, m.filename, m.mime, m.path, m.url, m.text, m.status, m.note);
    indexMaterialText(id, m.course_id, `${m.title}\n${m.text ?? ""}`);
  })();
  return getMaterial(id)!;
}

export function updateMaterial(id: string, patch: { title?: string; kind?: string; text?: string; note?: string | null }) {
  const m = getMaterial(id);
  if (!m) return null;
  const next = { ...m, ...patch };
  const d = db();
  d.transaction(() => {
    d.prepare("UPDATE materials SET title = ?, kind = ?, text = ?, note = ?, status = ? WHERE id = ?").run(
      next.title,
      next.kind,
      next.text,
      next.note,
      next.text && next.text.trim().length > 0 ? "ready" : m.status,
      id,
    );
    indexMaterialText(id, m.course_id, `${next.title}\n${next.text ?? ""}`);
  })();
  return getMaterial(id);
}

export function deleteMaterial(id: string) {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM chunks_fts WHERE material_id = ?").run(id);
    d.prepare("DELETE FROM materials WHERE id = ?").run(id);
  })();
}

function indexMaterialText(materialId: string, courseId: string, text: string) {
  const d = db();
  d.prepare("DELETE FROM chunks_fts WHERE material_id = ?").run(materialId);
  const ins = d.prepare("INSERT INTO chunks_fts (content, material_id, course_id, chunk_index) VALUES (?, ?, ?, ?)");
  chunkText(text).forEach((c, i) => ins.run(c, materialId, courseId, i));
}

/* ---------------- Topics ---------------- */

function mapTopic(r: Row): Topic {
  return {
    ...(r as unknown as Topic),
    keywords: json<string[]>(r.keywords, []),
    material_ids: json<string[]>(r.material_ids, []),
  };
}

export function listTopics(courseId: string): Topic[] {
  return (db().prepare("SELECT * FROM topics WHERE course_id = ? ORDER BY position").all(courseId) as Row[]).map(mapTopic);
}

export function getTopic(id: string): Topic | null {
  const r = db().prepare("SELECT * FROM topics WHERE id = ?").get(id) as Row | undefined;
  return r ? mapTopic(r) : null;
}

export function getTopicsByIds(ids: string[]): Topic[] {
  if (!ids.length) return [];
  const q = `SELECT * FROM topics WHERE id IN (${ids.map(() => "?").join(",")})`;
  return (db().prepare(q).all(...ids) as Row[]).map(mapTopic);
}

export function buildTree(topics: Topic[]): TopicNode[] {
  const byId = new Map<string, TopicNode>();
  for (const t of topics) byId.set(t.id, { ...t, children: [], effective_mastery: null });
  const roots: TopicNode[] = [];
  for (const n of byId.values()) {
    const p = n.parent_id ? byId.get(n.parent_id) : undefined;
    if (p) p.children.push(n);
    else roots.push(n);
  }
  const sort = (ns: TopicNode[]) => {
    ns.sort((a, b) => a.position - b.position);
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  const inherit = (ns: TopicNode[], parent: Mastery | null) => {
    for (const n of ns) {
      n.effective_mastery = n.mastery ?? parent;
      inherit(n.children, n.effective_mastery);
    }
  };
  inherit(roots, null);
  return roots;
}

export function flattenTree(roots: TopicNode[]): TopicNode[] {
  const out: TopicNode[] = [];
  const walk = (ns: TopicNode[]) => ns.forEach((n) => (out.push(n), walk(n.children)));
  walk(roots);
  return out;
}

export interface NewTopic {
  ref: string;
  parent_ref: string | null;
  title: string;
  summary: string;
  keywords: string[];
  material_ids: string[];
  importance: number;
}

/**
 * Replace a course's topic tree. Topics whose title matches an existing topic keep
 * their id, so marks, achieved depth, lessons, plan items and knowledge-base links
 * all survive a rebuild.
 */
export function replaceTopics(courseId: string, topics: NewTopic[]) {
  const d = db();
  const old = listTopics(courseId);
  const prev = new Map<string, Topic>();
  for (const t of old) {
    const k = normTitle(t.title);
    if (k && !prev.has(k)) prev.set(k, t);
  }
  const refToId = new Map<string, string>();
  const reused = new Set<string>();
  for (const t of topics) {
    if (refToId.has(t.ref)) continue;
    const match = prev.get(normTitle(t.title));
    if (match && !reused.has(match.id)) {
      reused.add(match.id);
      refToId.set(t.ref, match.id);
    } else refToId.set(t.ref, newId());
  }

  d.transaction(() => {
    // Detach parents first so deleting a dropped topic never cascades into a kept one.
    d.prepare("UPDATE topics SET parent_id = NULL WHERE course_id = ?").run(courseId);
    const del = d.prepare("DELETE FROM topics WHERE id = ?");
    const orphanItems = d.prepare("UPDATE plan_items SET topic_id = NULL WHERE topic_id = ?");
    for (const t of old) {
      if (reused.has(t.id)) continue;
      orphanItems.run(t.id);
      del.run(t.id);
    }
    d.prepare("DELETE FROM topics_fts WHERE course_id = ?").run(courseId);

    const ins = d.prepare(
      `INSERT INTO topics (id, course_id, parent_id, title, summary, keywords, material_ids, importance, position, mastery, achieved_depth)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 0)`,
    );
    const upd = d.prepare(
      "UPDATE topics SET title = ?, summary = ?, keywords = ?, material_ids = ?, importance = ?, position = ? WHERE id = ?",
    );
    const setParent = d.prepare("UPDATE topics SET parent_id = ? WHERE id = ?");
    const fts = d.prepare("INSERT INTO topics_fts (title, summary, keywords, topic_id, course_id) VALUES (?, ?, ?, ?, ?)");
    const done = new Set<string>();
    topics.forEach((t, position) => {
      const id = refToId.get(t.ref)!;
      if (done.has(id)) return;
      done.add(id);
      const vals = [t.title, t.summary, JSON.stringify(t.keywords), JSON.stringify(t.material_ids), clampInt(t.importance, 1, 3), position] as const;
      if (reused.has(id)) upd.run(...vals, id);
      else ins.run(id, courseId, ...vals);
      fts.run(t.title, t.summary, t.keywords.join(" "), id, courseId);
    });
    // Link parents, refusing cycles (a parent chain that leads back to the topic).
    const parentOf = new Map<string, string | null>();
    for (const t of topics) {
      const id = refToId.get(t.ref)!;
      const pid = t.parent_ref ? refToId.get(t.parent_ref) ?? null : null;
      if (!parentOf.has(id)) parentOf.set(id, pid && pid !== id ? pid : null);
    }
    for (const [id, pid] of parentOf) {
      let cur = pid;
      let cyclic = false;
      for (let hops = 0; cur && hops < 1000; hops++) {
        if (cur === id) {
          cyclic = true;
          break;
        }
        cur = parentOf.get(cur) ?? null;
      }
      if (cyclic) parentOf.set(id, null);
      else if (pid) setParent.run(pid, id);
    }
  })();
}

/** Mark a topic; by default the whole branch takes the new mark (children's own marks are cleared). */
export function setMastery(topicId: string, mastery: Mastery | null, applyToBranch = true) {
  const d = db();
  const t = getTopic(topicId);
  if (!t) return;
  d.transaction(() => {
    d.prepare("UPDATE topics SET mastery = ? WHERE id = ?").run(mastery, topicId);
    if (applyToBranch) {
      const all = listTopics(t.course_id);
      const kids = new Map<string, string[]>();
      for (const x of all) if (x.parent_id) kids.set(x.parent_id, [...(kids.get(x.parent_id) ?? []), x.id]);
      const stack = [...(kids.get(topicId) ?? [])];
      const clear = d.prepare("UPDATE topics SET mastery = NULL WHERE id = ?");
      while (stack.length) {
        const id = stack.pop()!;
        clear.run(id);
        stack.push(...(kids.get(id) ?? []));
      }
    }
  })();
}

export function setAchievedDepth(topicId: string, depth: number) {
  db().prepare("UPDATE topics SET achieved_depth = MAX(achieved_depth, ?) WHERE id = ?").run(depth, topicId);
}

/* ---------------- Lessons ---------------- */

export function getLesson(topicId: string, depth: number): { content: string; generated_by: string } | null {
  return (
    (db().prepare("SELECT content, generated_by FROM lessons WHERE topic_id = ? AND depth = ?").get(topicId, depth) as {
      content: string;
      generated_by: string;
    }) ?? null
  );
}

export function saveLesson(topicId: string, depth: number, content: string, generatedBy: string) {
  db()
    .prepare("INSERT OR REPLACE INTO lessons (topic_id, depth, content, generated_by) VALUES (?, ?, ?, ?)")
    .run(topicId, depth, content, generatedBy);
}

/* ---------------- Plans ---------------- */

export function savePlan(plan: Omit<Plan, "id" | "created_at" | "items"> & { items: Omit<PlanItem, "id" | "plan_id">[] }): Plan {
  const d = db();
  const id = newId();
  d.transaction(() => {
    d.prepare("DELETE FROM plans WHERE course_id = ?").run(plan.course_id);
    d.prepare(
      "INSERT INTO plans (id, course_id, start_date, end_date, target_level, iterations, warnings) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, plan.course_id, plan.start_date, plan.end_date, plan.target_level, plan.iterations, JSON.stringify(plan.warnings));
    const ins = d.prepare(
      `INSERT INTO plan_items (id, plan_id, day, date, iteration, kind, topic_id, topic_title, depth, minutes, activities, done, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const it of plan.items) {
      ins.run(newId(), id, it.day, it.date, it.iteration, it.kind, it.topic_id, it.topic_title, it.depth, it.minutes, JSON.stringify(it.activities), it.done ? 1 : 0, it.position);
    }
  })();
  return getPlan(plan.course_id)!;
}

export function getPlan(courseId: string): Plan | null {
  const p = db().prepare("SELECT * FROM plans WHERE course_id = ? ORDER BY created_at DESC LIMIT 1").get(courseId) as Row | undefined;
  if (!p) return null;
  const items = (db().prepare("SELECT * FROM plan_items WHERE plan_id = ? ORDER BY position").all(p.id) as Row[]).map(
    (r) => ({ ...(r as unknown as PlanItem), activities: json<string[]>(r.activities, []), done: r.done === 1 }),
  );
  return { ...(p as unknown as Plan), warnings: json<string[]>(p.warnings, []), items };
}

export function setPlanItemDone(itemId: string, done: boolean): PlanItem | null {
  const d = db();
  d.prepare("UPDATE plan_items SET done = ? WHERE id = ?").run(done ? 1 : 0, itemId);
  const r = d.prepare("SELECT * FROM plan_items WHERE id = ?").get(itemId) as Row | undefined;
  if (!r) return null;
  const item = { ...(r as unknown as PlanItem), activities: json<string[]>(r.activities, []), done: r.done === 1 };
  if (done && item.topic_id) setAchievedDepth(item.topic_id, item.depth);
  return item;
}

/* ---------------- Exams / notes / podcasts ---------------- */

function mapExam(r: Row): Exam {
  return {
    ...(r as unknown as Exam),
    questions: json(r.questions, []),
    answers: json(r.answers, null),
    grades: json(r.grades, null),
  };
}

export function saveExam(e: Omit<Exam, "id" | "created_at" | "answers" | "grades">): Exam {
  const id = newId();
  db()
    .prepare("INSERT INTO exams (id, course_id, title, duration_minutes, questions, generated_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, e.course_id, e.title, e.duration_minutes, JSON.stringify(e.questions), e.generated_by);
  return getExam(id)!;
}

export function getExam(id: string): Exam | null {
  const r = db().prepare("SELECT * FROM exams WHERE id = ?").get(id) as Row | undefined;
  return r ? mapExam(r) : null;
}

export function listExams(courseId: string): Exam[] {
  return (db().prepare("SELECT * FROM exams WHERE course_id = ? ORDER BY created_at DESC").all(courseId) as Row[]).map(mapExam);
}

export function saveExamResult(id: string, answers: Record<string, string>, grades: Exam["grades"]) {
  db().prepare("UPDATE exams SET answers = ?, grades = ? WHERE id = ?").run(JSON.stringify(answers), JSON.stringify(grades), id);
}

export function deleteRow(table: "exams" | "notes" | "podcasts", id: string) {
  db().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

export function saveNote(n: Omit<ReviewNote, "id" | "created_at">): ReviewNote {
  const id = newId();
  db()
    .prepare("INSERT INTO notes (id, course_id, title, scope, content, generated_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, n.course_id, n.title, n.scope, n.content, n.generated_by);
  return db().prepare("SELECT * FROM notes WHERE id = ?").get(id) as ReviewNote;
}

export function listNotes(courseId: string): ReviewNote[] {
  return db().prepare("SELECT * FROM notes WHERE course_id = ? ORDER BY created_at DESC").all(courseId) as ReviewNote[];
}

function mapPodcast(r: Row): Podcast {
  return { ...(r as unknown as Podcast), hosts: json(r.hosts, { A: "Alex", B: "Sam" }), segments: json(r.segments, []) };
}

export function savePodcast(p: Omit<Podcast, "id" | "created_at">): Podcast {
  const id = newId();
  db()
    .prepare("INSERT INTO podcasts (id, course_id, title, scope, hosts, segments, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, p.course_id, p.title, p.scope, JSON.stringify(p.hosts), JSON.stringify(p.segments), p.generated_by);
  return mapPodcast(db().prepare("SELECT * FROM podcasts WHERE id = ?").get(id) as Row);
}

export function listPodcasts(courseId: string): Podcast[] {
  return (db().prepare("SELECT * FROM podcasts WHERE course_id = ? ORDER BY created_at DESC").all(courseId) as Row[]).map(mapPodcast);
}

/* ---------------- Knowledge links ---------------- */

export function replaceLinks(links: Omit<KnowledgeLink, "id">[]) {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM links").run();
    const ins = d.prepare("INSERT INTO links (id, from_topic, to_topic, score, relation) VALUES (?, ?, ?, ?, ?)");
    const exists = d.prepare("SELECT 1 FROM topics WHERE id = ?");
    // Topics may have been rebuilt while links were being computed.
    for (const l of links) if (exists.get(l.from_topic) && exists.get(l.to_topic)) ins.run(newId(), l.from_topic, l.to_topic, l.score, l.relation);
  })();
}

export function listLinks(): KnowledgeLink[] {
  return db().prepare("SELECT * FROM links ORDER BY score DESC").all() as KnowledgeLink[];
}

export function linksForTopic(topicId: string): KnowledgeLink[] {
  return db().prepare("SELECT * FROM links WHERE from_topic = ? OR to_topic = ? ORDER BY score DESC").all(topicId, topicId) as KnowledgeLink[];
}

export function allTopics(): Topic[] {
  return (db().prepare("SELECT * FROM topics ORDER BY course_id, position").all() as Row[]).map(mapTopic);
}

/* ---------------- helpers ---------------- */

export function normTitle(s: string) {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function clampInt(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
}
