import katex from "katex";
import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { figureProblems } from "./figure";
import type { LessonDoc } from "./lesson";

/**
 * Checks a lesson before it is saved, so what the student sees (KaTeX in the app) and what prints (XeLaTeX
 * with the Z class) both work: maths that KaTeX can't render, stray HTML, and figures that can't be drawn.
 * Problems are sent back to the AI once to fix; whatever is still broken is made harmless.
 */

export interface TextProblem {
  path: string; // e.g. "sections.1.blocks.0.body"
  text: string;
  problems: string[];
}

// Display maths first, then inline (not $$, not an escaped \$).
const MATH = /\$\$([\s\S]+?)\$\$|(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g;

/** Turns \( \) and \[ \] into $ and $$, the delimiters the app and the export both read. */
export function normalizeMath(s: string): string {
  return s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);
}

/** Maths that KaTeX can't render, with KaTeX's reason. */
export function mathProblems(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(MATH)) {
    const src = m[1] ?? m[2];
    try {
      katex.renderToString(src, { throwOnError: true, displayMode: m[1] !== undefined, strict: "ignore" });
    } catch (e) {
      out.push(`${(e as Error).message.replace(/^KaTeX parse error: /, "")} in ${m[0].slice(0, 80)}`);
    }
  }
  const rest = s.replace(MATH, "").replace(/\\\$/g, "");
  if ((rest.match(/\$/g) ?? []).length % 2) out.push("unbalanced $ delimiters");
  return out;
}

const HTML = /<\/?(?:details|summary|div|span|p|b|i|em|strong|u|sup|sub|code|pre|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|font|center|a|img|br|hr)\b[^<>]*>/gi;

/** Removes HTML tags outside maths (lessons are Markdown; the app adds its own boxes). */
function stripHtml(s: string): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(MATH)) {
    out += s.slice(last, m.index).replace(HTML, "") + m[0];
    last = m.index! + m[0].length;
  }
  return out + s.slice(last).replace(HTML, "");
}

/** Every Markdown text field of a lesson, with its path. */
export function* texts(doc: LessonDoc): Generator<[string, string]> {
  yield ["where_it_fits", doc.where_it_fits];
  for (const [k, list] of [["objectives", doc.objectives], ["takeaways", doc.takeaways]] as const) for (const [i, t] of list.entries()) yield [`${k}.${i}`, t];
  for (const [k, list] of [["recall", doc.recall], ["check_yourself", doc.check_yourself]] as const)
    for (const [i, q] of list.entries()) {
      yield [`${k}.${i}.question`, q.question];
      yield [`${k}.${i}.answer`, q.answer];
      if (q.hint) yield [`${k}.${i}.hint`, q.hint];
    }
  for (const [i, s] of doc.sections.entries()) {
    yield [`sections.${i}.heading`, s.heading];
    for (const [j, b] of s.blocks.entries()) {
      yield [`sections.${i}.blocks.${j}.title`, b.title];
      yield [`sections.${i}.blocks.${j}.body`, b.body];
      if (b.solution) yield [`sections.${i}.blocks.${j}.solution`, b.solution];
    }
  }
  for (const [i, g] of doc.glossary.entries()) {
    yield [`glossary.${i}.term`, g.term];
    yield [`glossary.${i}.meaning`, g.meaning];
  }
  for (const [i, m] of doc.common_mistakes.entries()) {
    yield [`common_mistakes.${i}.mistake`, m.mistake];
    yield [`common_mistakes.${i}.correction`, m.correction];
  }
  for (const [i, c] of doc.connections.entries()) yield [`connections.${i}.relation`, c.relation];
}

function setPath(doc: LessonDoc, path: string, value: string | null) {
  const keys = path.split(".");
  let o = doc as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  const last = keys[keys.length - 1];
  if (o && (typeof o[last] === "string" || o[last] === null || (last === "source" && !(last in o)))) o[last] = value;
}

/** Normalises delimiters and strips HTML in place; returns the fields that still have problems. */
export function lintLesson(doc: LessonDoc): TextProblem[] {
  const out: TextProblem[] = [];
  for (const [path, raw] of texts(doc)) {
    const text = stripHtml(normalizeMath(raw));
    if (text !== raw) setPath(doc, path, text);
    const problems = mathProblems(text);
    if (problems.length) out.push({ path, text, problems });
  }
  for (const [i, s] of doc.sections.entries())
    for (const [j, b] of s.blocks.entries())
      if (b.figure && figureProblems(b.figure).length) {
        console.warn(`Lesson figure dropped (sections.${i}.blocks.${j}): ${figureProblems(b.figure).join("; ")}`);
        b.figure = null;
      }
  return out;
}

