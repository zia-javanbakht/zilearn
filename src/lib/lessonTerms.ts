import { mq, plainLabel } from "./figure";
import type { LessonDoc } from "./lesson";

/*
 * Key terms hold a lesson together: each section teaches some of them, the concept map shows how they
 * connect, and every link on the map is a relation the text states. These helpers keep the three in
 * step: they find where each term is taught, drop links the text never explains, find diagrams whose
 * boxes the text doesn't mention, and draw the map.
 */

export interface ConceptLink {
  from: string;
  to: string;
  label: string;
}

/** ①, ②, … for section numbers in headings and on the concept map. */
export function badge(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
}

const STOP = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "to", "for", "its", "with", "by", "as", "at"]);

/** The words of a term that must appear for a text to mention it, lower case and roughly stemmed. */
function words(term: string): string[] {
  // Symbols in a term ("damping ratio $\\zeta$") are matched separately, so the words are the name alone.
  return plainLabel(term.replace(/\$[^$]+\$/g, " "))
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w))
    .map(stemWord);
}

function stemWord(w: string): string {
  return w.length > 4 ? w.replace(/(ies|es|s|ing|ed|ly)$/, "") : w;
}

/** Whether a text uses a term (its words in order, near each other), ignoring case, plurals and maths markup. */
export function mentions(text: string, term: string): boolean {
  const need = words(term);
  const sym = term.match(/\$([^$]+)\$/)?.[1]?.trim();
  // A term's symbol in the text counts as the term ("$\\zeta$" for damping ratio $\\zeta$).
  if (sym && sym.length > 1 && text.includes(sym)) return true;
  if (!need.length) return false;
  const have = plainLabel(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stemWord);
  // Every word of the term within a short window, so "damping ... ratio" two sentences apart doesn't count.
  for (let i = 0; i < have.length; i++) {
    if (have[i] !== need[0]) continue;
    let k = 1;
    for (let j = i + 1; j < Math.min(have.length, i + need.length + 1) && k < need.length; j++) if (have[j] === need[k]) k++;
    if (k === need.length) return true;
  }
  return false;
}

/** All the teaching text of a section (block titles, bodies, solutions, captions). */
export function sectionText(doc: LessonDoc, i: number): string {
  const s = doc.sections[i];
  if (!s) return "";
  return [s.heading, ...s.blocks.flatMap((b) => [b.title, b.body, b.solution ?? "", b.try_steps ?? "", b.try_answer ?? "", b.figure?.caption ?? ""])].join("\n");
}

function blockTexts(doc: LessonDoc, i: number): string[] {
  return (doc.sections[i]?.blocks ?? []).map((b) => [b.title, b.body, b.solution ?? "", b.try_steps ?? "", b.try_answer ?? "", b.figure?.caption ?? ""].join("\n"));
}

const key = (s: string) => plainLabel(s).toLowerCase().replace(/\s+/g, " ").trim();

/** The glossary entry a name refers to, by exact name or failing that by the same words. */
function findTerm(doc: LessonDoc, name: string): string | null {
  const g = doc.glossary.find((x) => key(x.term) === key(name)) ?? doc.glossary.find((x) => words(x.term).join(" ") === words(name).join(" "));
  return g?.term ?? null;
}

/** The section (0-based) that teaches each key term: the one that claims it, else the first that uses it. */
export function homes(doc: LessonDoc): Map<string, number> {
  const out = new Map<string, number>();
  doc.sections.forEach((s, i) =>
    (s.terms ?? []).forEach((t) => {
      const term = findTerm(doc, t);
      if (term && !out.has(term) && mentions(sectionText(doc, i), term)) out.set(term, i);
    }),
  );
  for (const g of doc.glossary) {
    if (out.has(g.term)) continue;
    const i = doc.sections.findIndex((_, j) => mentions(sectionText(doc, j), g.term));
    if (i >= 0) out.set(g.term, i);
  }
  return out;
}

// Links tidyTerms took off the map, so a fix pass can be told why.
const DROPPED = new WeakMap<LessonDoc, (ConceptLink & { why: "negative" | "unstated" })[]>();

// "A does not change B" is not a link: the map shows what acts on what.
const NEGATIVE = /\b(not|no|never|cannot|without|doesn't|don't|isn't|aren't|can't|won't)\b/i;

/** A link label as a short phrase: raw subscripts (ω_n) as maths, no trailing article, at most 48 characters. */
export function cleanLabel(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[^$\\\w])([A-Za-z\u0370-\u03ff])_\{?([A-Za-z0-9]{1,3})\}?(?![\w$])/g, (_, pre: string, x: string, sub: string) => `${pre}$${x}_{${sub}}$`)
    .replace(/\s+(the|a|an)$/i, "")
    .slice(0, 48);
}

