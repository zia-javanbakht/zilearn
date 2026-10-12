import { plainLabel, type DiagramSpec } from "./figure";
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

/**
 * Brings a lesson's key terms in line with its text, in place: section terms use the glossary's
 * spelling and only name terms the section uses; every glossary term the lesson uses gets a home
 * section; and the concept map keeps only links between known terms that one block of the lesson
 * states together. A lesson without links gets them from sentences that join two key terms.
 */
export function tidyTerms(doc: LessonDoc): LessonDoc {
  const home = homes(doc);
  doc.sections.forEach((s, i) => {
    s.terms = [...home].filter(([, at]) => at === i).map(([t]) => t);
  });
  const seen = new Set<string>();
  const together = (a: string, b: string) => doc.sections.some((_, i) => blockTexts(doc, i).some((t) => mentions(t, a) && mentions(t, b)));
  let links = (doc.concept_links ?? [])
    .map((l) => ({ from: findTerm(doc, l.from), to: findTerm(doc, l.to), label: l.label.replace(/\s+/g, " ").trim().slice(0, 48) }))
    .filter((l): l is ConceptLink => !!l.from && !!l.to && l.from !== l.to && !!l.label)
    .filter((l) => home.has(l.from) && home.has(l.to) && together(l.from, l.to))
    .filter((l) => {
      const k = [l.from, l.to].sort().join("|");
      return seen.has(k) ? false : (seen.add(k), true);
    });
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

/** Problems with how the lesson uses its key terms, figures and links, as messages for a fix pass. */
export function framingProblems(doc: LessonDoc): string[] {
  const out: string[] = [];
  const home = homes(doc);
  for (const g of doc.glossary) if (!home.has(g.term)) out.push(`The key term "${g.term}" is in the glossary but no section uses it: teach it in the section where it belongs (bold at first use), or drop it from the glossary.`);
  doc.sections.forEach((s, i) => {
    if (doc.glossary.length && !(s.terms ?? []).length && s.blocks.length)
      out.push(`Section ${i + 1} ("${s.heading}") teaches none of the key terms: say which key term it develops and use it.`);
    s.blocks.forEach((b, j) => {
      const d = b.figure?.diagram;
      if (!d) return;
      const text = `${b.title}\n${b.body}\n${b.solution ?? ""}\n${b.figure!.caption}`;
      const missing = d.nodes.filter((n) => !mentions(text, n.label)).map((n) => n.label);
      if (missing.length > d.nodes.length / 3)
        out.push(`The diagram in section ${i + 1}, block ${j + 1} ("${b.title}") has boxes the block's text never mentions (${missing.slice(0, 4).join(", ")}): label the boxes with the words the text uses, and walk through the diagram in the caption.`);
    });
  });
  return out;
}

/** Concept-map labels: plain text, no Mermaid syntax characters. */
const ml = (s: string) =>
  `"${plainLabel(s)
    .replace(/[#;`[\]{}|$\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48)
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")}"`;

/**
 * The lesson's concept map for the app: one box per key term, grouped by the section that teaches it
 * (titled with the section's number), and the links between them. `%% jump` lines tell the app which
 * section heading each box opens.
 */
export function conceptMermaid(doc: LessonDoc): string {
  const home = homes(doc);
  if (home.size < 2) return "";
  const terms = [...home.keys()];
  const id = (t: string) => `k${terms.indexOf(t)}`;
  const lines = ["flowchart LR"];
  doc.sections.forEach((s, i) => {
    const mine = terms.filter((t) => home.get(t) === i);
    if (!mine.length) return;
    lines.push(`  subgraph s${i}[${ml(`${badge(i + 1)} ${s.heading}`)}]`, "    direction TB", ...mine.map((t) => `    ${id(t)}[${ml(t)}]`), "  end");
  });
  for (const l of doc.concept_links ?? []) if (home.has(l.from) && home.has(l.to)) lines.push(`  ${id(l.from)} -->|${ml(l.label)}| ${id(l.to)}`);
  lines.push(
    "  classDef default fill:#e8edff,stroke:#3b5bdb,color:#1f2433",
    ...doc.sections.map((_, i) => `  style s${i} fill:transparent,stroke:#adb5bd,stroke-dasharray:4 3,color:#5d6680`).filter((_, i) => terms.some((t) => home.get(t) === i)),
  );
  for (const t of terms) lines.push(`  %% jump ${id(t)} ${badge(home.get(t)! + 1)}`);
  return lines.join("\n");
}

/** The concept map as a plain diagram (for the printed lesson), each box naming its section. */
export function conceptDiagram(doc: LessonDoc, sectionRef: (i: number) => string): DiagramSpec | null {
  const home = homes(doc);
  if (home.size < 2) return null;
  const terms = [...home.keys()];
  return {
    direction: "LR",
    nodes: terms.map((t, i) => ({ id: `k${i}`, label: `${t} ${sectionRef(home.get(t)!)}` })),
    edges: (doc.concept_links ?? []).filter((l) => home.has(l.from) && home.has(l.to)).map((l) => ({ from: `k${terms.indexOf(l.from)}`, to: `k${terms.indexOf(l.to)}`, label: l.label })),
  };
}
