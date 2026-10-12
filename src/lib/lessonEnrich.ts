import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { normalizeMath } from "./lessonCheck";
import { framingProblems, mainTerms, teachingWords, type FramingOptions } from "./lessonTerms";
import type { BlockKind, LessonBlock, LessonDoc } from "./lesson";

/**
 * The last pass over a lesson: a senior tutor reads it whole and deepens the places that state
 * something without explaining it (the reason behind a result, what a parameter means physically,
 * a limiting case, a missing step, a link between two key terms), staying at the lesson's level.
 * Runs after the lesson is written and refereed, and again whenever the student asks for it.
 */

const KINDS = ["definition", "keypoint", "intuition", "example", "formula", "procedure", "pitfall", "comparison", "note"] as const satisfies readonly BlockKind[];

const EnrichSchema = z.object({
  edits: z
    .array(
      z.object({
        section: z.number().int().describe("1-based section number"),
        block: z.number().int().nullable().describe("1-based number of the block to rewrite, or null to add a new block at the end of the section"),
        kind: z.enum(KINDS),
        title: z.string().describe("Names the idea"),
        body: z.string().describe("The block's whole new text: Markdown with KaTeX maths"),
        source: z.string().nullable().describe("Where it comes from in the student's materials (title plus timestamp or section), or null if beyond them"),
        adds: z.string().describe("In one short sentence, the deeper understanding this edit adds"),
      }),
    )
    .describe("At most 4 edits; empty when the lesson already goes as deep as its level should"),
  new_terms: z
    .array(z.object({ term: z.string().describe("The key term, with its symbol if it has one"), meaning: z.string().describe("One line; units if it has them") }))
    .describe("Key terms an edit teaches that the glossary lacks (at most 2; a missing main key term first); may be empty"),
  concept_links: z
    .array(z.object({ from: z.string(), to: z.string(), label: z.string() }))
    .describe("New links between key terms that the edits explain (exact glossary spellings, or a new term's); short verb phrases saying how one acts on the other; may be empty"),
});