/** Whether a block's diagram only redraws the list its own text gives (most boxes are list items). */
export function echoesList(b: LessonDoc["sections"][number]["blocks"][number]): boolean {
  const d = b.figure?.diagram;
  if (!d || d.nodes.length < 3) return false;
  const items = b.body.split("\n").filter((l) => /^\s*([-*+]|\d+[.)])\s/.test(l));
  if (items.length < 2) return fanOfCases(b);
  const listed = d.nodes.filter((n) => items.some((l) => mentions(l, n.label))).length;
  return listed >= 0.7 * d.nodes.length || fanOfCases(b);
}

/** Whether a diagram is only a fan of cases (one box pointing at all the others) that the block already names. */
export function fanOfCases(b: LessonDoc["sections"][number]["blocks"][number]): boolean {
  const d = b.figure?.diagram;
  if (!d || d.nodes.length < 3 || !d.edges.length) return false;
  const root = d.edges[0].from;
  if (!d.edges.every((e) => e.from === root) || d.edges.length !== d.nodes.length - 1) return false;
  return d.nodes.filter((n) => n.id !== root).every((n) => mentions(b.body, n.label));
}

/** The topic's main key terms as the lesson spells them (glossary entries), in the topic's order. */
export function mainTerms(doc: LessonDoc): string[] {
  return (doc.keywords ?? []).map((k) => doc.glossary.find((g) => key(g.term) === key(k) || mentions(g.term, k))?.term).filter((t): t is string => !!t);
}

