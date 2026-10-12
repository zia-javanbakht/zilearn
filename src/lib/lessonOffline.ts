import type { Source } from "./kb";
import type { LessonBlock, LessonDoc, LessonMap, QA } from "./lesson";
import { mentions, type ConceptLink } from "./lessonTerms";
import { topPhrases } from "./digest";
import { stem, tokenize } from "./text";

/**
 * A lesson built without an AI, by pulling the teaching moves out of the student's own materials:
 * definitions ("X is ..."), formulas with the sentence that introduces them, comparison lists and
 * tables, analogies ("think of ..."), the lecturer's warnings ("most of you will mix this up"), and
 * the tutorial and exam questions on the topic. Every block says where it came from, with timestamps
 * for recordings. More of it is used at each level, mirroring what the AI lessons cover.
 */

interface Sentence {
  text: string;
  source: string; // "Lecture 3 recording [05:05]" or "Lecture 3 notes, Logarithmic decrement"
  stamp: string | null;
  lead: boolean; // ends with ":" (introduces a formula or list), so not a statement on its own
}

interface Unit {
  title: string; // source title
  section: string | null; // nearest Markdown heading
  lines: string[];
}

const STAMP = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/;

/** Splits sources into sections by their Markdown headings. */
function units(sources: Source[]): Unit[] {
  const out: Unit[] = [];
  for (const s of sources) {
    let cur: Unit = { title: s.title, section: null, lines: [] };
    for (const line of s.text.split("\n")) {
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) {
        if (cur.lines.some((l) => l.trim())) out.push(cur);
        cur = { title: s.title, section: h[1].replace(/^(lecture|week|tutorial|chapter)\s*\d+\s*[:.-]\s*/i, "").trim(), lines: [] };
      } else cur.lines.push(line);
    }
    if (cur.lines.some((l) => l.trim())) out.push(cur);
  }
  return out;
}

/** Sentences of a unit's prose (not lists, tables or display maths), each with where it came from. */
function sentences(u: Unit): Sentence[] {
  const out: Sentence[] = [];
  let stamp: string | null = null;
  // Paragraphs end at blank lines and at anything that isn't prose, so lead-ins don't run into the next line.
  const paras: string[] = [];
  let cur: string[] = [];
  for (const l of u.lines) {
    if (!l.trim() || /^\s*([-*+]|\d+[.)]|\||\$\$)/.test(l)) {
      if (cur.length) paras.push(cur.join(" "));
      cur = [];
    } else cur.push(l.trim());
  }
  if (cur.length) paras.push(cur.join(" "));
  for (const para of paras)
    // Timestamps are kept as their own tokens so each sentence knows when it was said.
    for (const piece of para.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/)) {
      const st = piece.match(STAMP);
      if (st) {
        stamp = st[1];
        continue;
      }
      for (const raw of piece.split(/(?<=[.!?])\s+(?=[A-Z$(])/)) {
        // A clause continuing a display equation ("where ... is ...") reads as a sentence without its first word.
        let text = raw.replace(/\s+/g, " ").trim().replace(/^(where|and so|and|so|which)\s+(?=\$)/i, "");
        if (!text) continue;
        text = text[0].toUpperCase() + text.slice(1);
        if ((text.length < 18 && !text.endsWith("?")) || text.length > 400) continue;
        out.push({ text, source: stamp ? `${u.title} [${stamp}]` : u.section ? `${u.title}, ${u.section}` : u.title, stamp, lead: /[:,]$/.test(text) });
      }
    }
  return out;
}

const stems = (s: string) => new Set(tokenize(s).map(stem));

/** How strongly a text is about the topic: shared stems with the topic's terms. */
function relevance(text: string, terms: Set<string>): number {
  let n = 0;
  for (const w of stems(text)) if (terms.has(w)) n++;
  return n;
}

