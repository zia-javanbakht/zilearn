import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { sourcesFor } from "./kb";
import { checkLesson, refereeLesson, spoilerNotes } from "./lessonCheck";
import { studentRecord, type StudentRecord } from "./lessonRecord";
import { offlineLesson, sourceQuestions } from "./lessonOffline";
import { diagramMermaid, figureProblems, FigureSchema, type Figure } from "./figure";
import { badge, conceptMermaid, echoesList, framingProblems, homes, mainTerms, mentions, tidyTerms, type ConceptLink } from "./lessonTerms";
import { enrichLesson } from "./lessonEnrich";
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
  try_steps?: string | null; // a faded example's last steps, left for the student (solution then holds the given steps)
  try_answer?: string | null; // the working and result for try_steps, shown on request
  source?: string | null; // where in the student's materials, e.g. "Lecture 3 recording [12:30]"
  figure?: Figure | null;
}

export interface LessonSection {
  heading: string;
  blocks: LessonBlock[];
  /** The key terms (glossary spellings) this section teaches. */
  terms?: string[];
  /** A short name for the section on the concept map. */
  map_title?: string | null;
}

export const QUESTION_KINDS = ["recall", "explain", "apply", "predict", "transfer"] as const;

export interface QA {
  question: string;
  answer: string;
  kind?: (typeof QUESTION_KINDS)[number];
  hint?: string | null;
  /** The objective it tests (1-based), so every objective gets tested. */
  objective?: number | null;
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
  /** How the key terms connect, as the text explains it: drawn as the lesson's concept map. */
  concept_links?: ConceptLink[];
  /** The topic's main key terms (from the brainmap), which every level takes one layer deeper. */
  keywords?: string[];
  /** What this level adds to each main key term, as planned before writing. */
  depth_plan?: { term: string; adds: string }[];
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
  kind: z.enum(QUESTION_KINDS).describe("recall a fact, explain why, apply to a problem, predict or sketch a behaviour before calculating, or transfer to a new situation"),
  hint: z.string().nullable().describe("A nudge that doesn't give the answer away, or null"),
  objective: z.number().int().nullable().describe("Which objective (1-based) this question tests; null for warm-up questions"),
});

const BlockSchema = z.object({
  kind: z.enum(BLOCK_KINDS),
  title: z.string().describe("Short title naming the idea (not the kind): e.g. 'Why the envelope is exponential'"),
  body: z.string().describe("Markdown; maths in KaTeX-compatible LaTeX ($...$ inline, $$...$$ display)"),
  solution: z.string().nullable().describe("For examples: the full worked solution as numbered steps, ending with the boxed or bold result and a sanity check. Otherwise null"),
  try_steps: z.string().nullable().describe("For a faded example only: the last 1-2 steps as numbered prompts for the student, continuing the numbering of solution (which then holds only the given first steps, shown openly). Otherwise null"),
  try_answer: z.string().nullable().describe("For a faded example only: the working and bold result for try_steps, hidden until the student checks. Otherwise null"),
  source: z.string().nullable().describe("Where this comes from in the sources: the source title plus a timestamp, section or question number, e.g. 'Lecture 3 recording [12:30]'. Null if it isn't from them"),
  figure: FigureSchema,
});