/** Shows maths that still won't render as code, so neither KaTeX nor XeLaTeX trips over it. */
export function defuse(text: string): string {
  return text.replace(MATH, (whole, display: string | undefined, inl: string | undefined) => {
    try {
      katex.renderToString(display ?? inl!, { throwOnError: true, displayMode: display !== undefined, strict: "ignore" });
      return whole;
    } catch {
      return "`" + (display ?? inl!).replace(/`/g, "'").replace(/\s+/g, " ").trim() + "`";
    }
  });
}

/** The numbers in a text that identify a problem (not small counts like 1, 2, 3). */
function numbersIn(s: string): Set<string> {
  return new Set((s.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))).filter((n) => Number(n) >= 10 || n.includes(".")));
}

export interface Spoiler {
  /** The fields to rewrite, e.g. ["sections.2.blocks.1.body", "sections.2.blocks.1.solution"]. */
  paths: string[];
  source: string;
  numbers: string[];
}

/**
 * Examples and questions that reuse one of the student's own tutorial or exam questions (the same data),
 * which would hand them the answer before they have tried it.
 */
export function spoilers(doc: LessonDoc, questions: { text: string; source: string }[]): Spoiler[] {
  const qs = questions.map((q) => ({ ...q, nums: numbersIn(q.text) })).filter((q) => q.nums.size >= 2);
  if (!qs.length) return [];
  const units: { paths: string[]; text: string }[] = [];
  for (const [i, x] of doc.sections.entries())
    for (const [j, b] of x.blocks.entries())
      if (b.kind === "example" || b.solution) units.push({ paths: [`sections.${i}.blocks.${j}.body`, ...(b.solution ? [`sections.${i}.blocks.${j}.solution`] : [])], text: b.body });
  for (const [k, list] of [["recall", doc.recall], ["check_yourself", doc.check_yourself]] as const)
    for (const [i, q] of list.entries()) units.push({ paths: [`${k}.${i}.question`, `${k}.${i}.answer`], text: q.question });
  const out: Spoiler[] = [];
  for (const u of units) {
    const nums = numbersIn(u.text);
    for (const q of qs) {
      const shared = [...q.nums].filter((n) => nums.has(n));
      if (shared.length >= 2 && shared.length >= 0.6 * q.nums.size) {
        out.push({ paths: u.paths, source: q.source, numbers: shared });
        break;
      }
    }
  }
  return out;
}

/** Removes the blocks and questions behind spoilers that couldn't be rewritten. */
function dropSpoilers(doc: LessonDoc, sp: Spoiler[]) {
  const gone = new Set(sp.map((x) => x.paths[0].split(".").slice(0, -1).join(".")));
  for (const x of doc.sections) x.blocks = x.blocks.filter((_, j) => !gone.has(`sections.${doc.sections.indexOf(x)}.blocks.${j}`));
  doc.recall = doc.recall.filter((_, i) => !gone.has(`recall.${i}`));
  doc.check_yourself = doc.check_yourself.filter((_, i) => !gone.has(`check_yourself.${i}`));
  doc.sections = doc.sections.filter((x) => x.blocks.length);
}

function read(doc: LessonDoc, path: string): string {
  let o: unknown = doc;
  for (const k of path.split(".")) o = (o as Record<string, unknown> | undefined)?.[k];
  return typeof o === "string" ? o : "";
}

const FixSchema = z.object({ fixes: z.array(z.object({ path: z.string(), text: z.string().describe("The whole corrected text of that field") })) });

/**
 * Checks the lesson, asks the AI once to fix what's broken (maths KaTeX can't render, and examples that
 * give away the student's own tutorial questions), then defuses or drops whatever is left. Mutates and returns doc.
 */
