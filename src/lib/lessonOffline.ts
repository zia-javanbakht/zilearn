import type { Source } from "./kb";
import type { LessonBlock, LessonDoc, LessonMap, QA } from "./lesson";
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
function questions(sources: Source[], terms: Set<string>): { text: string; source: string }[] {
  const out: { text: string; source: string; score: number }[] = [];
  for (const s of sources) {
    if (!/tutorial|exam|workshop/.test(s.kind) && !/tutorial|exam|problem|exercise|workshop/i.test(s.title)) continue;
    const parts = s.text.split(/\n(?=\s*(?:Q(?:uestion)?\s*\d+|\d+)[.):]\s)/i);
    for (const p of parts) {
      const m = p.trim().match(/^(?:Q(?:uestion)?\s*(\d+)|(\d+))[.):]\s*([\s\S]+)/i);
      if (!m) continue;
      const text = m[3].trim().replace(/\n+/g, " ");
      out.push({ text, source: `${s.title}, Q${m[1] ?? m[2]}`, score: relevance(text, terms) });
    }
  }
  return out.filter((q) => q.score > 0).sort((a, b) => b.score - a.score);
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
  for (const term of [t, ...[...info.keywords].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)]) {
    const def = definition(term, all);
    // A key term only gets a definition when the materials actually define it; a sentence that merely mentions it isn't one.
    // The same sentence defining two terms ("decay", "weight decay") is one definition.
    if (!def || (term !== t && def.score < 2) || used.has(def.text)) continue;
    used.add(def.text);
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

  const blocks = (n: number, xs: LessonBlock[]) => take(xs, n);
  const idea: LessonBlock[] = [
    ...(summary ? [{ kind: "keypoint" as const, title: `What ${t} is about`, body: summary }] : []),
    ...defBlocks,
    ...intuitions.map((s) => ({ kind: "intuition" as const, title: "A way to picture it", body: s.text, source: s.source })),
  ];
  const mechanism: LessonBlock[] = [
    ...(eqs.length ? [{ kind: "formula" as const, title: `Key results for ${t}`, body: take(eqs, d === 2 ? 4 : 6).map((e) => `${e.lead ? `${e.lead}\n\n` : ""}${e.math}`).join("\n\n"), source: eqs[0].source }] : []),
    ...lists.slice(0, d === 2 ? 2 : 3).map((l) => ({ kind: "comparison" as const, title: l.section ?? "Side by side", body: l.md, source: l.source })),
  ];
  // The student's own mock exam slips come first: they are the mistakes this student actually makes.
  const slipBlocks: LessonBlock[] = (info.slips ?? []).slice(0, 2).map((x) => ({
    kind: "pitfall" as const,
    title: "From your mock exam",
    body: `You lost marks on: *${x.question.replace(/\s+/g, " ").trim()}*\n\n${x.feedback}`,
    source: "Your mock exam",
  }));
  const cautions: LessonBlock[] = warnings.slice(0, 3).map((s) => ({ kind: "pitfall" as const, title: s.stamp ? "Your lecturer's warning" : "Watch out", body: s.text, source: s.source }));
  for (const b of [...intuitions, ...warnings.slice(0, 3)]) used.add(b.text);
  const worked: LessonBlock[] = practice.slice(0, 2).map((q) => ({ kind: "example" as const, title: q.source, body: `${q.text}\n\nTry it before looking at your solutions. Write down the formula you use and the units at each step.`, source: q.source }));
  const more: LessonBlock[] = byScore
    .filter((s) => !used.has(s.text) && !s.lead && isStatement(s.text))
    .slice(0, 3)
    .map((s) => ({ kind: "note" as const, title: "From your materials", body: s.text, source: s.source }));

  const sections = [
    { heading: d === 1 ? "The big idea" : "The idea", blocks: blocks(d === 1 ? 4 : 5, idea) },
    ...(d >= 2 ? [{ heading: "How it works", blocks: mechanism }] : []),
    ...(d >= 3 ? [{ heading: "Practise with your tutorial questions", blocks: worked }] : []),
    ...(d >= 2 || slipBlocks.length ? [{ heading: "Where students slip", blocks: [...slipBlocks, ...(d >= 2 ? cautions : [])] }] : []),
    ...(d >= 4 || !mechanism.length ? [{ heading: "More from your materials", blocks: more }] : []),
  ].filter((s) => s.blocks.length);
  if (!sections.length) sections.push({ heading: "From your materials", blocks: [{ kind: "definition", title: t, body: summary || `${t}, as covered in your materials.` }] });

  const neighbours = [
    ...map.before.map((x) => ({ topic: x, relation: "comes before it; make sure you can explain it first" })),
    ...map.after.map((x) => ({ topic: x, relation: "comes next and builds on this topic" })),
    ...map.children.map((c) => ({ topic: c.title, relation: "a part of this topic, covered in its own lessons" })),
    ...map.related.map((r) => ({ topic: `${r.title} (${r.course})`, relation: r.relation ?? "a similar idea in another course" })),
  ];
  const terms3 = info.keywords.slice(0, 3);
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
    recall: d > 1 ? [qa(`In two sentences, what is ${t}?`, summary || "Compare with your notes.", "recall")] : [],
    sections,
    glossary,
    // The warnings are already pitfall blocks; without an AI there's no correction to add, so no separate list.
    common_mistakes: [],
    connections: neighbours,
    check_yourself: [
      qa(`Explain ${t} to a classmate in two sentences, without notes.`, summary || "Compare with your sources.", "explain"),
      ...glossary.slice(0, d === 1 ? 2 : 3).map((g) => qa(`What does "${g.term}" mean?`, g.meaning, "recall")),
      ...(d >= 2 && map.after[0] ? [qa(`Why do you need ${t} before ${map.after[0]}?`, `Look at how ${map.after[0]} uses the results above.`, "explain")] : []),
      ...(d >= 3 ? practice.slice(2, 5).map((q) => qa(q.text, `Check against your worked solutions (${q.source}).`, "apply", "Start from the formula block above.")) : []),
      ...(d >= 4 && map.related[0] ? [qa(`How is ${t} like ${map.related[0].title} in ${map.related[0].course}, and how is it different?`, map.related[0].relation ?? "Compare the equations and what each symbol means.", "transfer")] : []),
    ],
    // Statements from notes and readings (not questions, not the lecturer's spoken asides).
    takeaways: dedupe([...(summary ? [{ text: summary }] : []), ...byScore.filter((s) => !s.lead && !s.stamp && !used.has(s.text) && isStatement(s.text) && !practiceTitles.has(s.source.split(",")[0]))].slice(0, 3)).map((x) => x.text).slice(0, 4),
    read: sources.slice(0, 4).map((s) => ({ title: s.title, focus: focusIn(s.title, relevant, rankedUnits.map((x) => x.u)) })),
  };
}

