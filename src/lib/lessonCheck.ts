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
  // Any $ left after the maths is matched would print as-is: unbalanced, or a space just inside a delimiter.
  const rest = s.replace(MATH, "").replace(/\\\$/g, "");
  if (rest.includes("$")) out.push("stray $ (unbalanced, or a space just inside the delimiters)");
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
      if (b.try_steps) yield [`sections.${i}.blocks.${j}.try_steps`, b.try_steps];
      if (b.try_answer) yield [`sections.${i}.blocks.${j}.try_answer`, b.try_answer];
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

/**
 * A model sometimes writes a line break as the two characters "\n" inside its JSON strings, which breaks
 * tables and numbered steps. A backslash-n followed by anything but a letter is such a break; \nabla,
 * \neq and \nu are left alone, and so is a LaTeX row break "\\" before an n.
 */
export function unescapeNewlines(s: string): string {
  return s.replace(/(?<!\\)\\n(?![A-Za-z])/g, "\n");
}

/** Normalises delimiters and strips HTML in place; returns the fields that still have problems. */
export function lintLesson(doc: LessonDoc): TextProblem[] {
  const out: TextProblem[] = [];
  for (const [path, raw] of texts(doc)) {
    // "Faded example" is the method's name, not the student's.
    const text = stripHtml(normalizeMath(unescapeNewlines(raw))).replace(/\bfaded (example|problem)(s?)\b/gi, (_, w: string, pl: string) => `partly worked ${w.toLowerCase()}${pl}`);
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
export function defuse(raw: string): string {
  // Spaces just inside inline delimiters ("$ x = 1 $") stop the $ pairing; trim them first.
  let text = raw.replace(/(?<![\\$])\$(?!\$)[ \t]*([^$\n]+?)[ \t]*\$(?!\$)/g, (_, m: string) => `$${m.trim()}$`);
  text = text.replace(MATH, (whole, display: string | undefined, inl: string | undefined) => {
    try {
      katex.renderToString(display ?? inl!, { throwOnError: true, displayMode: display !== undefined, strict: "ignore" });
      return whole;
    } catch {
      return "`" + (display ?? inl!).replace(/`/g, "'").replace(/\s+/g, " ").trim() + "`";
    }
  });
  // A $ still unpaired would show as-is or swallow the text after it: make it a literal dollar sign.
  let out = "";
  let last = 0;
  for (const m of text.matchAll(MATH)) {
    out += text.slice(last, m.index).replace(/(?<!\\)\$/g, "\\$") + m[0];
    last = m.index! + m[0].length;
  }
  return out + text.slice(last).replace(/(?<!\\)\$/g, "\\$");
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
  /** "data": the same numbers, which gives the answer away; "wording": the same setup and phrasing, which pre-solves it. */
  kind: "data" | "wording";
}

/** Runs of three words, with numbers and maths as #, to compare how two problems are set up and worded. */
function shingles(s: string): Set<string> {
  const w = s
    .toLowerCase()
    .replace(/\$[^$]*\$/g, " # ")
    .replace(/\d+(?:\.\d+)?/g, "#")
    .match(/[a-z#]+/g) ?? [];
  return new Set(w.slice(2).map((_, i) => w.slice(i, i + 3).join(" ")));
}

/**
 * Examples and questions that reuse one of the student's own tutorial or exam questions (the same data),
 * which would hand them the answer before they have tried it.
 */
export function spoilers(doc: LessonDoc, questions: { text: string; source: string }[]): Spoiler[] {
  const qs = questions.map((q) => ({ ...q, nums: numbersIn(q.text), sh: shingles(q.text) }));
  if (!qs.length) return [];
  const units: { paths: string[]; text: string }[] = [];
  for (const [i, x] of doc.sections.entries())
    for (const [j, b] of x.blocks.entries())
      if (b.kind === "example" || b.solution)
        units.push({ paths: [`sections.${i}.blocks.${j}.body`, ...(["solution", "try_steps", "try_answer"] as const).filter((k) => b[k]).map((k) => `sections.${i}.blocks.${j}.${k}`)], text: `${b.title}\n${b.body}` });
  for (const [k, list] of [["recall", doc.recall], ["check_yourself", doc.check_yourself]] as const)
    for (const [i, q] of list.entries()) units.push({ paths: [`${k}.${i}.question`, `${k}.${i}.answer`], text: q.question });
  const out: Spoiler[] = [];
  for (const u of units) {
    const nums = numbersIn(u.text);
    const sh = shingles(u.text);
    for (const q of qs) {
      const shared = [...q.nums].filter((n) => nums.has(n));
      if (q.nums.size >= 2 && shared.length >= 2 && shared.length >= 0.6 * q.nums.size) {
        out.push({ paths: u.paths, source: q.source, numbers: shared, kind: "data" });
        break;
      }
      // The same setup in the same words with new numbers still walks the student through their own question.
      if (q.sh.size >= 10 && [...q.sh].filter((x) => sh.has(x)).length >= 0.3 * q.sh.size) {
        out.push({ paths: u.paths, source: q.source, numbers: [], kind: "wording" });
        break;
      }
    }
  }
  return out;
}

/** Spoilers as messages for the referee, which sees the whole lesson and can rewrite them first. */
export function spoilerNotes(doc: LessonDoc, questions: { text: string; source: string }[]): string[] {
  return spoilers(doc, questions).map((sp) =>
    sp.kind === "data"
      ? `${sp.paths.join(" and ")} reuse the numbers of the student's own question (${sp.source}): make it a new problem with different numbers and setting, and recompute it.`
      : `${sp.paths.join(" and ")} follow the setup and wording of the student's own question (${sp.source}): change what is given and what is asked, the setting and the wording, and recompute it.`,
  );
}

/** Removes the blocks and questions behind spoilers that couldn't be rewritten. */
function dropSpoilers(doc: LessonDoc, sp: Spoiler[]) {
  const gone = new Set(sp.filter((x) => x.kind === "data").map((x) => x.paths[0].split(".").slice(0, -1).join(".")));
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
          sp.kind === "data"
            ? `Reuses the student's own question (${sp.source}, same numbers ${sp.numbers.join(", ")}), which would give its answer away. Rewrite it as a new problem of the same type with different numbers and a different setting, and recompute the working and answer so they stay correct and consistent across the fields listed together.`
            : `Copies the setup and wording of the student's own question (${sp.source}), which walks them through it before they try it. Rewrite it as a different problem on the same idea: a different physical setting, different given and asked quantities, your own wording; recompute the working and answer so they stay correct and consistent across the fields listed together.`,
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
      b.figure?.diagram?.nodes.forEach((n, k) => out.push([`sections.${i}.blocks.${j}.figure.diagram.nodes.${k}.label`, n.label]));
    }
  doc.concept_links?.forEach((l, i) => out.push([`concept_links.${i}.label`, l.label]));
  doc.check_yourself.forEach((q, i) => out.push([`check_yourself.${i}.objective`, q.objective ? String(q.objective) : ""]));
  return out;
}

/** A new check_yourself question or common mistake, at the next free number. */
const APPEND = /^(check_yourself|common_mistakes|glossary|concept_links)\.(\d+)\.(question|answer|hint|mistake|correction|term|meaning|from|to|label)$/;
const APPEND_FIELDS: Record<string, string[]> = {
  check_yourself: ["question", "answer", "hint", "objective"],
  common_mistakes: ["mistake", "correction"],
  glossary: ["term", "meaning"],
  concept_links: ["from", "to", "label"],
};
const APPEND_EMPTY: Record<string, () => object> = {
  check_yourself: () => ({ question: "", answer: "", kind: "apply", hint: null, objective: null }),
  common_mistakes: () => ({ mistake: "", correction: "" }),
  glossary: () => ({ term: "", meaning: "" }),
  concept_links: () => ({ from: "", to: "", label: "" }),
};

/** The referee's instructions and the fields it may correct. */
export function refereePrompt(doc: LessonDoc, framing: string[] = [], practice: { text: string; source: string }[] = []): string {
  const fields = refereeFields(doc);
  const tested = new Set([...doc.check_yourself].map((q) => q.objective).filter((n): n is number => typeof n === "number"));
  const untested = doc.objectives.map((_, i) => i + 1).filter((n) => !tested.has(n));
  return `You are refereeing a lesson written for a student from the materials above. Check it like a careful examiner and correct only real errors:
- Physics, maths and engineering mistakes, including approximations stated with the wrong accuracy.
- Statements that contradict another part of the lesson or the student's sources (including values quoted from them).
- Questions whose data don't agree with their answers or with each other; recompute every number you can.
- Sources that don't state the block's main claim: check it against the cited passage, then set the right title plus timestamp, section or question number, or an empty string if the claim (or most of the block) isn't in the sources.
- References to the sources by number anywhere in the lesson ("Section 4", "eq. (12)", "Table 2", "Figure 3", "Example 1.2"): check that the numbered item exists in the source named and says what the lesson claims it says; correct the number, or the claim.
- Equations quoted from the sources: each must match the source and be written as display maths with its number (\\tag{n}). Where the source text around it is garbled (extraction damage), the lesson must say the source's form can't be read there rather than present a reconstruction as the source's.
- Disagreements within the sources (a value, sign or definition that differs between two places) that the lesson passes over or settles silently: say so in the block, citing both.
- Examples and questions that simplify the sources' model without saying so: add a sentence saying what is left out.
- Blocks with an empty source whose formula or claim the sources do state (perhaps in another form, or as one step of a longer equation): set the source.
- Causal claims credited to the sources ("because", "explains why", "therefore", "leads to"): the cited passage must state the cause; otherwise state what the source does say, or present the explanation as the lesson's own reasoning with no source.
- Text about how the lesson or its sources were produced (extraction, PDF, OCR, text layers, transcription): rewrite it for the student, e.g. "the paper's form of this equation isn't reproduced here; see Section 2, eq. (1)".
- Section headings that promise something their section doesn't teach.${practice.length ? `\n- The student's own questions below must stay theirs to solve: if any block, answer or "read" focus lets one be answered in a single step (it states the rule or result that decides it, or names the method to use), rewrite that field so it teaches the idea without settling the question.\n  ${practice.slice(0, 8).map((q) => `${q.source}: ${q.text.replace(/\s+/g, " ").slice(0, 300)}`).join("\n  ")}` : ""}
- Figure captions that state a quantity an example or question asks the student to find.${doc.concept_links?.length ? `\n- Concept-map links that don't read as a true sentence "from label to" (backwards, wrong or clumsy); correct the label field:\n  ${doc.concept_links.map((l, i) => `concept_links.${i}: ${l.from} | ${l.label} | ${l.to}`).join("\n  ")}` : ""}${framing.length ? `\n- How the lesson uses its key terms, diagrams and words (fix by editing the fields named, e.g. a block body or a diagram box label):\n  - ${framing.slice(0, 12).join("\n  - ")}` : ""}${untested.length && doc.check_yourself.length ? `\n- Objectives ${untested.join(", ")} have no check_yourself question. Rewrite the least useful check_yourself questions (question and answer) so each of these objectives is tested.` : ""}
Leave style alone, keep the student's notation, and keep maths KaTeX-compatible ($...$ and $$...$$). Correct a field by its path below; to add a check_yourself question, a common mistake or a key term, use the next free number (e.g. check_yourself.${doc.check_yourself.length}.question and check_yourself.${doc.check_yourself.length}.answer, or glossary.${doc.glossary.length}.term and glossary.${doc.glossary.length}.meaning, or a concept-map link as concept_links.${doc.concept_links?.length ?? 0}.from, .to and .label, naming two key terms by their glossary names), and set a question's objective with its .objective path (the number as text). Return an empty list if nothing is wrong.

${fields.map(([path, text]) => `<field path="${path}">\n${text}\n</field>`).join("\n")}`;
}

/** Equation numbers a text refers to: "eq. (7)", "equations (5)-(6)", "Eqs. 2 and 3". */
export function equationRefs(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\b(?:eqs?\.|equations?)\s*\(?(\d{1,3})\)?(?:\s*(?:[-–]|to|and|,)\s*\(?(\d{1,3})\)?)?/gi)) {
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    for (let n = a; n <= Math.min(b, a + 6); n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * Source equations the lesson (or the topic's summary) refers to by number but never writes out: a
 * lesson about "the three Euler equations (5)" has to show them.
 */
export function equationGaps(doc: LessonDoc, summary = ""): string[] {
  const all = [...texts(doc)].map(([, t]) => t).join("\n");
  const shown = new Set([...all.matchAll(/\\tag\*?\{\s*(\d{1,3})\s*\}/g)].map((m) => +m[1]));
  const wanted = equationRefs(`${summary}\n${all}`).filter((n) => !shown.has(n));
  return wanted.length
    ? [`The lesson${equationRefs(summary).some((n) => wanted.includes(n)) ? " and the topic summary" : ""} refer${wanted.length === 1 ? "s" : ""} to eq. ${wanted.map((n) => `(${n})`).join(", ")} of the sources but never ${wanted.length === 1 ? "writes it" : "write them"} out: show each as display maths with \\tag{n} in the block that uses it, copied from the source (no derivation needed), and read its symbols in words.`]
    : [];
}

const META = /\b(extracted text|text extraction|extraction|PDF|OCR|text layer|transcription|transcribed)\b/i;

/** Sentences about how the sources were turned into text, which mean nothing to the student. */
export function metaProblems(doc: LessonDoc): string[] {
  return [...texts(doc)].flatMap(([path, t]) => {
    const m = META.exec(t);
    return m ? [`${path} talks about "${m[0]}", how the sources were processed: say it for the student instead (e.g. "the paper's form of this equation isn't reproduced here; see Section 2, eq. (1)").`] : [];
  });
}

/**
 * Applies the referee's corrections in place; returns what was fixed. A correction to a field that
 * doesn't exist is listed as not applied rather than lost without a word.
 */
export function applyReferee(doc: LessonDoc, corrections: z.infer<typeof RefereeSchema>["corrections"]): string[] {
  const paths = new Set(refereeFields(doc).map(([p]) => p));
  const done: string[] = [];
  const skipped: string[] = [];
  for (const c of corrections) {
    const add = c.path.match(APPEND);
    if (!paths.has(c.path) && add) {
      if (add[1] === "concept_links") doc.concept_links ??= [];
      const list = doc[add[1] as "check_yourself" | "common_mistakes" | "glossary" | "concept_links"] as unknown as Record<string, unknown>[];
      if (+add[2] === list.length && APPEND_FIELDS[add[1]].includes(add[3]) && c.text.trim()) {
        list.push(APPEND_EMPTY[add[1]]() as Record<string, unknown>);
        for (const f of APPEND_FIELDS[add[1]]) paths.add(`${add[1]}.${add[2]}.${f}`);
      }
    }
    if (!paths.has(c.path)) {
      skipped.push(`${c.path}: ${c.problem}`);
      continue;
    }
    if (c.path.endsWith(".objective")) {
      const n = parseInt(c.text, 10);
      const [, i] = c.path.split(".");
      doc.check_yourself[+i].objective = n >= 1 && n <= doc.objectives.length ? n : null;
    } else if (c.path.endsWith(".caption")) {
      const [, i, , j] = c.path.split(".");
      const f = doc.sections[+i]?.blocks[+j]?.figure;
      if (f) f.caption = c.text;
    } else if (/\.figure\.diagram\.nodes\.\d+\.label$/.test(c.path)) {
      const [, i, , j, , , , k] = c.path.split(".");
      const n = doc.sections[+i]?.blocks[+j]?.figure?.diagram?.nodes[+k];
      if (n) n.label = c.text;
    } else setPath(doc, c.path, c.path.endsWith(".source") ? c.text.trim() || null : normalizeMath(c.text));
    done.push(`${c.path}: ${c.problem}`);
  }
  // A question added with only one half is no question.
  doc.check_yourself = doc.check_yourself.filter((q) => q.question.trim() && q.answer.trim());
  doc.common_mistakes = doc.common_mistakes.filter((m) => m.mistake.trim());
  doc.glossary = doc.glossary.filter((g) => g.term.trim() && g.meaning.trim());
  if (doc.concept_links) doc.concept_links = doc.concept_links.filter((l) => l.from.trim() && l.to.trim() && l.label.trim());
  if (skipped.length) console.warn(`Referee corrections not applied (no such field):\n${skipped.join("\n")}`);
  return [...done, ...skipped.map((x) => `not applied, ${x}`)];
}

export { RefereeSchema };

/**
 * A second reader for the lesson, with the student's sources: physics and maths errors, statements that
 * contradict each other or the sources, numbers that don't agree between a question and its answer,
 * citations that don't support their block, and captions that give an answer away. Fixes what it finds
 * in place and returns the problems, for the log. Skipped without an AI.
 */
export async function refereeLesson(doc: LessonDoc, context: string, framing: string[] = [], practice: { text: string; source: string }[] = []): Promise<string[]> {
  if (!aiEnabled()) return [];
  try {
    const { corrections } = await generateStructured({ schema: RefereeSchema, effort: "medium", maxTokens: 10000, context, prompt: refereePrompt(doc, framing, practice) });
    const done = applyReferee(doc, corrections);
    if (done.length) console.info(`Lesson refereed: ${done.length} correction(s)\n${done.join("\n")}`);
    return done;
  } catch (e) {
    console.error("Couldn't referee the lesson", e);
    return [];
  }
}
