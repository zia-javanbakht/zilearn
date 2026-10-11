import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { db } from "./db";
import { allTopics, listCourses, listLinks, replaceLinks } from "./store";
import { cosine, sharedTerms, tfidfVectors } from "./text";
import type { KnowledgeLink, Topic } from "./types";

/* ---------------- Search ---------------- */

export interface SearchHit {
  type: "topic" | "material";
  id: string;
  course_id: string;
  course_name: string;
  title: string;
  snippet: string;
  material_id?: string;
  topic_id?: string;
  score: number;
}

/** Turn free text into a safe FTS5 query: every word as a prefix term, OR-ed, with exact phrase boosted. */
export function ftsQuery(q: string): string | null {
  const all = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  // Single letters (e.g. the languages "C" or "R") only count when they are the whole query.
  const words = (all.length === 1 ? all : all.filter((w) => w.length > 1)).slice(0, 12);
  if (!words.length) return null;
  const terms = words.map((w) => `"${w}"*`);
  return words.length > 1 ? `"${words.join(" ")}" OR ${terms.join(" OR ")}` : terms[0];
}

export function search(q: string, courseId?: string, limit = 40): SearchHit[] {
  const fq = ftsQuery(q);
  if (!fq) return [];
  const d = db();
  const courses = new Map(listCourses().map((c) => [c.id, c.name]));
  const courseFilter = courseId ? "AND course_id = ?" : "";
  const args = courseId ? [fq, courseId, limit] : [fq, limit];

  const topics = d
    .prepare(
      `SELECT topic_id, course_id, title, snippet(topics_fts, 1, '[[', ']]', '…', 24) AS snip, bm25(topics_fts, 5.0, 1.0, 2.0) AS rank
       FROM topics_fts WHERE topics_fts MATCH ? ${courseFilter} ORDER BY rank LIMIT ?`,
    )
    .all(...args) as { topic_id: string; course_id: string; title: string; snip: string; rank: number }[];

  const chunks = d
    .prepare(
      `SELECT f.material_id, f.course_id, m.title, snippet(chunks_fts, 0, '[[', ']]', '…', 32) AS snip, bm25(chunks_fts) AS rank
       FROM chunks_fts f JOIN materials m ON m.id = f.material_id
       WHERE chunks_fts MATCH ? ${courseFilter.replace("course_id", "f.course_id")} ORDER BY rank LIMIT ?`,
    )
    .all(...args) as { material_id: string; course_id: string; title: string; snip: string; rank: number }[];

  const hits: SearchHit[] = [];
  for (const t of topics) {
    hits.push({ type: "topic", id: `t:${t.topic_id}`, topic_id: t.topic_id, course_id: t.course_id, course_name: courses.get(t.course_id) ?? "", title: t.title, snippet: t.snip, score: -t.rank * 1.5 });
  }
  const seenMaterial = new Map<string, number>();
  for (const c of chunks) {
    // Keep at most 2 snippets per material.
    const n = seenMaterial.get(c.material_id) ?? 0;
    if (n >= 2) continue;
    seenMaterial.set(c.material_id, n + 1);
    hits.push({ type: "material", id: `m:${c.material_id}:${n}`, material_id: c.material_id, course_id: c.course_id, course_name: courses.get(c.course_id) ?? "", title: c.title, snippet: c.snip, score: -c.rank });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Pull the most relevant source excerpts for a topic, within one course. */
export function excerptsFor(courseId: string, query: string, maxChars = 12000, materialIds: string[] = []): string[] {
  const fq = ftsQuery(query);
  if (!fq) return [];
  const rows = db()
    .prepare(
      `SELECT f.content, f.material_id, m.title FROM chunks_fts f JOIN materials m ON m.id = f.material_id
       WHERE chunks_fts MATCH ? AND f.course_id = ? ORDER BY bm25(chunks_fts) LIMIT 40`,
    )
    .all(fq, courseId) as { content: string; material_id: string; title: string }[];
  // Prefer chunks from the topic's own source materials.
  const pref = new Set(materialIds);
  rows.sort((a, b) => Number(pref.has(b.material_id)) - Number(pref.has(a.material_id)));
  const out: string[] = [];
  let used = 0;
  for (const r of rows) {
    if (used + r.content.length > maxChars) continue;
    out.push(`[${r.title}]\n${r.content}`);
    used += r.content.length;
  }
  return out;
}

export interface Source {
  title: string;
  kind: string;
  text: string;
}

/**
 * Source text for teaching a topic, in reading order: the topic's own materials whole when they fit,
 * otherwise their best-matching passages in the order they appear (neighbouring passages joined), then
 * matching passages from the rest of the course. Reading order keeps derivations and timestamps intact.
 */
export function sourcesFor(courseId: string, query: string, maxChars = 20000, materialIds: string[] = []): Source[] {
  const own = materialIds.length
    ? (db()
        .prepare(`SELECT id, title, kind, text FROM materials WHERE course_id = ? AND id IN (${materialIds.map(() => "?").join(",")})`)
        .all(courseId, ...materialIds) as { id: string; title: string; kind: string; text: string | null }[])
    : [];
  own.sort((a, b) => materialIds.indexOf(a.id) - materialIds.indexOf(b.id));
  const total = own.reduce((n, m) => n + (m.text?.length ?? 0), 0);
  if (own.length && total <= maxChars * 0.8) {
    const out: Source[] = own.filter((m) => m.text?.trim()).map((m) => ({ title: m.title, kind: m.kind, text: m.text!.trim() }));
    return [...out, ...passages(courseId, query, maxChars - total, new Set(own.map((m) => m.id)), true)];
  }
  return passages(courseId, query, maxChars, new Set(materialIds), false);
}

/** Best-matching chunks, grouped by material in document order; `skip` materials are left out when `exclude`. */
function passages(courseId: string, query: string, budget: number, prefer: Set<string>, exclude: boolean): Source[] {
  const fq = ftsQuery(query);
  if (!fq || budget < 300) return [];
  const rows = db()
    .prepare(
      `SELECT f.content, f.material_id, f.chunk_index, m.title, m.kind FROM chunks_fts f JOIN materials m ON m.id = f.material_id
       WHERE chunks_fts MATCH ? AND f.course_id = ? ORDER BY bm25(chunks_fts) LIMIT 40`,
    )
    .all(fq, courseId) as { content: string; material_id: string; chunk_index: number; title: string; kind: string }[];
  const ranked = rows.filter((r) => !(exclude && prefer.has(r.material_id)));
  ranked.sort((a, b) => Number(prefer.has(b.material_id)) - Number(prefer.has(a.material_id)));
  const picked: typeof ranked = [];
  let used = 0;
  for (const r of ranked) {
    if (used + r.content.length > budget) continue;
    picked.push(r);
    used += r.content.length;
  }
  const byMaterial = new Map<string, typeof picked>();
  for (const r of picked) byMaterial.set(r.material_id, [...(byMaterial.get(r.material_id) ?? []), r]);
  return [...byMaterial.values()].map((rs) => {
    rs.sort((a, b) => a.chunk_index - b.chunk_index);
    // The first chunk starts with the title (it's indexed with the text); gaps are marked.
    const text = rs
      .map((r, i) => (i && r.chunk_index !== rs[i - 1].chunk_index + 1 ? "[…]\n" : "") + (r.chunk_index === 0 ? r.content.replace(/^.*\n/, "") : r.content))
      .join("\n");
    return { title: rs[0].title, kind: rs[0].kind, text: rs[0].chunk_index ? `[…]\n${text}` : text };
  });
}

/* ---------------- Cross-course links ---------------- */

const LINK_THRESHOLD = 0.18;
const MAX_LINKS_PER_TOPIC = 5;

function topicDoc(t: Topic) {
  return `${t.title} ${t.title} ${t.title} ${t.keywords.join(" ")} ${t.keywords.join(" ")} ${t.summary}`;
}

const SAME_COURSE_THRESHOLD = 0.3;

/**
 * Find similar topics with TF-IDF cosine similarity: across courses, and (with a
 * stricter threshold) between distant parts of the same course. Topics that are
 * already adjacent in the tree (parent/child or siblings) are not linked.
 */
export function computeLinks(topics: Topic[], threshold = LINK_THRESHOLD): Omit<KnowledgeLink, "id">[] {
  const vecs = tfidfVectors(topics.map(topicDoc));
  const cand: { a: number; b: number; s: number }[] = [];
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const x = topics[i];
      const y = topics[j];
      const same = x.course_id === y.course_id;
      if (same && (x.parent_id === y.id || y.parent_id === x.id || x.parent_id === y.parent_id)) continue;
      const s = cosine(vecs[i], vecs[j]);
      if (s >= (same ? SAME_COURSE_THRESHOLD : threshold)) cand.push({ a: i, b: j, s });
    }
  }
  cand.sort((x, y) => y.s - x.s);
  const count = new Map<number, number>();
  const out: Omit<KnowledgeLink, "id">[] = [];
  for (const c of cand) {
    if ((count.get(c.a) ?? 0) >= MAX_LINKS_PER_TOPIC || (count.get(c.b) ?? 0) >= MAX_LINKS_PER_TOPIC) continue;
    count.set(c.a, (count.get(c.a) ?? 0) + 1);
    count.set(c.b, (count.get(c.b) ?? 0) + 1);
    const terms = sharedTerms(vecs[c.a], vecs[c.b]);
    out.push({
      from_topic: topics[c.a].id,
      to_topic: topics[c.b].id,
      score: Math.round(c.s * 1000) / 1000,
      relation: terms.length ? `Shared concepts: ${terms.join(", ")}` : null,
    });
  }
  return out;
}