const DEFINES = /\b(is|are|means|refers to|is defined as|is called|we call|we define)\b/i;
const ANALOGY = /\b(think of|imagine|picture|like a|as if|analogy|for example, a)\b/i;
const LIMIT = /\b(assum\w*|only (valid|works|holds|applies)|breaks? down|limitations?|does not hold|doesn't hold|approximat\w*|neglect\w*|ignor\w*|valid (only|for|when)|in practice|real (structures|systems|buildings))\b/i;
const WARNING = /\b(mistakes?|mix(es|ed)? (this|it|them|these) up|confus\w*|be careful|common (error|slip)|watch out|wrong|trap|pitfall|don't (forget|waste|confuse|mix|use)|do not (forget|confuse|mix|use))\b/i;

/** A question or an instruction to the student ("Compare ...", "Explain ..."), not a statement to teach from. */
const PROMPT = /^(\(?[a-z]\)|q?\d+[.)]?\s+)?(compare|explain|derive|calculate|compute|show|find|describe|discuss|state|prove|sketch|estimate|determine|write|list|evaluate|give|plot|draw|outline|justify|use|consider|suppose|assume)\b/i;
export function isPrompt(text: string): boolean {
  return text.trim().endsWith("?") || PROMPT.test(text.trim());
}

/** A statement, as opposed to a heading or label that ended up on its own line ("Tutorial 3: Regularisation"). */
function isStatement(text: string): boolean {
  return text.split(/\s+/).length >= 6 && !isPrompt(text) && !/:$/.test(text);
}

function take<T>(xs: T[], n: number): T[] {
  return xs.slice(0, Math.max(0, n));
}

/** Formulas: each display equation with the sentence that introduces it. */
function formulas(u: Unit): { lead: string; math: string }[] {
  const out: { lead: string; math: string }[] = [];
  const lines = u.lines;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith("$$")) continue;
    let math = l;
    while (!(math.length > 2 && math.endsWith("$$")) && i + 1 < lines.length) math += "\n" + lines[++i];
    let k = i - math.split("\n").length;
    while (k >= 0 && !lines[k].trim()) k--;
    const lead = k >= 0 && !lines[k].trim().startsWith("$$") ? lines[k].trim() : "";
    out.push({ lead, math: math.trim() });
  }
  return out;
}

/** Results stated inline: a sentence with an equation in $...$ (e.g. "The damped frequency is $\\omega_D = \\omega_n\\sqrt{1-\\zeta^2}$."). */
function inlineFormulas(sentences: Sentence[]): Sentence[] {
  return sentences.filter((s) => /\$[^$]*=[^$]*\$/.test(s.text) && !isPrompt(s.text));
}

/** Bullet lists and tables in a unit, as Markdown. */
function listsAndTables(u: Unit): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length >= 2) out.push(cur.join("\n"));
    cur = [];
  };
  for (const l of u.lines) {
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*\|/.test(l)) cur.push(l.trimEnd());
    else if (l.trim()) flush();
  }
  flush();
  return out;
}

/** Practice questions: numbered questions (Q1., Question 2, 1.) in tutorials and exams. */
function questions(sources: Source[], terms: Set<string> | null): { text: string; source: string }[] {
  const out: { text: string; source: string; score: number }[] = [];
  for (const s of sources) {
    if (!/tutorial|exam|workshop/.test(s.kind) && !/tutorial|exam|problem|exercise|workshop/i.test(s.title)) continue;
    const parts = s.text.split(/\n(?=\s*(?:Q(?:uestion)?\s*\d+|\d+)[.):]\s)/i);
    for (const p of parts) {
      const m = p.trim().match(/^(?:Q(?:uestion)?\s*(\d+)|(\d+))[.):]\s*([\s\S]+)/i);
      if (!m) continue;
      const text = m[3].trim().replace(/\n+/g, " ");
      out.push({ text, source: `${s.title}, Q${m[1] ?? m[2]}`, score: terms ? relevance(text, terms) : 1 });
    }
  }
  // The sheets came in for this topic, so their other questions still belong, after the clearly relevant ones.
  return out.sort((a, b) => b.score - a.score);
}

/** Every numbered question in the student's tutorial, workshop and exam sheets: theirs to attempt, not for a lesson to solve. */
export function sourceQuestions(sources: Source[]): { text: string; source: string }[] {
  return questions(sources, null);
}

