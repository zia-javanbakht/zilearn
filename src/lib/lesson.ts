import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { sourcesFor } from "./kb";
import { checkLesson, refereeLesson } from "./lessonCheck";
import { studentRecord, type StudentRecord } from "./lessonRecord";
import { offlineLesson, sourceQuestions } from "./lessonOffline";
import { diagramMermaid, figureProblems, FigureSchema, type Figure } from "./figure";
import { buildTree, flattenTree, getCourse, getLesson, getTopic, getTopicsByIds, linksForTopic, listCourses, listMaterials, listTopics } from "./store";
import { truncate } from "./text";
import { DEPTH_LEVELS, MASTERY_LABELS, MATERIAL_KIND_LABELS, type MaterialKind, type Mastery } from "./types";

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
  source?: string | null; // where in the student's materials, e.g. "Lecture 3 recording [12:30]"
  figure?: Figure | null;
}

export interface LessonSection {
  heading: string;
  blocks: LessonBlock[];
}

export const QUESTION_KINDS = ["recall", "explain", "apply", "transfer"] as const;

export interface QA {
  question: string;
  answer: string;
  kind?: (typeof QUESTION_KINDS)[number];
  hint?: string | null;
}

export interface Mistake {
  mistake: string;
  correction: string;
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
  version?: 2;
  title: string;
  depth: number;
  level: string;
  goal: string;
  objectives: string[];
  where_it_fits: string;
  map: LessonMap;
  recall: QA[];
  sections: LessonSection[];
  glossary: { term: string; meaning: string }[];
  common_mistakes: Mistake[];
  connections: { topic: string; relation: string }[];
  check_yourself: QA[];
  takeaways: string[];
  read: { title: string; focus: string }[];
  by: "claude" | "heuristic";
  /** Lessons saved before sections and the glossary: a flat block list and key points. */
  blocks?: LessonBlock[];
  key_points?: string[];
}

/** Brings a lesson saved by an earlier version to the current shape. */
export const BEYOND_NOTES = "Beyond your notes";

/**
 * For display: an AI lesson that cites its sources marks the blocks that cite none as going beyond the
 * student's notes, so they can tell what their course said from what was added.
 */
export function markProvenance(doc: LessonDoc): LessonDoc {
  const tracked = doc.by !== "heuristic" && doc.sections.some((x) => x.blocks.some((b) => b.source));
  if (!tracked) return doc;
  return { ...doc, sections: doc.sections.map((x) => ({ ...x, blocks: x.blocks.map((b) => (b.source ? b : { ...b, source: BEYOND_NOTES })) })) };
}

export function normalizeDoc(raw: LessonDoc): LessonDoc {
  const d = raw as LessonDoc & { common_mistakes: (Mistake | string)[]; read: ({ title: string; focus: string } | string)[] };
  return {
    ...d,
    objectives: d.objectives ?? [],
    sections: d.sections ?? (d.blocks?.length ? [{ heading: "Lesson", blocks: d.blocks }] : []),
    glossary: d.glossary ?? [],
    common_mistakes: (d.common_mistakes ?? []).map((m) => (typeof m === "string" ? { mistake: m, correction: "" } : m)),
    read: (d.read ?? []).map((r) => (typeof r === "string" ? { title: r, focus: "" } : r)),
    check_yourself: d.check_yourself ?? [],
    recall: d.recall ?? [],
  };
}

const QASchema = z.object({
  question: z.string(),
  answer: z.string().describe("Model answer: the reasoning in brief and the result, with units"),
  kind: z.enum(QUESTION_KINDS).describe("recall a fact, explain why, apply to a problem, or transfer to a new situation"),
  hint: z.string().nullable().describe("A nudge that doesn't give the answer away, or null"),
});

const BlockSchema = z.object({
  kind: z.enum(BLOCK_KINDS),
  title: z.string().describe("Short title naming the idea (not the kind): e.g. 'Why the envelope is exponential'"),
  body: z.string().describe("Markdown; maths in KaTeX-compatible LaTeX ($...$ inline, $$...$$ display)"),
  solution: z.string().nullable().describe("For examples: the full worked solution as numbered steps, ending with the boxed or bold result and a sanity check. Otherwise null"),
  source: z.string().nullable().describe("Where this comes from in the sources: the source title plus a timestamp, section or question number, e.g. 'Lecture 3 recording [12:30]'. Null if it isn't from them"),
  figure: FigureSchema,
});