/** The best statement of what a term means, from the sentences of the sources. */
function definition(term: string, all: (Sentence & { score: number })[]): { text: string; body: string; meaning: string; source: string; score: number } | null {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/).join("\\s+");
  const named = new RegExp(`\\b${esc}`, "i");
  const verb = new RegExp(`\\b${esc}\\b[^.]{0,30}?\\b(is|are|means|refers to|is defined as|is called)\\b`, "i");
  const asked = new RegExp(`^what('s| is| are)\\s+(the\\s+)?${esc}\\b.*\\?$`, "i");
  const symbol = new RegExp(`(\\$[^$]+\\$)\\s*\\((the\\s+)?${esc}\\)`, "i");
  let best: { text: string; body: string; meaning: string; source: string; score: number } | null = null;
  const offer = (score: number, text: string, meaning: string, source: string, body = text) => {
    if (!best || score > best.score) best = { text, body, meaning, source, score };
  };
  for (const [i, s] of all.entries()) {
    if (!named.test(s.text)) continue;
    if (asked.test(s.text) && all[i + 1]) {
      const ans = all[i + 1].text.replace(/^it'?s\s+/i, "");
      offer(4, `${s.text} ${all[i + 1].text}`, ans[0].toUpperCase() + ans.slice(1), s.source);
    }
    if (verb.test(s.text) && !s.lead && !isPrompt(s.text)) offer(3 - s.text.length / 1000, s.text, s.text, s.source);
    const sym = s.text.match(symbol);
    if (sym) offer(2, s.text, sym[1], s.source, `The **${term}** is ${sym[1]}.`);
    if (!s.lead && s.text.length < 220 && isStatement(s.text)) offer(1 - s.text.length / 1000, s.text, s.text, s.source);
  }
  return best;
}

/** What to look at in a source: its timestamps or sections that are about the topic. */
function focusIn(title: string, relevant: Sentence[], us: Unit[]): string {
  const stamps = [...new Set(relevant.filter((s) => s.source.startsWith(title) && s.stamp).map((s) => s.stamp!))];
  if (stamps.length) return `around ${stamps.slice(0, 4).map((x) => `[${x}]`).join(", ")}`;
  const secs = [...new Set(us.filter((u) => u.title === title && u.section).map((u) => u.section!))];
  return secs.slice(0, 3).join("; ");
}