const dedupe = <T extends { text: string }>(xs: T[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    return seen.has(k) ? false : (seen.add(k), true);
  });
};

export function offlineLesson(
  head: Pick<LessonDoc, "title" | "depth" | "level" | "goal" | "map">,
  info: { summary: string; keywords: string[]; mastery: string | null; slips?: { question: string; feedback: string }[] },
  sources: Source[],
): LessonDoc {
  const t = head.title;
  const d = head.depth;
  const map: LessonMap = head.map;
  const terms = stems(`${t} ${info.keywords.join(" ")} ${map.children.map((c) => c.title).join(" ")}`);
  const us = units(sources);
  const all = dedupe(us.flatMap(sentences)).map((s) => ({ ...s, score: relevance(s.text, terms) }));
  const relevant = all.filter((s) => s.score > 0);
  const byScore = [...relevant].sort((a, b) => b.score - a.score);
  // A summary of a question sheet is its questions; that isn't something to teach from.
  const summary = info.summary.split(/(?<=[.!?])\s+/).filter((x) => x && !isPrompt(x)).join(" ");

  // Definitions: the best statement of each key term (and of the topic itself).
  const glossary: { term: string; meaning: string }[] = [];
  const defBlocks: LessonBlock[] = [];
  const used = new Set<string>();
  // Longer terms first, so "weight decay" claims its sentence before "decay" does.
  const titleOnly = (k: string) => k.toLowerCase() !== t.toLowerCase() && k.toLowerCase().split(/\W+/).every((w) => t.toLowerCase().split(/\W+/).includes(w));
  // The key terms the lesson is built around: the topic's keywords that the materials really use (a single
  // word must come up a few times), then the phrases the relevant material repeats most.
  const uses = (k: string) => relevant.filter((x) => mentions(x.text, k)).length;
  const fromKeywords = [...new Set(info.keywords)].filter((k) => !titleOnly(k) && uses(k) >= (k.includes(" ") ? 1 : 3));
  const fromText = topPhrases(relevant.map((x) => x.text.replace(/\$[^$]*\$/g, " ")).join(".\n"), 8)
    .filter((p) => p.count >= 2 && !titleOnly(p.phrase) && !fromKeywords.some((k) => mentions(k, p.phrase) || mentions(p.phrase, k)))
    .map((p) => p.phrase);
  const candidates = [...fromKeywords, ...fromText].slice(0, 6);
  for (const term of [t, ...[...candidates].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)]) {
    const def = definition(term, all);
    // A key term only gets a definition when the materials actually define it; a sentence that merely mentions it isn't one.
    // The same sentence defining two terms ("decay", "weight decay") is one definition.
    if (!def || (term !== t && def.score < 2) || used.has(def.text)) continue;
    for (const x of def.text.split(/(?<=[.!?])\s+/)) used.add(x);
    if (term !== t) glossary.push({ term, meaning: def.meaning });
    if (defBlocks.length < (d === 1 ? 2 : 3)) defBlocks.push({ kind: "definition", title: term[0].toUpperCase() + term.slice(1), body: def.body, source: def.source });
  }

  // An analogy, with the sentence after it when it is short ("Think of a door closer. A good one ...").
  const intuitions = all
    .map((s, i) => ({ ...s, i }))
    .filter((s) => ANALOGY.test(s.text) && !s.lead && !used.has(s.text))
    .slice(0, 2)
    .map((s) => (s.text.length < 80 && all[s.i + 1] && all[s.i + 1].source === s.source ? { ...s, text: `${s.text} ${all[s.i + 1].text}` } : s));
  const warnings = all.filter((s) => WARNING.test(s.text) && !s.lead);

  // Formulas from the units most about the topic.
  const rankedUnits = us.map((u) => ({ u, score: relevance(`${u.section ?? ""} ${u.lines.join(" ")}`, terms) })).filter((x) => x.score > 1).sort((a, b) => b.score - a.score);
  const eqs = rankedUnits.flatMap(({ u }) => formulas(u).map((f) => ({ ...f, source: u.section ? `${u.title}, ${u.section}` : u.title })));
  const lists = rankedUnits.flatMap(({ u }) => listsAndTables(u).map((md) => ({ md, source: u.section ? `${u.title}, ${u.section}` : u.title, section: u.section })));
  const practice = questions(sources, terms);
  const practiceTitles = new Set(sources.filter((x) => /tutorial|exam|workshop/.test(x.kind) || /tutorial|exam|problem|exercise|workshop/i.test(x.title)).map((x) => x.title));

  // Each level teaches its own material (as the AI lessons do), so passes add to each other instead of repeating.
  const extraFormulas = inlineFormulas(byScore).filter((x) => !used.has(x.text)).slice(0, 3);
  const formulaBody = [
    ...take(eqs, 4).map((e) => `${e.lead ? `${e.lead}\n\n` : ""}${e.math}`),
    ...extraFormulas.map((x) => x.text),
  ].join("\n\n");
  for (const x of extraFormulas) used.add(x.text);
  const formulaBlock: LessonBlock[] = formulaBody ? [{ kind: "formula", title: `Key results for ${t}`, body: formulaBody, source: eqs[0]?.source ?? extraFormulas[0]?.source }] : [];
  const idea: LessonBlock[] = [
    ...(summary ? [{ kind: "keypoint" as const, title: `What ${t} is about`, body: summary }] : []),
    ...defBlocks.slice(0, 2),
    ...intuitions.slice(0, 1).map((s) => ({ kind: "intuition" as const, title: "A way to picture it", body: s.text, source: s.source })),
  ];
  const comparisons: LessonBlock[] = lists.map((l) => ({ kind: "comparison" as const, title: l.section ?? "Side by side", body: l.md, source: l.source }));
  // The student's own mock exam slips come first: they are the mistakes this student actually makes.
  const slipBlocks: LessonBlock[] = (info.slips ?? []).slice(0, 2).map((x) => ({
    kind: "pitfall" as const,
    title: "From your mock exam",
    body: `You lost marks on: *${x.question.replace(/\s+/g, " ").trim()}*\n\n${x.feedback}`,
    source: "Your mock exam",
  }));
  // Assumptions and limits, for the mastery level: where the model stops describing reality.
  const limits: LessonBlock[] = all
    .filter((s) => LIMIT.test(s.text) && !s.lead && !WARNING.test(s.text) && isStatement(s.text))
    .slice(0, 3)
    .map((s) => ({ kind: "keypoint" as const, title: "An assumption to keep in mind", body: s.text, source: s.source }));
  for (const b of limits) used.add(b.body);
  const cautions: LessonBlock[] = warnings.map((s) => ({ kind: "pitfall" as const, title: s.stamp ? "Your lecturer's warning" : "Watch out", body: s.text, source: s.source }));
  for (const b of [...intuitions, ...warnings]) used.add(b.text);
  const worked: LessonBlock[] = practice.slice(0, 2).map((q) => ({ kind: "example" as const, title: q.source, body: `${q.text}\n\nTry it before looking at your solutions. Write down the formula you use and the units at each step.`, source: q.source }));
  const method: LessonBlock = {
    kind: "procedure",
    title: "A method for these questions",
    body: "1. List what is given and what is asked, with units; convert to SI.\n2. Pick the result from your formula sheet that links them, and say why it applies.\n3. Substitute, keeping units on every number.\n4. Check the answer: units, size, and a limiting case you know.",
  };
  const more: LessonBlock[] = byScore
    .filter((s) => !used.has(s.text) && !s.lead && isStatement(s.text))
    .slice(0, 3)
    .map((s) => ({ kind: "note" as const, title: "From your materials", body: s.text, source: s.source }));

  // Key-term sections: the lesson is organised around the topic's main key terms, each with what the
  // materials say about it and a sentence that links it to another key term.
  // A keyword that is only a word of the topic's own name ("descent" in Gradient descent) isn't a term to teach on its own.
  const keyTerms = candidates;
  const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
  const defOf = new Map(defBlocks.map((b) => [b.title.toLowerCase(), b]));
  // A term's symbol, from "$\zeta = c/c_{cr}$ (damping ratio)" or "critical damping $c_{cr} = ...$".
  const symbolOf = (term: string): string | null => {
    const g = glossary.find((x) => x.term === term)?.meaning.match(/^\$([^$=]+)=/)?.[1];
    if (g) return g.trim();
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const x of all) {
      const m = x.text.match(new RegExp(`${esc}\\s+\\$([^$=]+)=`, "i"));
      if (m) return m[1].trim();
    }
    return null;
  };
  const glossDef = (term: string): LessonBlock | null => {
    const g = glossary.find((x) => x.term === term);
    return g ? { kind: "definition", title: cap(term), body: /^\$/.test(g.meaning) ? `The **${term}** is ${g.meaning}.` : g.meaning, source: definition(term, all)?.source ?? null } : null;
  };
  const linked = new Set<string>();
  const linkFor = (term: string, withMaths: boolean): LessonBlock | null => {
    const x = all.find(
      (y) =>
        !used.has(y.text) &&
        !linked.has(y.text) &&
        !y.lead &&
        isStatement(y.text) &&
        /\$/.test(y.text) === withMaths &&
        mentions(y.text, term) &&
        keyTerms.some((o) => o !== term && mentions(y.text, o)),
    );
    if (!x) return null;
    linked.add(x.text);
    const other = keyTerms.find((o) => o !== term && mentions(x.text, o))!;
    return { kind: "keypoint", title: `How ${term} connects to ${other}`, body: x.text, source: x.source };
  };
  const eqTaken = new Set<number>();
  const formulasFor = (term: string): LessonBlock[] => {
    const sym = symbolOf(term);
    const mine = eqs.map((e, i) => ({ e, i })).filter(({ e, i }) => !eqTaken.has(i) && (mentions(e.lead, term) || (sym && e.math.includes(sym))));
    mine.slice(0, 2).forEach(({ i }) => eqTaken.add(i));
    const out: LessonBlock[] = mine.slice(0, 2).map(({ e }) => ({ kind: "formula", title: `${cap(term)} in symbols`, body: `${e.lead ? `${e.lead}\n\n` : ""}${e.math}`, source: e.source }));
    // Results stated inline in a sentence count too ("The logarithmic decrement $\delta = ...$").
    if (out.length < 2) {
      const line = inlineFormulas(byScore).find((x) => !inlineTaken.has(x.text) && (mentions(x.text, term) || (sym && x.text.includes(sym))));
      if (line) {
        inlineTaken.add(line.text);
        out.push({ kind: "formula", title: `${cap(term)} in symbols`, body: line.text, source: line.source });
      }
    }
    return out;
  };
  const termSections = (level: 1 | 2) =>
    keyTerms.slice(0, level === 1 ? 3 : 4).flatMap((term) => {
      const blocks: LessonBlock[] =
        level === 1
          ? [defOf.get(term.toLowerCase()) ?? glossDef(term), linkFor(term, false)].filter((b): b is LessonBlock => !!b)
          : [...formulasFor(term), ...comparisons.filter((c) => mentions(c.body, term) && !compTaken.has(c.body)).slice(0, 1), linkFor(term, true)].filter((b): b is LessonBlock => !!b);
      blocks.forEach((b) => b.kind === "comparison" && compTaken.add(b.body));
      return blocks.length ? [{ heading: level === 1 ? cap(term) : `How ${term} works`, terms: [label(term)], blocks }] : [];
    });
  const compTaken = new Set<string>();
  const inlineTaken = new Set<string>();
  // Glossary names carry the symbol, so the concept map and the text agree on what each term looks like.
  const label = (term: string) => {
    const sym = symbolOf(term);
    return sym && !term.includes("$") ? `${term} $${sym}$` : term;
  };

  const slipSection = slipBlocks.length ? [{ heading: "Where you slipped", blocks: slipBlocks }] : [];
  const l1Terms = d === 1 ? termSections(1) : [];
  const l1Defs = new Set(l1Terms.flatMap((x) => x.blocks));
  const l2Terms = d === 2 ? termSections(2) : [];
  const l2Rest = d === 2 ? eqs.filter((_, i) => !eqTaken.has(i)).slice(0, 2) : [];
  const byLevel: Record<number, { heading: string; blocks: LessonBlock[] }[]> = {
    1: [{ heading: "The big idea", blocks: idea.filter((b) => !l1Defs.has(b)) }, ...l1Terms, ...slipSection],
    2: l2Terms.length
      ? [
          ...l2Terms,
          ...(l2Rest.length ? [{ heading: "The other results", blocks: [{ kind: "formula" as const, title: `More results for ${t}`, body: l2Rest.map((e) => `${e.lead ? `${e.lead}\n\n` : ""}${e.math}`).join("\n\n"), source: l2Rest[0].source }] }] : []),
          { heading: "Where students slip", blocks: [...slipBlocks, ...cautions.slice(0, 2)] },
        ]
      : [
          { heading: "How it works", blocks: [...formulaBlock, ...comparisons.slice(0, 2), ...defBlocks.slice(2)] },
          { heading: "Where students slip", blocks: [...slipBlocks, ...cautions.slice(0, 2)] },
        ],
    3: [
      { heading: "The results you need", blocks: formulaBlock },
      { heading: "Practise with your tutorial questions", blocks: worked.length ? [method, ...worked] : [] },
      ...slipSection,
    ],
    4: [
      { heading: "Where it stops applying", blocks: [...slipBlocks, ...limits, ...cautions.slice(2, 5), ...comparisons.slice(2, 4)] },
      { heading: "More from your materials", blocks: more },
    ],
  };
  let sections: LessonDoc["sections"] = byLevel[d].filter((x) => x.blocks.length);
  // Thin materials: fall back to the big idea, then to anything at all, rather than an empty lesson.
  if (!sections.length) sections = [{ heading: "The idea", blocks: [...idea, ...more] }].filter((x) => x.blocks.length);
  if (!sections.length) sections.push({ heading: "From your materials", blocks: [{ kind: "definition", title: t, body: summary || `${t}, as covered in your materials.` }] });

  // Questions with real answers: terms from the glossary, formulas to complete, the lecturer's warnings.
  const blanks = eqs
    .map((e) => e.math.replace(/^\$\$|\$\$$/g, "").trim())
    .filter((m) => m.includes("=") && !m.includes("\n"))
    .map((m) => ({ lhs: m.slice(0, m.indexOf("=")).trim(), math: m }))
    .filter((x) => x.lhs && x.lhs.length < 40);
  const blankQ = (x: { lhs: string; math: string }) => qa(`Complete from memory: $${x.lhs} = \\;?$`, `$${x.math}$`, "recall");
  const meaningQ = (g: { term: string; meaning: string }) => qa(`What does "${g.term}" mean?`, g.meaning, "recall");

  const neighbours = [
    ...map.before.map((x) => ({ topic: x, relation: "comes before it; make sure you can explain it first" })),
    ...map.after.map((x) => ({ topic: x, relation: "comes next and builds on this topic" })),
    ...map.children.map((c) => ({ topic: c.title, relation: "a part of this topic, covered in its own lessons" })),
    ...map.related.map((r) => ({ topic: `${r.title} (${r.course})`, relation: r.relation ?? "a similar idea in another course" })),
  ];
  const terms3 = keyTerms.slice(0, 3);
  const qa = (question: string, answer: string, kind: QA["kind"], hint: string | null = null): QA => ({ question, answer, kind, hint });

  return {
    version: 2,
    ...head,
    by: "heuristic",
    objectives: [
      `Explain what ${t} is${terms3.length ? `, using the terms ${terms3.join(", ")}` : ""}.`,
      ...(d >= 2 ? [`Say how ${t} connects to ${[...map.before, ...map.after][0] ?? "the topics around it"}.`] : []),
      ...(d >= 3 ? ["Work through the tutorial questions on it without notes."] : []),
      ...(d >= 4 ? ["Spot where it stops applying and teach it back from memory."] : []),
    ],
    where_it_fits: `**${t}** is part of ${map.path.length ? `*${map.path.join(" › ")}*` : `*${map.course}*`}.${map.before.length ? ` It follows ${map.before.join(", ")}.` : ""}${map.after.length ? ` It leads to ${map.after.join(", ")}.` : ""}${map.related.length ? ` A similar idea appears in ${map.related.map((r) => `${r.title} (${r.course})`).join(", ")}.` : ""}`,
    recall: d === 1 ? [] : d === 2 ? glossary.slice(0, 1).map(meaningQ) : d === 3 ? (blanks[0] ? [blankQ(blanks[0])] : glossary.slice(0, 1).map(meaningQ)) : [qa(`In two sentences, what is ${t}?`, summary || "Compare with your notes.", "recall")],
    sections,
    // Only the terms the lesson actually teaches, so every glossary entry has a section to point to.
    glossary: glossary.map((g) => ({ ...g, term: label(g.term) })).filter((g) => sections.some((x) => x.blocks.some((b) => mentions(`${b.title}\n${b.body}`, g.term)))),
    concept_links: offlineLinks(sections, [...new Set([...glossary.map((g) => label(g.term)), ...keyTerms.map(label)])]),
    // The warnings are already pitfall blocks; without an AI there's no correction to add, so no separate list.
    common_mistakes: [],
    connections: neighbours,
    check_yourself: (
      {
        1: [qa(`Explain ${t} to a classmate in two sentences, without notes.`, summary || "Compare with your sources.", "explain"), ...glossary.slice(0, 3).map(meaningQ)],
        2: [...blanks.slice(0, 2).map(blankQ), ...glossary.slice(3, 5).map(meaningQ), ...cautions.slice(0, 1).map((c) => qa("Your materials warn about one slip here. What is it, and how do you avoid it?", c.body, "explain"))],
        3: practice.slice(2, 5).map((q) => qa(q.text, `Check against your worked solutions (${q.source}).`, "apply", "Use the method and the results above.")),
        4: [
          qa(`Teach ${t} back from memory in five sentences: what it is, why it matters, how it works, and when it stops applying.`, [summary, ...defBlocks.slice(0, 2).map((b) => b.body)].filter(Boolean).join(" ") || "Compare with your sources.", "explain"),
          ...[...limits, ...cautions.slice(2)].slice(0, 1).map((c) => qa("Where does this stop working, according to your materials?", c.body, "explain")),
          ...(map.related[0] ? [qa(`How is ${t} like ${map.related[0].title} in ${map.related[0].course}, and how is it different?`, map.related[0].relation ?? "Compare the equations and what each symbol means.", "transfer")] : []),
        ],
      } as Record<number, QA[]>
    )[d],
    // Statements from notes and readings (not questions, not the lecturer's spoken asides).
    takeaways: dedupe([...(summary && d > 1 ? [{ text: summary }] : []), ...byScore.filter((s) => !s.lead && !s.stamp && !used.has(s.text) && isStatement(s.text) && !practiceTitles.has(s.source.split(",")[0]))].slice(0, 3)).map((x) => x.text).slice(0, 4),
    read: sources.slice(0, 4).map((s) => ({ title: s.title, focus: focusIn(s.title, relevant, rankedUnits.map((x) => x.u)) })),
  };
}