export const LessonSchema = z.object({
  depth_plan: z
    .array(z.object({ term: z.string().describe("One of the topic's main key terms"), adds: z.string().describe("What this level adds to it that the earlier levels didn't (a mechanism, derivation, case, limit, measurement or use), in one sentence") }))
    .describe("Plan this first: for each of the topic's main key terms, the new depth this level gives it"),
  objectives: z.array(z.string()).describe("2-4 things the student can do after this pass, each starting with a verb (Explain, Compute, Choose...)"),
  where_it_fits: z.string().describe("2-3 sentences placing the topic in the course map: what it builds on, what it leads to"),
  recall: z.array(QASchema).describe("Warm-up questions: on the previous level, and on a weak prerequisite when the prompt names one (otherwise empty at level 1)"),
  sections: z
    .array(
      z.object({
        heading: z.string().describe("A heading that says what the section teaches"),
        map_title: z.string().describe("The section's name on the concept map: 2-4 words, at most 28 characters, e.g. 'Measuring damping'"),
        terms: z.array(z.string()).describe("The 1-3 key terms this section develops, by their glossary names (the symbol may be left out); each key term belongs to one section"),
        blocks: z.array(BlockSchema),
      }),
    )
    .describe("The lesson itself in teaching order, in 2-5 sections"),
  glossary: z
    .array(z.object({ term: z.string().describe("The key term, with its symbol if it has one, e.g. 'damping ratio $\\zeta$'"), meaning: z.string().describe("One line; units if it has them") }))
    .describe("The lesson's key terms in the order the sections teach them (the topic's main key terms always among them): 3-4 at level 1, 4-6 at level 2, 5-7 at level 3, 5-8 at level 4"),
  concept_links: z
    .array(
      z.object({
        from: z.string().describe("A key term, by its glossary name (the symbol may be left out)"),
        to: z.string().describe("Another key term, by its glossary name"),
        label: z.string().describe("A short verb phrase read from 'from' to 'to', e.g. 'sets the decay rate of'; at most 6 words"),
      }),
    )
    .describe("How the key terms connect: 3-10 links, each one a relation that a block of the lesson states in words. Drawn as the lesson's concept map"),
  common_mistakes: z.array(z.object({ mistake: z.string(), correction: z.string().describe("What is right instead, and how to avoid the slip") })).describe("Typical misconceptions or errors (may be empty at level 1)"),
  connections: z.array(z.object({ topic: z.string().describe("Exact topic name from the brainmap"), relation: z.string() })).describe("How this topic relates to the named neighbouring, sub- and cross-course topics"),
  check_yourself: z.array(QASchema).describe("Questions at this level, with answers: 2-3 at level 1, 3-4 at level 2, 4-5 at level 3, 3-4 at level 4"),
  takeaways: z.array(z.string()).describe("3-5 critical takeaways: the ideas to keep if everything else is forgotten, not a repeat of the glossary"),
  read: z.array(z.object({ title: z.string().describe("Exact source title"), focus: z.string().describe("What to look at there and why: a section, timestamp or question") })).describe("The student's materials worth going back to"),
});

/** What each level teaches, in terms of the block kinds, and how much deeper it goes than the one before. */
const LEVEL_BLOCKS: Record<number, string> = {
  1: `Depth: what it is and why it matters. 3-4 key terms, the topic's main keywords a beginner needs first. Big picture only, about 500-800 words. Start from the phenomenon or problem the topic solves, then the idea in plain words (intuition blocks with an analogy or a picture in words), 1-2 definition blocks stating the key terms simply, and one short example with numbers that needs no derivation (2-3 steps). No derivations, no exam-style problems, no formula blocks; a glossary of 3-4 terms; at most one figure.`,
  2: `Depth: the mechanism. Take the level 1 key terms one layer deeper (how they act on each other, so the concept map gains cause-and-effect links) and add the 2-3 terms the mechanism needs. How and why it works, about 900-1300 words. Precise definitions; intuition for each step of the mechanism; a formula block for each key result, saying what every symbol means and when it applies; the reasoning or derivation in short steps; 1 fully worked example then 1 faded example; pitfall blocks for the misconceptions; and a comparison block with a neighbouring or related topic. Leave exact error analysis, full derivations from first principles and exam-style problems to level 3.`,
  3: `Depth: why it is true and how to use it. Derive what the earlier levels stated without proof (see their outlines: for example constants they quoted from the notes, cases they only named, exact forms of their approximations; never what they already derived), justifying every step and naming each assumption where it enters; quote what they already derived in one line, naming the concept ("from the roots of the characteristic equation, ..."), and never redo it; give a sense of size (orders of magnitude, and what happens to the result when a parameter doubles); add the terms for the quantities and conditions this needs. Problem solving, about 1200-1800 words. A procedure block with the solution method as numbered steps; the formula blocks needed (with units); exam-style examples of increasing difficulty at the standard of the tutorial and exam questions in the sources, but never their pattern: change what is given and what is asked (e.g. given the damping ratio, find the cycles to halve; given the damped period, find the stiffness), the setting and the wording: one fully worked, then one faded so the student finishes it; pitfall blocks for the errors students make in exams. check_yourself holds 3-4 practice problems (kind "apply") with worked answers, and one "predict" or "explain" question.`,
  4: `Depth: limits, generalisation and judgement. For each main key term (each in a block of its own): where it stops being valid and what replaces it, how it is measured or checked in practice, how the idea generalises (more degrees of freedom, non-linear behaviour, other courses), and how an expert chooses between methods and checks a result; add the terms for these. Mastery, about 1000-1600 words. Assumptions, limitations and edge cases (when the model breaks down), comparison blocks with related topics in this and other courses, one hard multi-step or 'explain why' exam question worked fully, and a teach-back note asking the student to explain this lesson's new ideas from memory (not the earlier levels'). check_yourself mixes "explain" and "transfer" questions.`,
};