export const LessonSchema = z.object({
  objectives: z.array(z.string()).describe("2-4 things the student can do after this pass, each starting with a verb (Explain, Compute, Choose...)"),
  where_it_fits: z.string().describe("2-3 sentences placing the topic in the course map: what it builds on, what it leads to"),
  recall: z.array(QASchema).describe("Warm-up questions on the previous level (empty for level 1)"),
  sections: z
    .array(z.object({ heading: z.string().describe("A heading that says what the section teaches"), blocks: z.array(BlockSchema) }))
    .describe("The lesson itself in teaching order, in 2-5 sections"),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string().describe("One line; the symbol and units if it has them") })).describe("The key terms and symbols used, 3-8"),
  common_mistakes: z.array(z.object({ mistake: z.string(), correction: z.string().describe("What is right instead, and how to avoid the slip") })).describe("Typical misconceptions or errors (may be empty at level 1)"),
  connections: z.array(z.object({ topic: z.string().describe("Exact topic name from the brainmap"), relation: z.string() })).describe("How this topic relates to the named neighbouring, sub- and cross-course topics"),
  check_yourself: z.array(QASchema).describe("3-5 questions at this level, with answers"),
  takeaways: z.array(z.string()).describe("3-5 critical takeaways: the ideas to keep if everything else is forgotten, not a repeat of the glossary"),
  read: z.array(z.object({ title: z.string().describe("Exact source title"), focus: z.string().describe("What to look at there and why: a section, timestamp or question") })).describe("The student's materials worth going back to"),
});

/** What each level teaches, in terms of the block kinds. */
const LEVEL_BLOCKS: Record<number, string> = {
  1: `Big picture only, about 600-900 words. Start from the phenomenon or problem the topic solves, then the idea in plain words (intuition blocks with an analogy or a picture in words), 1-2 definition blocks stating the key terms simply, and one short example that needs no derivation. No derivations, no exam-style problems.`,
  2: `How and why it works, about 1000-1500 words. Precise definitions; intuition for each step of the mechanism; a formula block for each key result, saying what every symbol means and when it applies; the reasoning or derivation in short steps; 1-2 examples; pitfall blocks for the misconceptions; and a comparison block with a neighbouring or related topic.`,
  3: `Problem solving, about 1200-2000 words. A procedure block with the solution method as numbered steps; the formula blocks needed (with units); 2 fully worked exam-style examples of increasing difficulty, styled on the tutorial and exam questions in the sources but with different numbers; pitfall blocks for the errors students make in exams. check_yourself holds 3-4 practice problems (kind "apply") with worked answers.`,
  4: `Mastery, about 1000-1800 words. Assumptions, limitations and edge cases (when the model breaks down), comparison blocks with related topics in this and other courses, one hard multi-step or 'explain why' exam question worked fully, and a teach-back note asking the student to explain it from memory. check_yourself mixes "explain" and "transfer" questions.`,
};

const RULES = `How to write it:
- Teach, don't summarise. Concrete before abstract: motivate with the situation or phenomenon, then give the idea, then the formal statement.
- Use the student's sources as the backbone: their notation, their symbols, their examples and their lecturer's advice. Where a block comes from a source, set source to its title plus a timestamp, section or question number. You may add standard textbook knowledge to fill gaps, but never contradict the sources.
- The numbered questions in the student's tutorial, workshop and exam sources are theirs to attempt: never solve them or give their answers anywhere (examples, solutions, check_yourself). Write your own on the same pattern with different numbers and a different setting, and point to the originals in read ("then try Q2").
- A source must point to text that states that block's claim. Material from beyond the sources (standard textbook knowledge) has source null; the app marks it "Beyond your notes" so the student knows what their course said.
- Figure captions say what the figure shows; they never state a quantity an example or question asks the student to find.
- Each block teaches one idea. Titles name the idea. Don't repeat the same point across blocks, glossary and takeaways.
- Worked solutions: numbered steps, each saying what is done and why; carry units; finish with the result in bold and a quick sanity check (order of magnitude, limiting case or units).
- Maths: KaTeX-compatible LaTeX only. $...$ inline and $$...$$ display on their own lines; for multi-line working use $$\\begin{aligned} ... \\end{aligned}$$. No \\( \\), no \\[ \\], no equation/align environments, no \\label or \\eqref, no custom macros.
- Markdown only: bold, italics, lists and pipe tables. No HTML, no headings inside blocks, no Mermaid or ASCII diagrams: draw with figure instead.
- Figures: give a block a figure when a picture teaches better than words: a plot of the response or relationship (substitute realistic numbers so it can be drawn), or a diagram of a process, classification or cause and effect. About 1-3 per lesson; never decorative.
- Use the brainmap: where_it_fits says what this builds on and leads to; connections explain the link to each neighbouring, sub- and cross-course topic named above, using their exact names.
- British spelling. Plain, direct sentences; avoid em dashes.`;

