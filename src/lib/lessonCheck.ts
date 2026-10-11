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
function* texts(doc: LessonDoc): Generator<[string, string]> {
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

function setPath(doc: LessonDoc, path: string, value: string) {
  const keys = path.split(".");
  let o = doc as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  const last = keys[keys.length - 1];
  if (typeof o?.[last] === "string") o[last] = value;
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

const FixSchema = z.object({ fixes: z.array(z.object({ path: z.string(), text: z.string().describe("The whole corrected text of that field") })) });

/** Checks the lesson, asks the AI once to fix what's broken, and defuses anything left. Mutates and returns doc. */
export async function checkLesson(doc: LessonDoc): Promise<LessonDoc> {
  let problems = lintLesson(doc);
  if (problems.length && aiEnabled()) {
    try {
      const { fixes } = await generateStructured({
        schema: FixSchema,
        effort: "low",
        maxTokens: 6000,
        prompt: `These fields of a lesson have LaTeX that KaTeX cannot render. Correct only the maths (KaTeX-compatible LaTeX, $...$ inline and $$...$$ display; for multi-line working use $$\\begin{aligned}...\\end{aligned}$$), keeping the wording and meaning. Return each field's whole corrected text with the same path.

${problems.map((p) => `<field path="${p.path}">\n<problems>${p.problems.join("; ")}</problems>\n<text>\n${p.text}\n</text>\n</field>`).join("\n\n")}`,
      });
      const allowed = new Set(problems.map((p) => p.path));
      for (const f of fixes) if (allowed.has(f.path)) setPath(doc, f.path, normalizeMath(f.text));
      problems = lintLesson(doc);
    } catch (e) {
      console.error("Couldn't fix the lesson's maths", e);
    }
  }
  for (const p of problems) setPath(doc, p.path, defuse(p.text));
  return doc;
}