/**
 * Links between key terms that the lesson's own blocks state: a formula that gives one term's symbol in
 * terms of another's ("depends on"), or a block written to connect two terms.
 */
function offlineLinks(sections: LessonDoc["sections"], terms: string[]): ConceptLink[] {
  const out: ConceptLink[] = [];
  const seen = new Set<string>();
  const sym = (t: string) => t.match(/\$([^$]+)\$/)?.[1]?.trim() ?? null;
  for (const b of sections.flatMap((x) => x.blocks)) {
    const text = `${b.title}\n${b.body}`;
    const here = terms.filter((t) => mentions(text, t));
    const maths = [...text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g)].map((m) => m[1] ?? m[2]).filter((m) => m.includes("="));
    for (const a of here)
      for (const c of here) {
        if (a === c || seen.has(`${a}|${c}`) || seen.has(`${c}|${a}`)) continue;
        const sa = sym(a);
        const sc = sym(c);
        const formula = sa && sc && maths.some((m) => m.split("=")[0].includes(sa) && m.split("=").slice(1).join("=").includes(sc));
        const written = b.title === `How ${a.replace(/\s*\$[^$]+\$/, "")} connects to ${c.replace(/\s*\$[^$]+\$/, "")}`;
        if (!formula && !written) continue;
        seen.add(`${a}|${c}`);
        out.push({ from: a, to: c, label: formula ? "depends on" : "connects to" });
      }
  }
  return out.slice(0, 10);
}