/** Where a topic sits in its course brainmap and how it links to other courses. */
export function lessonMap(topicId: string): LessonMap & { mastery: Mastery | null; weakBefore: string | null; summary: string; keywords: string[]; material_ids: string[] } {
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
    // The nearest earlier topic the student hasn't marked as known: worth a warm-up question.
    weakBefore: siblings.slice(Math.max(0, at - 3), Math.max(0, at)).reverse().find((n) => n.effective_mastery !== "know")?.title ?? null,
    summary: topic.summary,
    keywords: topic.keywords,
    material_ids: topic.material_ids,
  };
}

/** How the time left and the level the exam needs change what this lesson should spend its words on. */
function focus(d: number, r: StudentRecord): string {
  if (r.days !== null && r.days >= 0 && r.days <= 7)
    return `The exam is ${r.days === 0 ? "today" : `in ${r.days} day${r.days === 1 ? "" : "s"}`}: favour exam-style practice and the student's own slips over new breadth, and leave out material the exam won't ask for.`;
  if (d > r.target) return `The exam only needs level ${r.target}, so this pass is enrichment: keep it to the ideas that deepen understanding of what is examined, and say so in where_it_fits.`;
  return "";
}

/** Everything the AI is sent for a lesson: the sources (cached context) and the instructions. */
export function lessonRequest(topicId: string, depth: number) {
  const topic = getTopic(topicId)!;
  const d = Math.min(4, Math.max(1, depth));
  const level = DEPTH_LEVELS[d - 1];
  const map = lessonMap(topicId);
  const sources = sourcesFor(topic.course_id, `${topic.title} ${topic.keywords.join(" ")}`, 24000, topic.material_ids);
  const materials = listMaterials(topic.course_id).filter((m) => topic.material_ids.includes(m.id));
  const head = { title: topic.title, depth: d, level: level.name, goal: level.goal, map: stripMap(map) };
  // Everything the earlier levels already used, so this level adds new material instead of repeating it.
  const previous =
    [...Array(d - 1).keys()]
      .map((i) => {
        const l = getLesson(topic.id, i + 1);
        if (!l) return "";
        return `<level n="${i + 1}">\n${l.doc ? lessonOutline(normalizeDoc(l.doc)) : truncate(l.content, 3000)}\n</level>`;
      })
      .filter(Boolean)
      .join("\n") || null;
  const record = studentRecord(topicId);
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
  const context = sources.length
    ? sources.map((x) => `<source title="${x.title.replace(/"/g, "'")}" type="${MATERIAL_KIND_LABELS[x.kind as MaterialKind] ?? x.kind}">\n${x.text}\n</source>`).join("\n\n")
    : "<source>(no matching material found)</source>";
  const prompt = `Above are the student's own materials for this topic.

<brainmap>
${mapText}
Topic: ${topic.title}
Topic summary: ${topic.summary}
Key terms: ${topic.keywords.join(", ") || "(none listed)"}
Student's self-assessment: ${map.mastery ? MASTERY_LABELS[map.mastery] : "not marked"}${record.goal ? `\n${record.goal}` : ""}
</brainmap>
${record.text ? `\n<student_record>\n${record.text}\n</student_record>\nUse this record: put each mock exam slip and forgotten flashcard into common_mistakes (or a pitfall block) with the correction, and make at least one check_yourself question retest it in a new form. Don't name or shame; just fix the misunderstanding.\n` : ""}${previous ? `\nThe student has done the earlier levels. What they used:\n<earlier_levels>\n${previous}\n</earlier_levels>\nBuild on them and add new material: never reuse their examples, numbers, questions, figures, comparisons or pitfalls. Only recall may come back to their ideas, asking in a new form.\n` : ""}
Write the lesson on "${topic.title}" for pass ${d} of 4, the "${level.name}" level: ${level.goal}
Earlier passes covered shallower levels and later ones go deeper, so teach exactly this depth.

At this level: ${LEVEL_BLOCKS[d]}
${focus(d, record)}
${[d > 1 ? `2 quick questions on the level ${d - 1} ideas` : "", map.weakBefore ? `1 question checking "${map.weakBefore}", which this topic builds on and the student hasn't marked as known` : ""].filter(Boolean).join(", and ").replace(/^(.)/, "recall: $1") || "recall: empty"}.

${RULES}`;
  return { topic, head, map, sources, materials, context, prompt, record };
}

export async function generateLessonDoc(topicId: string, depth: number): Promise<LessonDoc> {
  const { head, map, sources, context, prompt, record } = lessonRequest(topicId, depth);
  if (!aiEnabled()) return offlineLesson(head, { summary: map.summary, keywords: map.keywords, mastery: map.mastery, slips: record.slips }, sources);
  const out = await generateStructured({ schema: LessonSchema, effort: "medium", maxTokens: 20000, context, prompt });
  const doc = fromAi(head, out);
  await refereeLesson(doc, context);
  return checkLesson(doc, sourceQuestions(sources));
}

/** The AI's answer, tidied, as a lesson document. */
export function fromAi(head: Pick<LessonDoc, "title" | "depth" | "level" | "goal" | "map">, out: z.infer<typeof LessonSchema>): LessonDoc {
  return {
    version: 2,
    ...head,
    by: "claude",
    ...out,
    recall: out.recall.slice(0, 4),
    sections: out.sections.filter((x) => x.blocks.length).map((x) => ({ ...x, blocks: x.blocks.map((b) => ({ ...b, solution: b.solution || null, source: b.source || null, figure: b.figure && !figureProblems(b.figure).length ? b.figure : null })) })),
  };
}

/** A short outline of a lesson, to tell the next level what was covered. */
export function lessonOutline(doc: LessonDoc): string {
  const clip = (s: string, n: number) => truncate(s.replace(/\s+/g, " ").trim(), n);
  return [
    ...doc.sections.map(
      (x) =>
        `${x.heading}: ${x.blocks
          .map((b) => {
            // Examples and figures by their content, since those are what tends to come back.
            const detail = b.kind === "example" ? `: ${clip(b.body, 160)}` : b.figure ? ` [figure: ${clip(b.figure.caption, 100)}]` : "";
            return `${b.kind} "${b.title}"${detail}`;
          })
          .join("; ")}`,
    ),
    doc.common_mistakes.length ? `Mistakes covered: ${doc.common_mistakes.map((m) => clip(m.mistake, 80)).join("; ")}` : "",
    doc.check_yourself.length ? `Questions asked: ${[...doc.recall, ...doc.check_yourself].map((q) => clip(q.question, 120)).join(" | ")}` : "",
    doc.takeaways.length ? `Takeaways: ${doc.takeaways.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function stripMap(m: ReturnType<typeof lessonMap>): LessonMap {
  return { course: m.course, path: m.path, children: m.children, before: m.before, after: m.after, related: m.related };
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
    // Explicit text colours so the light boxes stay readable when the app is in dark mode.
  lines.push(
    "  classDef default fill:#f8f9fa,stroke:#868e96,color:#1f2433",
    "  classDef me fill:#e8edff,stroke:#3b5bdb,stroke-width:2px,color:#1f2433",
    "  classDef side fill:#f5f5f5,stroke:#999,color:#1f2433",
    "  classDef other fill:#fff4e6,stroke:#e8590c,color:#1f2433",
  );
  return lines.filter(Boolean).join("\n");
}

const KIND_TAG: Record<string, string> = { recall: "Recall", explain: "Explain", apply: "Apply", transfer: "Transfer" };

function questions(qs: QA[], answerLabel: string): string {
  const list = qs.map((q, i) => `${i + 1}. ${q.kind ? `*${KIND_TAG[q.kind]}.* ` : ""}${q.question}${q.hint ? `\n\n${details("Hint", q.hint).replace(/^(?=.)/gm, "   ")}` : ""}`).join("\n\n");
  return `${list}\n\n${details(answerLabel, qs.map((q, i) => `**${i + 1}.** ${q.answer}`).join("\n\n"))}`;
}

export function lessonToMarkdown(raw: LessonDoc): string {
  const doc = markProvenance(normalizeDoc(raw));
  const out: string[] = [];
  if (doc.objectives.length) out.push(`<div class="lb lb-goal">\n\n**🎯 By the end of this pass you can**\n\n${doc.objectives.map((o) => `- ${o}`).join("\n")}\n\n</div>`);
  out.push(`### Where this fits\n\n${doc.where_it_fits}`);
  if (doc.map.path.length || doc.map.children.length || doc.map.before.length || doc.map.after.length || doc.map.related.length)
    out.push("```mermaid\n" + lessonMermaid(doc) + "\n```");
  if (doc.recall.length) out.push(`### Warm-up\n\n${questions(doc.recall, "Answers")}`);
  for (const sec of doc.sections) {
    out.push(`### ${sec.heading}`);
    for (const b of sec.blocks) {
      const sol = b.solution ? `\n\n${details("Worked solution", b.solution)}` : "";
      const src = b.source ? `\n\n<p class="lb-source">${b.source === BEYOND_NOTES ? "📚" : "📎"} ${b.source}</p>` : "";
      const fig = b.figure ? `\n\n${figureMarkdown(b.figure)}` : "";
      // A coloured box per kind (styled in globals.css), like the Z class's boxes in print.
      out.push(`<div class="lb lb-${b.kind}">\n\n**${BLOCK_ICON[b.kind]} ${BLOCK_LABEL[b.kind]}: ${b.title}**\n\n${b.body}${fig}${sol}${src}\n\n</div>`);
    }
  }
  if (doc.glossary.length) out.push(`### Key terms\n\n| Term | Meaning |\n|---|---|\n${doc.glossary.map((g) => `| **${cell(g.term)}** | ${cell(g.meaning)} |`).join("\n")}`);
  if (doc.key_points?.length) out.push(`### Key points\n\n${doc.key_points.map((k) => `- ${k}`).join("\n")}`);
  if (doc.common_mistakes.length)
    out.push(`### Common mistakes\n\n${doc.common_mistakes.map((m) => `- ❌ ${m.mistake}${m.correction ? `\n  ✅ ${m.correction}` : ""}`).join("\n")}`);
  if (doc.connections.length) out.push(`### Connections\n\n${doc.connections.map((c) => `- **${c.topic}**: ${c.relation}`).join("\n")}`);
  if (doc.check_yourself.length) out.push(`### Check yourself\n\n${questions(doc.check_yourself, "Answers")}`);
  if (doc.takeaways.length) out.push(`<div class="lb lb-takeaways">\n\n**📌 Critical takeaways**\n\n${doc.takeaways.map((k) => `- ${k}`).join("\n")}\n\n</div>`);
  if (doc.read.length) out.push(`### Go back to\n\n${doc.read.map((r) => `- **${r.title}**${r.focus ? `: ${r.focus}` : ""}`).join("\n")}`);
  return out.join("\n\n");
}

/** A figure as a fenced block: ```plot (drawn by the app as SVG) or ```mermaid, then its caption. */
export function figureMarkdown(f: Figure): string {
  const code = f.type === "plot" && f.plot ? "```plot\n" + JSON.stringify(f.plot) + "\n```" : f.diagram ? "```mermaid\n" + diagramMermaid(f.diagram) + "\n```" : "";
  return code ? `${code}\n\n*${f.caption}*` : "";
}

/** Text for a Markdown table cell: no pipes or line breaks. */
function cell(s: string) {
  return s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function details(summary: string, body: string) {
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;
}