function blockText(b: LessonBlock): string {
  return [
    `kind: ${b.kind}`,
    `title: ${b.title}`,
    b.source ? `source: ${b.source}` : "",
    `body:\n${b.body}`,
    b.solution ? `solution:\n${b.solution}` : "",
    b.try_steps ? `student's turn:\n${b.try_steps}` : "",
    b.figure ? `figure: ${b.figure.caption}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The lesson as numbered sections and blocks, for the tutor to point at. */
function lessonText(doc: LessonDoc): string {
  return [
    `Objectives: ${doc.objectives.join(" | ")}`,
    doc.keywords?.length ? `The topic's main key terms: ${doc.keywords.join("; ")}${mainTerms(doc).length ? ` (spelt here: ${mainTerms(doc).join("; ")})` : ""}` : "",
    `Key terms: ${doc.glossary.map((g) => `${g.term} (${g.meaning})`).join("; ")}`,
    doc.concept_links?.length ? `Links already explained: ${doc.concept_links.map((l) => `${l.from} ${l.label} ${l.to}`).join("; ")}` : "",
    ...doc.sections.map(
      (s, i) => `<section n="${i + 1}" heading="${s.heading.replace(/"/g, "'")}" terms="${(s.terms ?? []).join(", ").replace(/"/g, "'")}">\n${s.blocks.map((b, j) => `<block n="${j + 1}">\n${blockText(b)}\n</block>`).join("\n")}\n</section>`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface EnrichOptions {
  /** What this level is for and how deep it goes. */
  brief: string;
  /** The level after this one, so the tutor doesn't jump ahead to it. */
  next?: string | null;
  /** What the student asked to have deepened, if they asked. */
  request?: string | null;
  /** The earlier levels and the word budget, for the framing checks. */
  framing?: FramingOptions;
}

/** The instructions for the enrichment pass (the student's materials go separately, as context). */
export function enrichPrompt(doc: LessonDoc, o: EnrichOptions): string {
  // Only what a block edit can fix: questions and the mistakes list are the referee's.
  const framing = framingProblems(doc, o.framing).filter((p) => !/^(check_yourself|common_mistakes)\./.test(p));
  return `You are a senior tutor giving this lesson a final enrichment before the student reads it. The student's materials are above.

This is the "${doc.level}" pass (level ${doc.depth} of 4): ${o.brief}${o.next ? `\nThe next pass will cover: ${o.next}. Leave that for it.` : ""}

Make it deeper, not longer. Find the places where the lesson states something without explaining it, and make up to 4 edits that add what a strong student would understand at this level:
- the mechanism or reason behind a stated result (why, not only what);
- the physical or practical meaning of a parameter or symbol;
- a limiting case, a sense of size or a sanity check that makes a result believable;
- a step missing from a derivation or worked solution;
- how two key terms connect, where the text treats them separately (above all when the concept map falls apart into unconnected groups);
- what this level adds to a main key term that the lesson leaves where an earlier level left it.
A rewritten block keeps its idea and its kind, keeps everything that was correct, and grows by at most a third${o.framing?.budget ? `; the lesson has ${teachingWords(doc)} words of teaching text and must end within ${o.framing.budget}, so ${teachingWords(doc) > o.framing.budget * 0.85 ? "pay for what you add by cutting restatement elsewhere in the same block" : "spend the room on depth, not length"}` : ""}. Add at most 2 new blocks. Keep the student's notation; bold a key term at its first use; maths in KaTeX-compatible LaTeX ($...$ inline, $$...$$ display); no HTML, no headings. Never solve the student's own tutorial or exam questions, or copy their wording or setup. Never mention levels, passes or how the lesson is built. British spelling; avoid em dashes.${framing.length ? `\nAlso fix these problems with how the lesson uses its key terms, where an edit can:\n- ${framing.slice(0, 7).join("\n- ")}` : ""}${o.request ? `\nThe student asked for this; do it first: "${o.request.slice(0, 500)}"` : ""}

<lesson title="${doc.title.replace(/"/g, "'")}">
${lessonText(doc)}
</lesson>`;
}

export type EnrichOutput = z.infer<typeof EnrichSchema>;
export { EnrichSchema };

/** Applies the tutor's edits in place; returns what each one added. */
export function applyEnrich(doc: LessonDoc, out: EnrichOutput): string[] {
  const added: string[] = [];
  const fresh = new Map<number, number>();
  for (const e of out.edits.slice(0, 4)) {
    const sec = doc.sections[e.section - 1];
    if (!sec || !e.body.trim()) continue;
    const patch = { kind: e.kind, title: e.title.trim(), body: normalizeMath(e.body.trim()), source: e.source?.trim() || null };
    if (e.block !== null && sec.blocks[e.block - 1]) {
      const b = sec.blocks[e.block - 1];
      // A worked example keeps its kind and the solution that goes with its numbers.
      Object.assign(b, { ...patch, kind: b.solution || b.try_steps ? b.kind : patch.kind });
    } else {
      if ((fresh.get(e.section) ?? 0) >= 2) continue;
      fresh.set(e.section, (fresh.get(e.section) ?? 0) + 1);
      sec.blocks.push({ ...patch, solution: null, try_steps: null, try_answer: null, figure: null });
    }
    added.push(e.adds.trim());
  }
  for (const t of (out.new_terms ?? []).slice(0, 2))
    if (t.term.trim() && !doc.glossary.some((g) => g.term.toLowerCase() === t.term.trim().toLowerCase())) doc.glossary.push({ term: t.term.trim(), meaning: t.meaning.trim() });
  if (out.concept_links.length) doc.concept_links = [...(doc.concept_links ?? []), ...out.concept_links];
  return added;
}

/** Deepens the lesson in place. Returns what each edit added (empty without an AI or when nothing was worth changing). */
export async function enrichLesson(doc: LessonDoc, context: string, o: EnrichOptions): Promise<string[]> {
  if (!aiEnabled() || !doc.sections.length) return [];
  try {
    const out = await generateStructured({ schema: EnrichSchema, effort: "medium", maxTokens: 8000, context, prompt: enrichPrompt(doc, o) });
    const added = applyEnrich(doc, out);
    if (added.length) console.info(`Lesson enriched: ${added.length} edit(s)\n${added.join("\n")}`);
    return added;
  } catch (e) {
    console.error("Couldn't enrich the lesson", e);
    return [];
  }
}