/**
 * Recompute keyword links after a brainmap changes, keeping explanations Claude
 * wrote earlier for pairs that are still linked. No API calls.
 */
export function refreshLinks() {
  const previous = new Map(listLinks().map((l) => [[l.from_topic, l.to_topic].sort().join("|"), l]));
  const fresh = computeLinks(allTopics()).map((l) => {
    const old = previous.get([l.from_topic, l.to_topic].sort().join("|"));
    return old?.relation && !old.relation.startsWith("Shared concepts") ? { ...l, relation: old.relation } : l;
  });
  // Keep Claude-found links that keyword matching can't see.
  const have = new Set(fresh.map((l) => [l.from_topic, l.to_topic].sort().join("|")));
  for (const [k, l] of previous) if (!have.has(k) && l.relation && !l.relation.startsWith("Shared concepts") && l.score === 0.5) fresh.push(l);
  replaceLinks(fresh);
}

const RelationSchema = z.object({
  links: z.array(
    z.object({
      index: z.number().int(),
      related: z.boolean().describe("false if the overlap is superficial (same word, different meaning)"),
      relation: z.string().describe("One sentence on how the two topics connect, e.g. 'X is the probabilistic foundation for Y'"),
    }),
  ),
  extra: z
    .array(z.object({ a: z.string(), b: z.string(), relation: z.string() }))
    .describe("Up to 10 additional strong cross-course connections not in the candidate list, by topic id"),
});