export async function checkLesson(doc: LessonDoc, practice: { text: string; source: string }[] = []): Promise<LessonDoc> {
  let problems = lintLesson(doc);
  let spoiled = spoilers(doc, practice);
  if ((problems.length || spoiled.length) && aiEnabled()) {
    const fields = new Map<string, string[]>();
    for (const p of problems) fields.set(p.path, p.problems.map((x) => `KaTeX: ${x}`));
    for (const sp of spoiled)
      for (const path of sp.paths)
        (fields.get(path) ?? fields.set(path, []).get(path)!).push(
          `Reuses the student's own question (${sp.source}, same numbers ${sp.numbers.join(", ")}), which would give its answer away. Rewrite it as a new problem of the same type with different numbers and a different setting, and recompute the working and answer so they stay correct and consistent across the fields listed together.`,
        );
    try {
      const { fixes } = await generateStructured({
        schema: FixSchema,
        effort: "low",
        maxTokens: 8000,
        prompt: `Fix the listed problems in these fields of a lesson, changing nothing else. Maths must be KaTeX-compatible LaTeX: $...$ inline and $$...$$ display; for multi-line working use $$\\begin{aligned}...\\end{aligned}$$. Return each field's whole corrected text with the same path.

${[...fields].map(([path, ps]) => `<field path="${path}">\n<problems>${ps.join("; ")}</problems>\n<text>\n${read(doc, path)}\n</text>\n</field>`).join("\n\n")}`,
      });
      for (const f of fixes) if (fields.has(f.path)) setPath(doc, f.path, normalizeMath(f.text));
      problems = lintLesson(doc);
      spoiled = spoilers(doc, practice);
    } catch (e) {
      console.error("Couldn't fix the lesson", e);
    }
  }
  for (const p of problems) setPath(doc, p.path, defuse(p.text));
  if (spoiled.length) dropSpoilers(doc, spoiled);
  return doc;
}

const RefereeSchema = z.object({
  corrections: z.array(
    z.object({
      path: z.string(),
      problem: z.string().describe("What is wrong, in one sentence"),
      text: z.string().describe("The whole corrected text of that field (empty string to clear a source)"),
    }),
  ),
});

/** Every field a referee may correct: the text fields plus each block's source and figure caption. */
function refereeFields(doc: LessonDoc): [string, string][] {
  const out = [...texts(doc)];
  for (const [i, x] of doc.sections.entries())
    for (const [j, b] of x.blocks.entries()) {
      out.push([`sections.${i}.blocks.${j}.source`, b.source ?? ""]);
      if (b.figure) out.push([`sections.${i}.blocks.${j}.figure.caption`, b.figure.caption]);
    }
  return out;
}

/**
 * A second reader for the lesson, with the student's sources: physics and maths errors, statements that
 * contradict each other or the sources, numbers that don't agree between a question and its answer,
 * citations that don't support their block, and captions that give an answer away. Fixes what it finds
 * in place and returns the problems, for the log. Skipped without an AI.
 */
export async function refereeLesson(doc: LessonDoc, context: string): Promise<string[]> {
  if (!aiEnabled()) return [];
  const fields = refereeFields(doc);
  const paths = new Set(fields.map(([p]) => p));
  try {
    const { corrections } = await generateStructured({
      schema: RefereeSchema,
      effort: "medium",
      maxTokens: 10000,
      context,
      prompt: `You are refereeing a lesson written for a student from the materials above. Check it like a careful examiner and correct only real errors:
- Physics, maths and engineering mistakes, including approximations stated with the wrong accuracy.
- Statements that contradict another part of the lesson or the student's sources.
- Questions whose data don't agree with their answers or with each other; recompute every number you can.
- Sources that don't state the block's claim: set the right title plus timestamp, section or question number, or an empty string if the claim isn't in the sources.
- Figure captions that state a quantity an example or question asks the student to find.
Leave style alone, keep the student's notation, and keep maths KaTeX-compatible ($...$ and $$...$$). Return an empty list if nothing is wrong.

${fields.map(([path, text]) => `<field path="${path}">\n${text}\n</field>`).join("\n")}`,
    });
    const done: string[] = [];
    for (const c of corrections) {
      if (!paths.has(c.path)) continue;
      if (c.path.endsWith(".caption")) {
        const [, i, , j] = c.path.split(".");
        const f = doc.sections[+i]?.blocks[+j]?.figure;
        if (f) f.caption = c.text;
      } else setPath(doc, c.path, c.path.endsWith(".source") ? c.text.trim() || null : normalizeMath(c.text));
      done.push(`${c.path}: ${c.problem}`);
    }
    if (done.length) console.info(`Lesson refereed: ${done.length} correction(s)\n${done.join("\n")}`);
    return done;
  } catch (e) {
    console.error("Couldn't referee the lesson", e);
    return [];
  }
}