/** The concept map's separate groups: key terms joined by links, the largest first. */
export function mapGroups(doc: LessonDoc): string[][] {
  const terms = [...homes(doc).keys()];
  const up = new Map(terms.map((t) => [t, t]));
  const root = (t: string): string => (up.get(t) === t ? t : root(up.get(t)!));
  for (const l of doc.concept_links ?? []) if (up.has(l.from) && up.has(l.to)) up.set(root(l.from), root(l.to));
  const groups = new Map<string, string[]>();
  for (const t of terms) groups.set(root(t), [...(groups.get(root(t)) ?? []), t]);
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

/**
 * Brings a lesson's key terms in line with its text, in place: section terms use the glossary's
 * spelling and only name terms the section uses; every glossary term the lesson uses gets a home
 * section; and the concept map keeps only links between known terms that one section of the lesson
 * discusses together. A lesson without links gets them from sentences that join two key terms.
 */
export function tidyTerms(doc: LessonDoc): LessonDoc {
  const offered = doc.concept_links ?? [];
  const home = homes(doc);
  doc.sections.forEach((s, i) => {
    s.terms = [...home].filter(([, at]) => at === i).map(([t]) => t);
  });
  const seen = new Set<string>();
  // The text explains a link where one section discusses both terms (the map is its summary).
  const together = (a: string, b: string) => doc.sections.some((_, i) => mentions(sectionText(doc, i), a) && mentions(sectionText(doc, i), b));
  const lost: (ConceptLink & { why: "negative" | "unstated" })[] = [];
  const out: ConceptLink[] = [];
  for (const raw of offered) {
    const l = { from: findTerm(doc, raw.from), to: findTerm(doc, raw.to), label: cleanLabel(raw.label) };
    if (!l.from || !l.to || l.from === l.to || !l.label || !home.has(l.from) || !home.has(l.to)) continue;
    const link = l as ConceptLink;
    const k = [link.from, link.to].sort().join("|");
    if (seen.has(k)) continue;
    if (NEGATIVE.test(link.label)) lost.push({ ...link, why: "negative" });
    else if (!together(link.from, link.to)) lost.push({ ...link, why: "unstated" });
    else {
      seen.add(k);
      out.push(link);
    }
  }
  let links = out;
  if (lost.length) DROPPED.set(doc, [...(DROPPED.get(doc) ?? []), ...lost].slice(-6));
  if (!links.length) links = linksFromText(doc, [...home.keys()]);
  doc.concept_links = links.slice(0, 12);
  return doc;
}

/** Links read off the lesson's own sentences: "A <short verb phrase> B" where both are key terms. */
export function linksFromText(doc: LessonDoc, terms: string[]): ConceptLink[] {
  const out: ConceptLink[] = [];
  const seen = new Set<string>();
  const sentences = doc.sections.flatMap((s) => s.blocks.flatMap((b) => b.body.split(/(?<=[.!?])\s+/)));
  for (const s of sentences) {
    const plain = plainLabel(s).replace(/[*_`]/g, "");
    const lower = plain.toLowerCase();
    const at = terms
      .map((t) => ({ t, i: lower.indexOf(plainLabel(t).toLowerCase()) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i);
    for (let k = 0; k + 1 < at.length; k++) {
      const a = at[k];
      const b = at[k + 1];
      const between = plain.slice(a.i + plainLabel(a.t).length, b.i).replace(/^[\s,;:]+|[\s,;:]+$/g, "");
      const n = between.split(/\s+/).filter(Boolean).length;
      // A short phrase with a verb in it reads as a relation; anything longer is just two terms in one sentence.
      if (n < 1 || n > 5 || !/\b(is|are|sets?|gives?|controls?|depends?|determines?|causes?|reduces?|increases?|leads?|measures?|uses?|needs?|makes?|defines?|equals?|grows?|decays?|follows?|limits?|drives?|affects?|changes?|describes?|from|of)\b/i.test(between)) continue;
      const pair = [a.t, b.t].sort().join("|");
      if (seen.has(pair)) continue;
      seen.add(pair);
      out.push({ from: a.t, to: b.t, label: between.slice(0, 40) });
    }
  }
  return out.slice(0, 10);
}

export interface FramingOptions {
  /** The earlier levels of the same topic, to catch text this level repeats. */
  earlier?: LessonDoc[];
  /** The most words of teaching text this level should have. */
  budget?: number;
}

/** Problems with how the lesson uses its key terms, figures, map and words, as messages for a fix pass. */
export function framingProblems(doc: LessonDoc, o: FramingOptions = {}): string[] {
  const out: string[] = [];
  const home = homes(doc);
  const main = mainTerms(doc);
  for (const k of doc.keywords ?? [])
    if (!main.some((t) => mentions(t, k)) && !doc.glossary.some((g) => mentions(g.term, k)))
      out.push(`The topic's main key term "${k}" is missing from the key terms: every level takes each main key term one layer deeper, so teach what this level adds to it and add it to the key terms.`);
  for (const g of doc.glossary) if (!home.has(g.term)) out.push(`The key term "${g.term}" is in the glossary but no section uses it: teach it in the section where it belongs (bold at first use), or drop it from the glossary.`);
  const groups = mapGroups(doc);
  if (home.size >= 3 && groups.length > 1)
    out.push(
      `The concept map falls apart into ${groups.length} unconnected groups (${groups.map((g) => g.map((t) => plainLabel(t)).join(", ")).join(" | ")}): explain in a block how ${plainLabel(groups[1][0])} relates to ${plainLabel(groups[0][0])} and add that link, so the map reads as one idea.`,
    );
  for (const l of DROPPED.get(doc) ?? []) {
    const [a, b] = [findTerm(doc, l.from), findTerm(doc, l.to)];
    if (!a || !b || doc.concept_links?.some((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a))) continue;
    const said = `The link "${plainLabel(l.from)} ${l.label} ${plainLabel(l.to)}" is off the map because`;
    out.push(
      l.why === "negative"
        ? `${said} it states a negative: say how one acts on the other instead.`
        : `${said} no section discusses both terms: link terms the text already relates.`,
    );
  }
  for (const l of doc.concept_links ?? [])
    if (/^(above|below|if|when|while|in|at|by|through|for|with|from|into|on)\b/i.test(l.label))
      out.push(`The link label "${plainLabel(l.from)} | ${l.label} | ${plainLabel(l.to)}" starts with "${l.label.split(" ")[0]}", so it doesn't read as a sentence: start it with a verb.`);
  doc.sections.forEach((s, i) => {
    if (doc.glossary.length && !(s.terms ?? []).length && s.blocks.length)
      out.push(`Section ${i + 1} ("${s.heading}") teaches none of the key terms: say which key term it develops and use it.`);
    s.blocks.forEach((b, j) => {
      const where = `section ${i + 1}, block ${j + 1} ("${b.title}")`;
      const text = `${b.title}\n${b.body}\n${b.solution ?? ""}\n${b.try_steps ?? ""}`;
      const jargon = text.match(JARGON);
      if (jargon) out.push(`In ${where}, "${jargon[0]}" is the app's own word, not the student's: say it in plain words (e.g. "partly worked example", "a deeper treatment").`);
      const d = b.figure?.diagram;
      if (d) {
        const missing = d.nodes.filter((n) => !mentions(`${text}\n${b.figure!.caption}`, n.label)).map((n) => n.label);
        if (missing.length > d.nodes.length / 3)
          out.push(`The diagram in ${where} has boxes the block's text never mentions (${missing.slice(0, 4).join(", ")}): label the boxes with the words the text uses, and walk through the diagram in the caption.`);
      }
      const p = b.figure?.plot;
      const styled = /\b(dashed|dotted)\b/i.exec(b.figure?.caption ?? "");
      if (p && styled && !p.curves.some((c) => c.style === styled[1].toLowerCase()))
        out.push(`The caption of the plot in ${where} mentions a ${styled[1]} curve, but every curve is drawn solid: tell the curves apart by their legend labels instead.`);
    });
  });
  // A question the lesson's own list of mistakes answers just above it tests reading, not understanding.
  const mistakes = doc.common_mistakes.map((m) => content(`${m.mistake} ${m.correction}`));
  doc.check_yourself.forEach((q, i) => {
    const k = mistakes.findIndex((m) => overlap(content(`${q.question} ${q.answer}`), m) >= 0.6);
    if (k >= 0) out.push(`check_yourself.${i} is answered by common_mistakes.${k}, printed just above it: test the idea in a new situation instead.`);
  });
  const pitfalls = doc.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "pitfall").map((b) => ({ title: b.title, words: content(b.body) })));
  // Nor should a question be answered by a pitfall, or its answer be a sentence copied from a block.
  const runs = new Set(doc.sections.flatMap((s) => s.blocks.flatMap((b) => [...ngrams(`${b.body} ${b.solution ?? ""}`, 8)])));
  doc.check_yourself.forEach((q, i) => {
    const p = pitfalls.find((x) => overlap(content(`${q.question} ${q.answer}`), x.words) >= 0.6);
    if (p) out.push(`check_yourself.${i} is answered by the pitfall "${p.title}": test the idea in a new situation instead.`);
    else if ([...ngrams(q.answer, 8)].some((g) => runs.has(g))) out.push(`check_yourself.${i}'s answer copies a sentence of the lesson: ask it so the student has to apply the idea (a changed quantity or setting), not find the sentence.`);
  });
  mistakes.forEach((m, k) => {
    const p = pitfalls.find((x) => overlap(m, x.words) >= 0.6);
    if (p) out.push(`common_mistakes.${k} repeats the pitfall "${p.title}": replace it with a different slip, or merge the two.`);
  });
  if (o.budget) {
    const words = teachingWords(doc);
    if (words > o.budget * 1.05) out.push(`The lesson's teaching text is about ${words} words, over this level's ${o.budget}: cut repetition and restatement rather than ideas.`);
  }
  if (o.earlier?.length) out.push(...repeats(doc, o.earlier));
  return out;
}

// Words that belong to the app's design, not to the student's subject.
const JARGON = /\bfaded (?:example|problem)s?\b|\b(?:level|pass) [1-4]\b|\b(?:this|next|earlier|previous) pass\b/i;

/** The words of the lesson's sections: what the level's word budget counts. */
export function teachingWords(doc: LessonDoc): number {
  return doc.sections
    .map((_, i) => sectionText(doc, i))
    .join(" ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w)).length;
}

const content = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, " ")
      .split(/[^\p{L}\p{N}%.]+/u)
      .map((w) => w.replace(/\.$/, ""))
      .filter((w) => w.length > 2 && !STOP.has(w) && !COMMON.has(w)),
  );
const COMMON = new Set(["this", "that", "which", "when", "then", "than", "from", "into", "each", "every", "here", "there", "they", "them", "their", "these", "those", "have", "has", "was", "were", "will", "would", "can", "not", "but", "you", "your", "are", "also", "only", "just", "more", "less", "about"]);
/** Runs of n words (maths dropped), to spot copied sentences. */
const ngrams = (s: string, n: number) => {
  const w = s.toLowerCase().replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, " ").match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(w.slice(n - 1).map((_, i) => w.slice(i, i + n).join(" ")));
};