const RULES = `How to write it:
- Deeper, not just longer: each level takes the same core key terms one layer further (level 1 what and why, level 2 how, level 3 why it is true and how to use it, level 4 where it stops and how it generalises). A paragraph that could sit in an earlier level doesn't belong in this one.
- Frame the lesson around its key terms (glossary). Start from the topic's key terms in the brainmap above, keep the ones this level needs, and add the terms it introduces. Each section develops 1-3 key terms (its terms, spelt as in glossary): bold each term at its first use, and say how it connects to a term taught before it.
- The topic's main key terms (listed above) are in every level's glossary, and each gains something new at every level (depth_plan): level 1 what it means, level 2 how it works, level 3 the derivation and every case a problem can need (for the student's own tutorial questions, the method, never their result), level 4 where it stops, how it generalises and how it is measured. An earlier result comes back as a one-line reference, never re-derived or restated.
- concept_links are the connections the text already explains (pick them after writing; never add a sentence just to support a link): each joins two key terms with a short verb phrase saying how one acts on the other ("sets the decay rate of"), never a negative ("does not change": a link shows an influence or dependence, and a non-influence belongs in the text, not on the map), and a section of the lesson explains that relation; a link between terms no section discusses together is dropped from the map. "from label to" must read as a true sentence in the right causal direction ("damping ratio | sets the decay rate of | decay envelope"); labels are plain words, no symbols or maths. No circular definitions (A defines B, which defines A); a loop of cause and measurement is fine. Together they join every key term into one connected map with the main key terms at its centre. The app draws them as the lesson's concept map, grouped by section and numbered, so the map is a summary of the text, not a separate picture.
- A diagram belongs to the block it sits in: label its boxes with the exact words that block uses (key terms where possible), and let the caption walk through it in the order the text explains it.
- Teach, don't summarise. Concrete before abstract: motivate with the situation or phenomenon, then give the idea, then the formal statement.
- Use the student's sources as the backbone: their notation, their symbols, their examples and their lecturer's advice. Where a block comes from a source, set source to its title plus a timestamp, section or question number. You may add standard textbook knowledge to fill gaps, but never contradict the sources.
- The numbered questions in the student's tutorial, workshop and exam sources are theirs to attempt: never solve them or give their answers anywhere (examples, solutions, check_yourself), and don't settle them by stating the general rule or result that answers them directly. Write your own at the same standard but change what is given and asked, the setting and the wording; the same combination of given and asked quantities as one of their questions appears at most once across all the levels (see the earlier levels' questions), though the skill behind it can be practised in other forms. Point to an original in read ("then try Q2") only once this lesson or an earlier one teaches everything it needs, and never name the method or rule it needs there.
- A source must point to text that states that block's claim. Material from beyond the sources (standard textbook knowledge) has source null; the app marks it "Beyond your notes" so the student knows what their course said.
- Figure captions say what the figure shows; they never state a quantity an example or question asks the student to find. A plot of an example's own numbers goes on a block after that example, never before it.
- Each block teaches one idea. Titles name the idea. Don't repeat the same point across blocks, glossary, common_mistakes and takeaways: common_mistakes adds slips no pitfall block covers, and no check_yourself question is answered by a common mistake or pitfall in the lesson.
- Worked solutions: numbered steps, each saying what is done and why; carry units; finish with the result in bold and a quick sanity check (order of magnitude, limiting case or units). In one step, ask "Why?" and answer it in a line, so the student explains the step to themselves.
- Faded examples: solution holds only the given first steps (one with a "Why?"), try_steps the remaining steps as numbered prompts continuing that numbering, and try_answer their working and result.
- Assessment matches the objectives: every part of every objective is tested by at least one check_yourself question (set objective to its number), and questions only test what the lesson teaches (not ideas that appear only in the glossary or connections). Use "predict" questions (sketch or predict the behaviour before any calculation) where the topic has a behaviour to picture.
- Stay within the level's word budget (the words of the sections' text, display maths not counted; keep the warm-up, glossary and questions short on top of it). Never mention levels, passes, faded examples or how the lesson is built: write for the student about the subject.
- In a plot, set a curve's style to dashed or dotted when the caption or text tells it apart that way. A figure must show something no table, list or text in the lesson already shows.
- Maths: KaTeX-compatible LaTeX only. $...$ inline and $$...$$ display on their own lines; for multi-line working use $$\\begin{aligned} ... \\end{aligned}$$. No \\( \\), no \\[ \\], no equation/align environments, no \\label or \\eqref, no custom macros.
- Markdown only: bold, italics, lists and pipe tables. No HTML, no headings inside blocks, no Mermaid or ASCII diagrams: draw with figure instead.
- Figures: never redraw a list or table the block already gives. Give a block a figure when a picture teaches better than words: a plot of the response or relationship (substitute realistic numbers so it can be drawn), or a diagram of a process, classification or cause and effect. About 1-3 per lesson; never decorative.
- Use the brainmap: where_it_fits says what this builds on and leads to; connections explain the link to each neighbouring, sub- and cross-course topic named above, using their exact names (in running text, write a topic's name as ordinary words: "the equation of motion", not "the Equation of motion").
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
  if (d > r.target) return `The exam only needs level ${r.target}, so this pass is enrichment: keep it to the ideas that deepen understanding of what is examined.`;
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
  const earlierLessons = [...Array(d - 1).keys()].map((i) => getLesson(topic.id, i + 1));
  const earlier = earlierLessons.flatMap((l) => (l?.doc ? [normalizeDoc(l.doc)] : []));
  const previous =
    earlierLessons
      .map((l, i) => (l ? `<level n="${i + 1}">\n${l.doc ? lessonOutline(normalizeDoc(l.doc)) : truncate(l.content, 3000)}\n</level>` : ""))
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
Main key terms: ${topic.keywords.join(", ") || "(none listed)"}
Student's self-assessment: ${map.mastery ? MASTERY_LABELS[map.mastery] : "not marked"}${record.goal ? `\n${record.goal}` : ""}
</brainmap>
${record.text ? `\n<student_record>\n${record.text}\n</student_record>\nUse this record: put each mock exam slip and forgotten flashcard into common_mistakes (or a pitfall block) with the correction, unless an earlier level already corrected it (see "Mistakes covered" below), and make at least one check_yourself question retest it in a new form: one that needs the corrected idea applied in a new situation, not the correction restated. Don't name or shame; just fix the misunderstanding. Where a correction would answer one of the student's own tutorial or exam questions, correct the idea without the numbers.\n` : ""}${previous ? `\nThe student has done the earlier levels. What they used:\n<earlier_levels>\n${previous}\n</earlier_levels>\nBuild on them and add new material: never reuse their examples, numbers, questions, figures, comparisons or pitfalls. Only recall may come back to their ideas, asking in a new form; a point they already taught (see their titles and takeaways) is used or extended here, never taught again. Their key terms come back here one layer deeper (see "Main key terms" above and each level's "Depth given"); don't define them again from scratch, and where you need an earlier result, quote it in one line, naming the concept it came from ("from the decay envelope, $\\delta \\approx 2\\pi\\zeta$"), instead of deriving it again.\n` : ""}
Write the lesson on "${topic.title}" for pass ${d} of 4, the "${level.name}" level: ${level.goal}
Earlier passes covered shallower levels and later ones go deeper, so teach exactly this depth.

At this level: ${LEVEL_BLOCKS[d]}
${focus(d, record)}
${[d > 1 ? `2 quick questions on the level ${d - 1} ideas` : "", map.weakBefore ? `1 question checking "${map.weakBefore}", which this topic builds on and the student hasn't marked as known` : ""].filter(Boolean).join(", and ").replace(/^(.)/, "recall: $1") || "recall: empty"}.

${RULES}`;
  return { topic, head, map, sources, materials, context, prompt, record, earlier, keywords: topic.keywords.slice(0, 5) };
}

/** What a level is for and how deep it goes, for passes that work on a finished lesson. */
export function levelBrief(depth: number): { brief: string; next: string | null } {
  const d = Math.min(4, Math.max(1, depth));
  const next = DEPTH_LEVELS[d];
  return { brief: `${DEPTH_LEVELS[d - 1].goal}. ${LEVEL_BLOCKS[d]}`, next: next ? `${next.name}: ${next.goal}` : null };
}

/** The most words of teaching text (the sections) each level should have. */
export const WORD_BUDGET = [0, 800, 1300, 1800, 1600];

export async function generateLessonDoc(topicId: string, depth: number): Promise<LessonDoc> {
  const { head, map, sources, context, prompt, record, earlier, keywords } = lessonRequest(topicId, depth);
  if (!aiEnabled()) return tidyTerms({ ...offlineLesson(head, { summary: map.summary, keywords: map.keywords, mastery: map.mastery, slips: record.slips }, sources), keywords });
  const out = await generateStructured({ schema: LessonSchema, effort: "medium", maxTokens: 20000, context, prompt });
  const doc = fromAi(head, out, keywords);
  const practice = sourceQuestions(sources);
  const framing = { earlier, budget: WORD_BUDGET[head.depth] };
  await refereeLesson(doc, context, [...spoilerNotes(doc, practice), ...framingProblems(doc, framing)], practice);
  // A final pass that deepens what the lesson states without explaining, at this level.
  await enrichLesson(doc, context, { ...levelBrief(head.depth), framing });
  tidyTerms(doc);
  return checkLesson(doc, practice);
}

/** The AI's answer, tidied, as a lesson document. */
export function fromAi(head: Pick<LessonDoc, "title" | "depth" | "level" | "goal" | "map">, out: z.infer<typeof LessonSchema>, keywords: string[] = []): LessonDoc {
  let figures = 0;
  const doc: LessonDoc = {
    version: 2,
    ...head,
    by: "claude",
    ...out,
    keywords,
    recall: out.recall.slice(0, 4),
    // Caps that keep the entry level light and every level within reach, whatever the model wrote.
    glossary: out.glossary.slice(0, head.depth === 1 ? 4 : 8),
    check_yourself: out.check_yourself.slice(0, [0, 3, 4, 5, 4][head.depth]),
    // The lesson's own key terms are taught here, not connections to elsewhere.
    connections: out.connections.filter((c) => !out.glossary.some((g) => mentions(g.term, c.topic) || mentions(c.topic, g.term))).slice(0, head.depth === 2 || head.depth === 3 ? 3 : 6),
    sections: out.sections
      .filter((x) => x.blocks.length)
      .map((x) => ({
        ...x,
        terms: x.terms ?? [],
        blocks: x.blocks.map((b) => {
          const figure = b.figure && !figureProblems(b.figure).length && !echoesList(b) && figures++ < (head.depth === 1 ? 1 : 3) ? b.figure : null;
          return { ...b, solution: b.solution || null, try_steps: b.try_steps || null, try_answer: b.try_steps ? b.try_answer || null : null, source: b.source || null, figure };
        }),
      })),
  };
  return tidyTerms(doc);
}

/** A short outline of a lesson, to tell the next level what was covered. */
export function lessonOutline(doc: LessonDoc): string {
  const clip = (s: string, n: number) => truncate(s.replace(/\s+/g, " ").trim(), n);
  return [
    doc.glossary.length ? `Key terms: ${doc.glossary.map((g) => g.term).join("; ")}` : "",
    doc.depth_plan?.length ? `Depth given: ${doc.depth_plan.map((p) => `${p.term}: ${p.adds}`).join(" | ")}` : "",
    doc.concept_links?.length ? `Links shown: ${doc.concept_links.map((l) => `${l.from} ${l.label} ${l.to}`).join("; ")}` : "",
    ...doc.sections.map(
      (x) =>
        `${x.heading}${x.terms?.length ? ` [${x.terms.join(", ")}]` : ""}: ${x.blocks
          .map((b) => {
            // Examples and figures by their content, since those are what tends to come back,
            // and formulas by the result, so the next level quotes it instead of deriving it again.
            const result = b.kind === "formula" ? [...b.body.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1].trim()).slice(0, 2).join("; ") : "";
            const detail = b.kind === "example" ? `: ${clip(b.body, 320)}` : result ? `: $$${clip(result, 200)}$$` : b.figure ? ` [figure: ${clip(b.figure.caption, 160)}]` : "";
            return `${b.kind} "${b.title}"${detail}`;
          })
          .join("; ")}`,
    ),
    // Pitfall blocks correct mistakes too, so the next level doesn't correct them again.
    doc.common_mistakes.length || doc.sections.some((x) => x.blocks.some((b) => b.kind === "pitfall"))
      ? `Mistakes covered: ${[...doc.common_mistakes.map((m) => clip(m.mistake, 80)), ...doc.sections.flatMap((x) => x.blocks.filter((b) => b.kind === "pitfall").map((b) => `${b.title} (pitfall)`))].join("; ")}`
      : "",
    doc.check_yourself.length ? `Questions asked: ${[...doc.recall, ...doc.check_yourself].map((q) => clip(q.question, 300)).join(" | ")}` : "",
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

const KIND_TAG: Record<string, string> = { recall: "Recall", explain: "Explain", apply: "Apply", predict: "Predict", transfer: "Transfer" };

function questions(qs: QA[], answerLabel: string): string {
  const list = qs.map((q, i) => `${i + 1}. ${q.kind ? `*${KIND_TAG[q.kind]}.* ` : ""}${q.question}${q.hint ? `\n\n${details("Hint", q.hint).replace(/^(?=.)/gm, "   ")}` : ""}`).join("\n\n");
  return `${list}\n\n${details(answerLabel, qs.map((q, i) => `**${i + 1}.** ${q.answer}`).join("\n\n"))}`;
}

export function lessonToMarkdown(raw: LessonDoc): string {
  const doc = markProvenance(normalizeDoc(raw));
  const out: string[] = [];
  if (doc.objectives.length) out.push(`<div class="lb lb-goal">\n\n**🎯 By the end of this lesson you can**\n\n${doc.objectives.map((o) => `- ${o}`).join("\n")}\n\n</div>`);
  const concept = conceptMermaid(doc);
  if (concept)
    out.push(
      `### Map of this lesson\n\n${"```mermaid\n" + concept + "\n```"}\n\n<p class="lb-hint">Each box is a key term, inside the numbered section that teaches it${mainTerms(doc).length ? " (the topic's main terms in bold)" : ""}; the arrows are the links the lesson explains. Tap a box to jump to its section.</p>`,
    );
  out.push(`### Where this fits\n\n${doc.where_it_fits}`);
  if (doc.recall.length) out.push(`### Warm-up\n\n${questions(doc.recall, "Answers")}`);
  const home = homes(doc);
  for (const [i, sec] of doc.sections.entries()) {
    const mine = [...home].filter(([, at]) => at === i).map(([t]) => t);
    out.push(`### ${concept ? `${badge(i + 1)} ` : ""}${sec.heading}`);
    // Markdown inside the box, so a term's symbol renders as maths.
    if (mine.length) out.push(`<div class="lb-terms">\n\n🔑 ${mine.map((t) => `**${t}**`).join(" · ")}\n\n</div>`);
    for (const b of sec.blocks) {
      // A faded example shows its first steps openly, then the student's turn, with the rest on request.
      const sol = b.try_steps
        ? `${b.solution ? `\n\n**Worked so far**\n\n${b.solution}` : ""}\n\n**✍️ Your turn**\n\n${b.try_steps}${b.try_answer ? `\n\n${details("Check your working", b.try_answer)}` : ""}`
        : b.solution
          ? `\n\n${details("Worked solution", b.solution)}`
          : "";
      const src = b.source ? `\n\n<p class="lb-source">${b.source === BEYOND_NOTES ? "📚" : "📎"} ${b.source}</p>` : "";
      const fig = b.figure ? `\n\n${figureMarkdown(b.figure)}` : "";
      // A coloured box per kind (styled in globals.css), like the Z class's boxes in print.
      out.push(`<div class="lb lb-${b.kind}">\n\n**${BLOCK_ICON[b.kind]} ${BLOCK_LABEL[b.kind]}: ${b.title}**\n\n${b.body}${fig}${sol}${src}\n\n</div>`);
    }
  }
  if (doc.glossary.length)
    out.push(
      `### Key terms\n\n| Term | Meaning |${concept ? " Taught in |" : ""}\n|---|---|${concept ? "---|" : ""}\n${doc.glossary
        .map((g) => `| **${cell(g.term)}** | ${cell(g.meaning)} |${concept ? ` ${home.has(g.term) ? badge(home.get(g.term)! + 1) : ""} |` : ""}`)
        .join("\n")}`,
    );
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
