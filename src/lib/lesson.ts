import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { excerptsFor } from "./kb";
import { buildTree, flattenTree, getCourse, getLesson, getTopic, getTopicsByIds, linksForTopic, listCourses, listMaterials, listTopics } from "./store";
import { truncate } from "./text";
import { DEPTH_LEVELS, MASTERY_LABELS, type Mastery } from "./types";

/**
 * Lessons as structured documents: categorised blocks (definitions, key points, intuitions, examples,
 * formulas, procedures, pitfalls, comparisons), recall and check-yourself questions, connections, and
 * takeaways, placed in the brainmap (where the topic sits, what it builds on, what comes next, and links
 * to topics in other courses). The same document renders to Markdown for the app and to LaTeX with
 * the Z class for printing.
 */

export const BLOCK_KINDS = ["definition", "keypoint", "intuition", "example", "formula", "procedure", "pitfall", "comparison", "note"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface LessonBlock {
  kind: BlockKind;
  title: string;
  body: string; // Markdown with $LaTeX$
  solution?: string | null; // worked solution, for examples
}

export interface QA {
  question: string;
  answer: string;
}

export interface LessonMap {
  course: string;
  path: string[]; // ancestors, root first
  children: { title: string; mastery: Mastery | null }[];
  before: string[]; // earlier siblings: what this topic builds on
  after: string[]; // later siblings: what builds on it
  related: { course: string; title: string; relation: string | null }[]; // other courses
}

export interface LessonDoc {
  title: string;
  depth: number;
  level: string;
  goal: string;
  where_it_fits: string;
  map: LessonMap;
  recall: QA[];
  blocks: LessonBlock[];
  key_points: string[];
  common_mistakes: string[];
  connections: { topic: string; relation: string }[];
  check_yourself: QA[];
  takeaways: string[];
  read: string[]; // material titles to look at
  by: "claude" | "heuristic";
  truncated?: boolean;
}

const QASchema = z.object({ question: z.string(), answer: z.string().describe("Concise model answer") });

const LessonSchema = z.object({
  where_it_fits: z.string().describe("2-3 sentences placing the topic in the course map: what it builds on, what it leads to"),
  recall: z.array(QASchema).describe("Warm-up questions on the previous level (empty for level 1)"),
  blocks: z
    .array(
      z.object({
        kind: z.enum(BLOCK_KINDS),
        title: z.string().describe("Short title of the block"),
        body: z.string().describe("Markdown; maths in LaTeX ($...$ inline, $$...$$ display)"),
        solution: z.string().nullable().describe("Fully worked solution for an example, otherwise null"),
      }),
    )
    .describe("The lesson itself, in teaching order"),
  key_points: z.array(z.string()).describe("3-7 key points to remember"),
  common_mistakes: z.array(z.string()).describe("Typical misconceptions or errors (may be empty at level 1)"),
  connections: z.array(z.object({ topic: z.string(), relation: z.string() })).describe("How this topic relates to the named neighbouring or related topics"),
  check_yourself: z.array(QASchema).describe("3-5 questions at this level, with answers"),
  takeaways: z.array(z.string()).describe("3-5 critical takeaways"),
  read: z.array(z.string()).describe("Titles of the student's materials worth reading for this topic"),
});

/** What each level emphasises, in terms of the block kinds. */
const LEVEL_BLOCKS: Record<number, string> = {
  1: "1-2 definitions, 1-2 intuitions (analogies, pictures in words), 1 simple example, key points. No derivations.",
  2: "definitions stated precisely, intuitions for why it works, a procedure or formula block for the mechanism, 1-2 examples, pitfalls, and a comparison with a neighbouring topic.",
  3: "the formulas and procedures needed, 2 fully worked exam-style examples (with solutions), pitfalls, and practice problems in check_yourself.",
  4: "edge cases and limitations (pitfall/note blocks), comparisons with related topics, one hard worked example, and key points that tie it to the rest of the course.",
};

/** Where a topic sits in its course brainmap and how it links to other courses. */
export function lessonMap(topicId: string): LessonMap & { mastery: Mastery | null; summary: string; keywords: string[]; material_ids: string[] } {
  const topic = getTopic(topicId)!;
  const course = getCourse(topic.course_id)!;
  const all = flattenTree(buildTree(listTopics(topic.course_id)));
  const byId = new Map(all.map((n) => [n.id, n]));
  const node = byId.get(topic.id);
  const path: string[] = [];
  for (let p = topic.parent_id; p && byId.has(p) && path.length < 10; p = byId.get(p)!.parent_id) path.unshift(byId.get(p)!.title);
  const siblings = all.filter((n) => n.parent_id === topic.parent_id).sort((a, b) => a.position - b.position);
  const at = siblings.findIndex((n) => n.id === topic.id);
  const links = linksForTopic(topic.id);
  const others = new Map(getTopicsByIds(links.map((l) => (l.from_topic === topic.id ? l.to_topic : l.from_topic))).map((t) => [t.id, t]));
  const courses = new Map(listCourses().map((c) => [c.id, c.name]));
  return {
    course: course.name,
    path,
    children: (node?.children ?? []).map((c) => ({ title: c.title, mastery: c.effective_mastery })),
    before: siblings.slice(Math.max(0, at - 3), Math.max(0, at)).map((n) => n.title),
    after: siblings.slice(at + 1, at + 4).map((n) => n.title),
    related: links
      .map((l) => others.get(l.from_topic === topic.id ? l.to_topic : l.from_topic))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .slice(0, 6)
      .map((t) => ({ course: courses.get(t.course_id) ?? "", title: t.title, relation: links.find((l) => l.from_topic === t.id || l.to_topic === t.id)?.relation ?? null })),
    mastery: node?.effective_mastery ?? null,
    summary: topic.summary,
    keywords: topic.keywords,
    material_ids: topic.material_ids,
  };
}

export async function generateLessonDoc(topicId: string, depth: number): Promise<LessonDoc> {
  const topic = getTopic(topicId)!;
  const d = Math.min(4, Math.max(1, depth));
  const level = DEPTH_LEVELS[d - 1];
  const map = lessonMap(topicId);
  const excerpts = excerptsFor(topic.course_id, `${topic.title} ${topic.keywords.join(" ")}`, 20000, topic.material_ids);
  const materials = listMaterials(topic.course_id).filter((m) => topic.material_ids.includes(m.id));
  const head = { title: topic.title, depth: d, level: level.name, goal: level.goal, map: stripMap(map) };

  if (!aiEnabled()) return offlineLesson(head, map, excerpts, materials.map((m) => m.title));

  const previous = d > 1 ? getLesson(topic.id, d - 1) : null;
  const mapText = [
    `Course: ${map.course}`,
    `Path in the brainmap: ${[...map.path, topic.title].join(" > ")}`,
    map.before.length ? `Comes after (builds on): ${map.before.join("; ")}` : "",
    map.after.length ? `Comes before (leads to): ${map.after.join("; ")}` : "",
    map.children.length ? `Subtopics: ${map.children.map((c) => `${c.title} (${c.mastery ? MASTERY_LABELS[c.mastery] : "not marked"})`).join("; ")}` : "",
    map.related.length ? `Related topics in other courses: ${map.related.map((r) => `${r.title} [${r.course}]${r.relation ? `: ${r.relation}` : ""}`).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const out = await generateStructured({
    schema: LessonSchema,
    effort: "medium",
    maxTokens: 20000,
    context: `<sources>\n${excerpts.join("\n\n---\n\n") || "(no excerpts found)"}\n</sources>`,
    prompt: `${mapText}
Topic: ${topic.title}
Topic summary: ${topic.summary}
Key terms: ${topic.keywords.join(", ")}
Student's self-assessment: ${map.mastery ? MASTERY_LABELS[map.mastery] : "not marked"}
Materials on this topic: ${materials.map((m) => m.title).join("; ") || "(none)"}
${previous ? `\nThe student studied the previous level already; build on it, don't repeat it:\n<previous_lesson>\n${truncate(previous.content, 6000)}\n</previous_lesson>\n` : ""}
Above are excerpts from the student's own materials on this topic.

Write a lesson on this topic for pass ${d} of 4, the "${level.name}" level: ${level.goal}
Earlier passes covered shallower levels and later ones go deeper, so teach exactly this depth.
${level.lesson}

Organise it into categorised blocks. At this level use: ${LEVEL_BLOCKS[d]}
- Use the brainmap: say in where_it_fits what this topic builds on and leads to, and in connections explain how it relates to the neighbouring, sub- and cross-course topics named above (use their exact names).
- Ground the content in the student's materials; name the ones worth reading in read.
- Maths in LaTeX ($...$ inline, $$...$$ display). No Mermaid diagrams (the map is drawn separately).
${d === 1 ? "- recall: empty." : "- recall: 2 quick questions on the previous level."}`,
  });
  return {
    ...head,
    by: "claude",
    where_it_fits: out.where_it_fits,
    recall: out.recall.slice(0, 4),
    blocks: out.blocks.map((b) => ({ ...b, solution: b.solution || null })),
    key_points: out.key_points,
    common_mistakes: out.common_mistakes,
    connections: out.connections,
    check_yourself: out.check_yourself,
    takeaways: out.takeaways,
    read: out.read,
  };
}

function stripMap(m: ReturnType<typeof lessonMap>): LessonMap {
  return { course: m.course, path: m.path, children: m.children, before: m.before, after: m.after, related: m.related };
}

/** Without an AI: the topic's own summary and terms, the map, and passages from the student's materials. */
function offlineLesson(head: Pick<LessonDoc, "title" | "depth" | "level" | "goal" | "map">, map: ReturnType<typeof lessonMap>, excerpts: string[], read: string[]): LessonDoc {
  const t = head.title;
  const neighbours = [...map.before.map((x) => ({ topic: x, relation: "comes before it in the course; review it first" })), ...map.after.map((x) => ({ topic: x, relation: "builds on it" }))];
  return {
    ...head,
    by: "heuristic",
    where_it_fits: `**${t}** is part of ${map.path.length ? `*${map.path.join(" › ")}*` : `*${map.course}*`}.${map.before.length ? ` It follows ${map.before.join(", ")}.` : ""}${map.after.length ? ` It leads to ${map.after.join(", ")}.` : ""}`,
    recall: head.depth > 1 ? [{ question: `Explain ${t} in two sentences.`, answer: map.summary || "Check your notes." }] : [],
    blocks: [
      { kind: "definition", title: t, body: map.summary || `${t}, as covered in your materials.` },
      ...excerpts.slice(0, head.depth + 1).map((e, i) => ({ kind: "note" as const, title: `From your materials (${i + 1})`, body: truncate(e, 1500) })),
    ],
    key_points: map.keywords.length ? map.keywords.map((k) => `Know what **${k}** means and how it is used in ${t}.`) : [`Explain ${t} without notes.`],
    common_mistakes: [],
    connections: [...neighbours, ...map.children.map((c) => ({ topic: c.title, relation: "a subtopic" })), ...map.related.map((r) => ({ topic: `${r.title} (${r.course})`, relation: r.relation ?? "a similar idea in another course" }))],
    check_yourself: [
      { question: `Can you explain ${t} in two sentences without notes?`, answer: map.summary || "Compare with your sources." },
      ...(head.depth >= 2 ? [{ question: `How does ${t} connect to the topics around it?`, answer: "See Connections." }] : []),
      ...(head.depth >= 3 ? [{ question: `Solve one problem that uses ${t}.`, answer: "Check against your sources." }] : []),
    ],
    takeaways: [map.summary || t].filter(Boolean),
    read,
  };
}

/* ---------------- Markdown (the app) ---------------- */

const BLOCK_LABEL: Record<BlockKind, string> = {
  definition: "Definition",
  keypoint: "Key point",
  intuition: "Intuition",
  example: "Example",
  formula: "Formula",
  procedure: "Procedure",
  pitfall: "Pitfall",
  comparison: "Comparison",
  note: "Note",
};
const BLOCK_ICON: Record<BlockKind, string> = {
  definition: "📘",
  keypoint: "⭐",
  intuition: "💡",
  example: "✏️",
  formula: "∑",
  procedure: "🪜",
  pitfall: "⚠️",
  comparison: "⚖️",
  note: "📝",
};

/** Mermaid flowchart of the topic's neighbourhood in the brainmap. */
export function lessonMermaid(doc: LessonDoc): string {
  const q = (s: string) => `"${s.replace(/["#;`<>]/g, " ").slice(0, 48)}"`;
  const lines = ["flowchart LR", `  T[${q(doc.title)}]:::me`];
  doc.map.path.slice(-2).forEach((p, i, a) => lines.push(`  P${i}[${q(p)}]`, i ? `  P${i - 1} --> P${i}` : "", i === a.length - 1 ? `  P${i} --> T` : ""));
  doc.map.before.forEach((b, i) => lines.push(`  B${i}[${q(b)}]:::side`, `  B${i} -. before .-> T`));
  doc.map.after.forEach((b, i) => lines.push(`  A${i}[${q(b)}]:::side`, `  T -. leads to .-> A${i}`));
  doc.map.children.slice(0, 8).forEach((c, i) => lines.push(`  C${i}[${q(c.title)}]`, `  T --> C${i}`));
  doc.map.related.slice(0, 4).forEach((r, i) => lines.push(`  R${i}[${q(`${r.title} · ${r.course}`)}]:::other`, `  T <-. related .-> R${i}`));
  lines.push("  classDef me fill:#e8edff,stroke:#3b5bdb,stroke-width:2px", "  classDef side fill:#f5f5f5,stroke:#999", "  classDef other fill:#fff4e6,stroke:#e8590c");
  return lines.filter(Boolean).join("\n");
}

export function lessonToMarkdown(doc: LessonDoc): string {
  const out: string[] = [];
  out.push(`### Where this fits\n\n${doc.where_it_fits}`);
  if (doc.map.path.length || doc.map.children.length || doc.map.before.length || doc.map.after.length || doc.map.related.length)
    out.push("```mermaid\n" + lessonMermaid(doc) + "\n```");
  if (doc.recall.length) out.push(`### Warm-up\n\n${doc.recall.map((r, i) => `${i + 1}. ${r.question}`).join("\n")}\n\n${details("Answers", doc.recall.map((r, i) => `${i + 1}. ${r.answer}`).join("\n"))}`);
  for (const b of doc.blocks) {
    const sol = b.solution ? `\n\n${details("Solution", b.solution)}` : "";
    // A coloured box per kind (styled in globals.css), like the Z class's boxes in print.
    out.push(`<div class="lb lb-${b.kind}">\n\n**${BLOCK_ICON[b.kind]} ${BLOCK_LABEL[b.kind]}: ${b.title}**\n\n${b.body}${sol}\n\n</div>`);
  }
  if (doc.key_points.length) out.push(`### Key points\n\n${doc.key_points.map((k) => `- ${k}`).join("\n")}`);
  if (doc.common_mistakes.length) out.push(`### Common mistakes\n\n${doc.common_mistakes.map((k) => `- ${k}`).join("\n")}`);
  if (doc.connections.length) out.push(`### Connections\n\n${doc.connections.map((c) => `- **${c.topic}**: ${c.relation}`).join("\n")}`);
  if (doc.check_yourself.length)
    out.push(`### Check yourself\n\n${doc.check_yourself.map((r, i) => `${i + 1}. ${r.question}`).join("\n")}\n\n${details("Answers", doc.check_yourself.map((r, i) => `${i + 1}. ${r.answer}`).join("\n\n"))}`);
  if (doc.takeaways.length) out.push(`### Critical takeaways\n\n${doc.takeaways.map((k) => `- ${k}`).join("\n")}`);
  if (doc.read.length) out.push(`**Read next:** ${doc.read.join("; ")}`);
  return out.join("\n\n");
}

function details(summary: string, body: string) {
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;
}