/** How much of the smaller word set the other shares (0 when either is too short to judge). */
const overlap = (a: Set<string>, b: Set<string>) => (Math.min(a.size, b.size) < 5 ? 0 : [...a].filter((w) => b.has(w)).length / Math.min(a.size, b.size));
const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const displays = (s: string) => new Set([...s.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1].replace(/\s+/g, "")));

/**
 * Text this level repeats from an earlier one: sentences that say the same thing in nearly the same
 * words, and derivations that redo the same display equations.
 */
export function repeats(doc: LessonDoc, earlier: LessonDoc[]): string[] {
  const old = earlier.flatMap((e) =>
    e.sections.flatMap((s) => s.blocks.flatMap((b) => [b.body, b.solution ?? ""].flatMap(sentences).map((x) => ({ level: e.depth, text: x, words: content(x) })))),
  );
  const oldMaths = new Map<string, number>();
  for (const e of earlier) for (const s of e.sections) for (const b of s.blocks) for (const m of displays(`${b.body}\n${b.solution ?? ""}`)) oldMaths.set(m, e.depth);
  const out: string[] = [];
  doc.sections.forEach((s, i) =>
    s.blocks.forEach((b, j) => {
      // A teach-back note recaps on purpose.
      if (out.length >= 5 || b.kind === "note") return;
      const where = `Section ${i + 1}, block ${j + 1} ("${b.title}")`;
      for (const x of [b.body, b.solution ?? ""].flatMap(sentences)) {
        const w = content(x);
        if (w.size < 7) continue;
        // Most of the same words in both: the same statement, not just the same topic.
        const hit = old.find((o) => {
          const both = [...w].filter((t) => o.words.has(t)).length;
          return o.words.size >= 5 && both >= 0.6 * (w.size + o.words.size - both);
        });
        if (hit) {
          out.push(`${where} repeats what level ${hit.level} already said ("${hit.text.slice(0, 120)}"): refer back to it in a clause and spend the words on what this level adds.`);
          return;
        }
      }
      const same = [...displays(`${b.body}\n${b.solution ?? ""}`)].filter((m) => oldMaths.has(m));
      if (same.length >= 2) out.push(`${where} redoes ${same.length} equations from level ${oldMaths.get(same[0])}: quote the result from there in one line and go further with it.`);
    }),
  );
  return out;
}