/** The best statement of what a term means, from the sentences of the sources. */
function definition(term: string, all: (Sentence & { score: number })[]): { text: string; body: string; meaning: string; source: string; score: number } | null {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/).join("\\s+");
  const named = new RegExp(`\\b${esc}`, "i");
  const verb = new RegExp(`\\b${esc}\\b[^.]{0,30}?\\b(is|are|means|refers to|is defined as|is called)\\b`, "i");
  const asked = new RegExp(`^what('s| is| are)\\s+(the\\s+)?${esc}\\b.*\\?$`, "i");
  const symbol = new RegExp(`(\\$[^$]+\\$)\\s*\\((the\\s+)?${esc}\\)`, "i");
  const after = new RegExp(`\\b${esc}\\s+(\\$[^$]+\\$)`, "i");
  const isThe = new RegExp(`(\\$[^$]+\\$)\\s+is\\s+the\\s+${esc}\\b`, "i");
  let best: { text: string; body: string; meaning: string; source: string; score: number } | null = null;
  const offer = (score: number, text: string, meaning: string, source: string, body = text) => {
    if (!best || score > best.score) best = { text, body, meaning, source, score };
  };
  for (const [i, s] of all.entries()) {
    if (!named.test(s.text)) continue;
    if (asked.test(s.text) && all[i + 1]) {
      const next = all[i + 1].text;
      const ans = next.replace(/^it'?s\s+|^it is\s+/i, "");
      // "What's critical damping? It's the smallest ..." reads better as "Critical damping is the smallest ...".
      const body = ans !== next ? `**${term[0].toUpperCase() + term.slice(1)}** is ${ans[0].toLowerCase() + ans.slice(1)}` : `${s.text} ${next}`;
      offer(4, `${s.text} ${next}`, ans[0].toUpperCase() + ans.slice(1), s.source, body);
    }
    if (verb.test(s.text) && !s.lead && !isPrompt(s.text)) offer(3 - s.text.length / 1000, s.text, s.text, s.source);
    const sym = s.text.match(symbol);
    if (sym) offer(2, s.text, sym[1], s.source, `The **${term}** is ${sym[1]}.`);
    // "The logarithmic decrement $\delta = \ln(u_i/u_{i+1})$ ..." names the term with its formula.
    const named2 = s.text.match(after);
    if (named2 && named2[1].includes("=")) offer(2, s.text, named2[1], s.source, s.text);
    const named3 = s.text.match(isThe);
    if (named3) offer(2, s.text, named3[1], s.source, `The **${term}** is ${named3[1]}.`);
    if (!s.lead && s.text.length < 220 && isStatement(s.text)) offer(1 - s.text.length / 1000, s.text, s.text, s.source);
  }
  return best;
}

/** What to look at in a source: its timestamps or sections that are about the topic. */
function focusIn(title: string, relevant: (Sentence & { score: number })[], us: Unit[]): string {
  // The moments most about the topic, then in the order they were said.
  const stamps = [...new Set([...relevant].filter((s) => s.source.startsWith(title) && s.stamp).sort((a, b) => b.score - a.score).map((s) => s.stamp!))]
    .slice(0, 4)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (stamps.length) return `around ${stamps.map((x) => `[${x}]`).join(", ")}`;
  const secs = [...new Set(us.filter((u) => u.title === title && u.section).map((u) => u.section!))];
  return secs.slice(0, 3).join("; ");
}