/** Rebuild the knowledge base links. With Claude, candidates are verified and explained, and missed links are added. */
export async function rebuildKnowledgeBase(): Promise<{ links: number; by: "claude" | "heuristic" }> {
  const topics = allTopics();
  let links = computeLinks(topics);
  let by: "claude" | "heuristic" = "heuristic";
  const courseCount = new Set(topics.map((t) => t.course_id)).size;

  if (aiEnabled() && courseCount > 1 && topics.length) {
    const byId = new Map(topics.map((t) => [t.id, t]));
    const courses = new Map(listCourses().map((c) => [c.id, c.name]));
    const shortId = new Map(topics.map((t, i) => [t.id, `T${i}`]));
    const fromShort = new Map(topics.map((t, i) => [`T${i}`, t.id]));
    const candidates = links.slice(0, 80);
    const catalog = topics
      .slice(0, 600)
      .map((t) => `${shortId.get(t.id)} [${courses.get(t.course_id)}] ${t.title}: ${t.summary.slice(0, 160)}`)
      .join("\n");
    const cands = candidates
      .map((l, i) => `${i}. ${shortId.get(l.from_topic)} "${byId.get(l.from_topic)?.title}" <-> ${shortId.get(l.to_topic)} "${byId.get(l.to_topic)?.title}"`)
      .join("\n");
    const out = await generateStructured({
      schema: RelationSchema,
      effort: "low",
      prompt: `A student is taking several courses. Here is every topic across their courses (the bracket names the course):\n\n${catalog}\n\nCandidate cross-course links found by keyword similarity:\n${cands || "(none)"}\n\nFor each candidate, decide whether the topics are genuinely related and describe the connection in one sentence. Then add up to 10 strong cross-course connections that keyword matching missed (only between different courses).`,
    });
    const verdict = new Map(out.links.map((l) => [l.index, l]));
    links = candidates
      .map((l, i) => ({ link: { ...l, relation: verdict.get(i)?.relation ?? l.relation }, keep: verdict.get(i)?.related !== false }))
      .filter((x) => x.keep)
      .map((x) => x.link)
      .concat(links.slice(80));
    for (const e of out.extra) {
      const a = fromShort.get(e.a);
      const b = fromShort.get(e.b);
      if (a && b && a !== b && byId.get(a)!.course_id !== byId.get(b)!.course_id) {
        links.push({ from_topic: a, to_topic: b, score: 0.5, relation: e.relation });
      }
    }
    by = "claude";
  }
  replaceLinks(links);
  return { links: links.length, by };
}