/** A section heading short enough for a map's group title: whole words, then an ellipsis. */
export function shortHeading(h: string, max = 34): string {
  const t = plainLabel(h).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * The lesson's concept map for the app: one box per key term, grouped by the section that teaches it
 * (titled with the section's number), the topic's main key terms in bold, and the links between them.
 * `%% jump` lines tell the app which section heading each box opens.
 */
export function conceptMermaid(doc: LessonDoc): string {
  const home = homes(doc);
  if (home.size < 2) return "";
  const terms = [...home.keys()];
  const main = new Set(mainTerms(doc));
  const id = (t: string) => `k${terms.indexOf(t)}`;
  const lines = ["flowchart LR"];
  doc.sections.forEach((s, i) => {
    const mine = terms.filter((t) => home.get(t) === i);
    if (!mine.length) return;
    lines.push(`  subgraph s${i}[${mq(`${badge(i + 1)} ${shortHeading(s.map_title?.trim() || s.heading)}`)}]`, "    direction TB", ...mine.map((t) => `    ${id(t)}[${mq(t, 48)}]`), "  end");
  });
  for (const l of doc.concept_links ?? []) if (home.has(l.from) && home.has(l.to)) lines.push(`  ${id(l.from)} -->|${mq(l.label, 48)}| ${id(l.to)}`);
  lines.push(
    "  classDef default fill:#e8edff,stroke:#3b5bdb,color:#1f2433",
    "  classDef main fill:#c9d6ff,stroke:#2b4acb,stroke-width:2.5px,color:#1f2433,font-weight:bold",
    ...doc.sections.map((_, i) => `  style s${i} fill:transparent,stroke:#adb5bd,stroke-dasharray:4 3,color:#5d6680`).filter((_, i) => terms.some((t) => home.get(t) === i)),
  );
  if (main.size) lines.push(`  class ${terms.filter((t) => main.has(t)).map(id).join(",")} main`);
  for (const t of terms) lines.push(`  %% jump ${id(t)} ${badge(home.get(t)! + 1)}`);
  return lines.join("\n");
}

export interface ConceptLayout {
  groups: { section: number; heading: string; terms: { id: string; term: string; main: boolean }[] }[];
  links: { from: string; to: string; label: string }[];
}

/** The concept map as data, for drawing it elsewhere (the printed lesson): groups by section, and the links. */
export function conceptLayout(doc: LessonDoc): ConceptLayout | null {
  const home = homes(doc);
  if (home.size < 2) return null;
  const terms = [...home.keys()];
  const main = new Set(mainTerms(doc));
  const id = (t: string) => `k${terms.indexOf(t)}`;
  return {
    groups: doc.sections
      .map((s, i) => ({ section: i, heading: s.map_title?.trim() ? shortHeading(s.map_title, 40) : shortHeading(s.heading, 56), terms: terms.filter((t) => home.get(t) === i).map((t) => ({ id: id(t), term: t, main: main.has(t) })) }))
      .filter((g) => g.terms.length),
    links: (doc.concept_links ?? []).filter((l) => home.has(l.from) && home.has(l.to)).map((l) => ({ from: id(l.from), to: id(l.to), label: l.label })),
  };
}
