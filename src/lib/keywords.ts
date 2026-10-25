import { BACK_MATTER, isAuthorLine, proseLines, stem, studySections } from "./text";
import { isGarbled } from "./textRepair";
import { ENGLISH_WORDS } from "./englishWords";

/**
 * Keyword-first reading of one material: the key terms it is about come first, then a map of them
 * (main terms with the terms that go with them), and for each term what the material itself says
 * about it, quoted with where it says it. Offline and deterministic; the AI digest uses the same
 * evidence search to ground its own terms.
 */

export interface Evidence {
  text: string;
  /** The section it comes from ("Material properties", "Abstract"), or null. */
  where: string | null;
  /** Where it is said in a recording ("mm:ss"), or null. */
  start: string | null;
}

export interface KeyTerm {
  term: string;
  /** Other ways the material writes it: an acronym ("RVE"), a plural, a hyphen-free spelling. */
  aliases: string[];
  count: number;
  score: number;
  /** Index of the first sentence that uses it. */
  first: number;
}

export interface KeywordNode {
  term: string;
  aliases: string[];
  note: string;
  evidence: Evidence[];
  start: string | null;
  children: KeywordNode[];
}

interface Sentence {
  text: string;
  where: string | null;
  start: string | null;
  /** Normalised word keys, in order, for phrase matching. */
  keys: string[];
  /** Abstract, author keywords or conclusion: where a paper says what matters. */
  lead: boolean;
  /** The label of the box this sentence opens ("Localisation Theorem" for "Theorem 2.3 — Localisation Theorem."), if any. */
  box?: string;
  /** In exercises or a quiz: it counts toward a term, but is never quoted. */
  drill?: boolean;
}

/** A box's label: "Definition 1.2 — Referential and Spatial Cuts." names what the box defines. */
const BOX = /^\s*(definition|theorem|lemma|corollary|proposition|keypoint|key point|example|remark|intuition|caption)\s+[\d.]+\s*[—–-]?\s*((?:[^.()]|\([^)]*\))*?)\s*(\([^)]*\d{4}[^)]*\))?\.(?=\s|$)\s*/i;

const SENTENCE_LIKE = /\b(is|are|was|were|be|been|has|have|had|can|will|we|our|this|these|which|that|it|i\.e|e\.g)\b/i;

/** The name a box label gives, or null when it is only a number or a sentence. */
function boxName(label: string): string | null {
  // Asides and citations aren't part of the name: "Divergence (Gauss') Theorem", "Jacobian Matrix (Cook et al. 2002)".
  const t = label.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().replace(/[:.]$/, "");
  const words = t.split(" ");
  if (words.length < 1 || words.length > 7 || !/\p{L}{3}/u.test(t)) return null;
  return t;
}

/* ---------------- The material's own text ---------------- */

const STAMP = /\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]/;
const AFFILIATION = /\b(prepared (for|by)|department|university|institute|school of|faculty of|laborator(y|ies)|college|e-?mail|corresponding author|received\b.*\d{4}|accepted\b.*\d{4}|doi:|https?:\/\/|orcid|©|copyright|creative commons|licen[cs]e)\b|@/i;
const KEYWORDS_LABEL = /^(?:#{1,6}\s*)?(key\s*words?|index terms)\b[\s:.—–-]*/i;

/** Words that say nothing on their own about a subject: never a key term alone, never the end of one. */
const GENERIC = new Set(
  `approach approaches analysis analyses aspect aspects authors behavior behaviour case cases change changes comparison condition
  conditions consideration contribution data detail details development difference differences effect effects end example
  examples experiment experiments fact factor factors feature features field figure findings form forms framework function functions
  goal idea information input inputs issue issues kind level levels line lines literature manner method methods model models
  number numbers order outcome outcomes output outputs paper parameter parameters part parts performance point points problem
  problems procedure process processes property properties purpose quantity range rate ratio reason research result results
  section sections set sets size sizes situation step steps structure studies study subject system systems technique techniques
  term terms test tests theory thing things time times type types use user value values variable variables way ways work works
  year years figure figures table tables equation equations eq eqs fig figs ref refs appendix chapter lecture slide slides
  high higher highest low lower lowest large larger small smaller different various several new good better best main major
  important significant similar same specific certain proposed present current previous recent respective total overall
  general typical common simple basic initial final first second third further additional possible available numerical
  experimental obtained shown given considered presented performed used based found reported compared related respectively
  addition terms well lot whole due order means definition definitions keypoint keypoints theorem theorems lemma remark remarks proof corollary proposition intuition summary overview introduction conclusion conclusions`.split(/\s+/),
);

/** Words that join a term's parts but never start or end one. */
const STOP = new Set(
  `a an the and or but nor of to in on at by for from with without within into onto over under between among through via per as
  is are was were be been being am has have had having do does did done can could will would shall should may might must
  this that these those it its they them their there here we our us you your he she his her i me my which who whom whose what
  when where why how than then so such not no yes also only just even very more most less least much many each every all any
  some both either neither other others another one two three four five six seven eight nine ten while if because since
  although though however therefore thus hence about after before during until upon again further once i.e e.g etc et al
  against across along around behind beyond toward towards despite near onto out off up down above below
  let us okay ok right um uh like going gonna want know think say said get got make made see seen show shows showed
  using use used uses can't don't it's that's we're you're there's let's here's`.split(/\s+/),
);

/** Words that qualify a term (stems, as wordKey gives them). */
const QUALIFIER = /^(high|higher|low|lower|large|larger|small|smaller|thin|thick|long|short)$/;

const ABBREV = /\b(?:et al|e\.g|i\.e|cf|vs|fig|figs|eq|eqs|ref|refs|no|approx|resp|dr|prof|sec|ch)\.$/i;

/** A text's words, a name joined by any dash ("Piola–Kirchhoff") being one. */
function wordsOf(t: string): string[] {
  return t.match(/[\p{L}][\p{L}\p{N}’'‐‑–-]*/gu) ?? [];
}

function wordKey(w: string): string {
  return stem(w.toLowerCase().replace(/[’']s?$/, "").replace(/[-‐‑–]/g, ""));
}

const DRILL = /^((multiple[- ]choice\s+)?(concept\s+)?quiz(zes)?|exercises?|hints?|answers?|answer checks|self[- ]?tests?|review questions|practice (problems|questions)|problems|solutions)\b/i;

const DRILL_WEIGHT = 0.5;
const VERB = /^(ensures?|gives|requires|yields|implies|enters|becomes|remains|provides|allows|makes|takes|shows|leads|means|uses|includes|contains|defines|describes|follows|holds|produces|reduces|increases|decreases|depends|satisfies|states|equals|governs|controls|determines)$/;

/** The material's teaching text: no title page, affiliations, references, funding or declarations. */
function bodySections(text: string, drills = false): { heading: string; body: string; lead: boolean; drill?: boolean }[] {
  const out: { heading: string; body: string; lead: boolean; drill?: boolean }[] = [];
  let backMatter = false;
  // Exercises, hints, answer checks and quizzes go over the text again: their terms are its terms.
  let drill: number | null = null;
  for (const s of studySections(text)) {
    if (s.heading && drill != null && (s.level ?? 1) <= drill) drill = null;
    if (s.heading && drill == null && DRILL.test(s.heading)) drill = s.level ?? 1;
    if (drill != null && !drills) continue;
    const lines = s.body.split("\n");
    const kept: string[] = [];
    for (const l of lines) {
      const t = l.replace(/^#{1,6}\s*/, "").trim();
      // A back-matter label inside a section ("Funding" set as plain text) starts the back matter;
      // an appendix ends it.
      if (BACK_MATTER.test(t.replace(/[:.]$/, ""))) backMatter = true;
      else if (/^appendix\b/i.test(t)) backMatter = false;
      if (backMatter) continue;
      if (AFFILIATION.test(t) && t.split(/\s+/).length < 40) continue;
      if (isAuthorLine(t)) continue;
      kept.push(l);
    }
    if (s.heading) backMatter = false;
    const body = kept.join("\n").trim();
    if (!body) continue;
    const abstract = /^(abstract|summary)\b/i.test(s.heading) || (!s.heading && /^\s*(abstract|summary)\b/im.test(body));
    out.push({ heading: s.heading, body, lead: abstract || /^(conclusions?|concluding remarks|summary and conclusions?)$/i.test(s.heading), drill: drill != null });
  }
  return out;
}

/** The author's own key terms ("Keywords: pseudo-ductile composite, finite element model, …"). */
export function authorKeywords(text: string): string[] {
  const lines = text.slice(0, 12000).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(KEYWORDS_LABEL);
    if (!m) continue;
    let list = lines[i].trim().slice(m[0].length);
    // The list may wrap onto the next lines, up to a blank line or a heading.
    for (let j = i + 1; j < lines.length && j < i + 4; j++) {
      const n = lines[j].trim();
      if (!n || /^#/.test(n) || /^(\d+\.?\s+)?introduction\b/i.test(n)) break;
      list += (list && !/[,;·•]$/.test(list) ? (/[,;·•]/.test(list) ? " " : ", ") : " ") + n;
    }
    const terms = list
      .split(/\s*[,;·•]\s*/)
      .map((x) => x.replace(/[.]$/, "").trim())
      .filter((x) => x.length >= 3 && x.length <= 60 && x.split(/\s+/).length <= 5);
    if (terms.length >= 2) return terms;
  }
  return [];
}

/** Sentences of the text, each with its section and, in a recording, its time. */
function sentencesOf(text: string, drills = false): Sentence[] {
  const out: Sentence[] = [];
  const boxes: { name: string; at: number }[] = [];
  for (const sec of bodySections(text, drills)) {
    let start: string | null = sec.heading.match(STAMP)?.[1] ?? null;
    const where = sec.heading.replace(STAMP, "").trim() || (sec.lead ? "Abstract" : null);
    // Units are paragraphs, list items and lines of slides: a sentence never runs across them.
    const units: string[] = [];
    let cur = "";
    for (const raw of proseLines(sec.body.split("\n"))) {
      const l = raw.trim();
      // A box ("Keypoint 2.2 — …") starts its own paragraph, whatever the line before it.
      if (!l || /^([-*+•·]|\d+[.)])\s/.test(l) || /^#/.test(l) || KEYWORDS_LABEL.test(l) || (BOX.test(l) && /[—–]/.test(l))) {
        if (cur) units.push(cur);
        cur = l && !KEYWORDS_LABEL.test(l) ? l.replace(/^#{1,6}\s*/, "") : "";
        continue;
      }
      cur += (cur ? " " : "") + l;
    }
    if (cur) units.push(cur);
    // A figure that names what it shows ("Figure 4. Graded mesh (non-uniform mesh): refinements …") is a box of its own.
    for (const l of sec.body.split("\n")) {
      const cap = l.trim().match(/^(?:Figure|Fig\.)\s*\d+[.:]\s+([\p{L}][\p{L} ’'()/-]{2,50}?):\s+(\S.*)$/u);
      const name = cap && boxName(cap[1]);
      if (name && name.split(" ").length <= 5 && !/^(the|a|an)\s/i.test(name)) units.push(`Caption 0 — ${name}. ${cap![2]}`);
    }
    for (const u of units) {
      // A list item that names what it explains ("- Jacobian ratio: the uniformity of …") defines that name.
      const item = u.match(/^(?:[-*+•·]|\d+[.)])\s+([\p{L}][\p{L}\p{N} ,'’()/‐‑–-]{2,70}?):\s+(\S.*)$/u);
      const label = item ? boxName(item[1]) : null;
      if (label && !SENTENCE_LIKE.test(label) && !/\b(of|the|and|to|in|a|an|by|with|for|from|on)$/i.test(label)) boxes.push({ name: label, at: out.length });
      // Superscript citations stick to the stop ("industries.1 However", "et al.15 used").
      const clean = u
        .replace(/([a-z)\]])[.](\d+(?:[,–-]\d+)*)(?=\s+\p{Lu})/gu, "$1.")
        .replace(/\bet al\.\s?\d+(?:[,–-]\d+)*/g, "et al.")
        .replace(/^[-*+•·]\s+/, "")
        .replace(/^(abstract|summary)[.:]?\s+(?=\p{Lu})/iu, "");
      // A display equation is part of the sentence that leads into it, and the sentence ends with it.
      const maths: string[] = [];
      const held = clean.replace(/\$\$[\s\S]*?\$\$/g, (m) => `\u0001${maths.push(m) - 1}\u0001`).replace(/(\u0001\d+\u0001)\s+(?=\p{Lu}\p{Ll})/gu, "$1\u0002");
      const back = (x: string) => x.replace(/\u0001(\d+)\u0001/g, (_, k) => maths[Number(k)]);
      let piece = "";
      for (const tok of held.split(/(?<=[.!?])\s+|\u0002/)) {
        piece += (piece ? " " : "") + tok;
        if (ABBREV.test(piece) || /\b\p{Lu}\.$/u.test(piece)) continue;
        push(back(piece));
        piece = "";
      }
      if (piece) push(back(piece));
    }
    function push(s: string) {
      const stamp = s.match(STAMP)?.[1];
      if (stamp) start = stamp;
      const pre = s
        .replace(new RegExp(STAMP.source, "g"), "")
        // Pointers to what the text layer couldn't hold, and a box's label ("Definition 1.1 — Isoparametric Concept."), aren't sentences.
        .replace(/\[(diagram|matrix)[^\]]*\]/g, "")
        .replace(/^\s*\(\d+\)\s*/, "");
      const label = pre.match(BOX);
      const box = label && /[—–-]/.test(label[0]) ? boxName(label[2]) : null;
      const t = pre
        .replace(BOX, "")
        .replace(/\s+/g, " ")
        .trim();
      if (box) boxes.push({ name: box, at: out.length });
      if (t.split(" ").length < 3) return;
      // Captions without stops (speech recognition) run on: take them about thirty words at a time.
      // A display equation counts as one word and is never cut.
      const maths: string[] = [];
      const words = t.replace(/\$\$[\s\S]*?\$\$/g, (m) => `\u0001${maths.push(m) - 1}\u0001`).split(" ");
      if (words.length > 70 && !/[.!?]["”’)]?$/.test(t)) {
        for (let k = 0; k < words.length; k += 30) push(words.slice(k, k + 30).join(" ").replace(/\u0001(\d+)\u0001/g, (_, i) => maths[Number(i)]));
        return;
      }
      const opens = boxes.length && boxes[boxes.length - 1].at === out.length ? boxes[boxes.length - 1].name : undefined;
      out.push({ text: t, where, start, keys: wordsOf(t).map(wordKey), lead: sec.lead, ...(opens && !sec.drill ? { box: opens } : {}), ...(sec.drill ? { drill: true } : {}) });
    }
  }
  return out;
}

/* ---------------- Key terms ---------------- */

interface Candidate {
  key: string;
  /** The word just before or after it, each time it is used: a term always written after "finite" is part of a longer one. */
  prev: Map<string, number>;
  next: Map<string, number>;
  forms: Map<string, number>;
  count: number;
  sentences: Set<number>;
  first: number;
  aliases: Set<string>;
  boost: number;
  /** A box names it. */
  box?: boolean;
}

/** "representative volume element (RVE)": the words before the brackets whose initials spell it. */
function acronyms(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/((?:[\p{L}][\p{L}-]*\s+){1,6})\(([A-Z][A-Za-z]{1,7}?)(s)?\)/gu)) {
    const acr = m[2];
    const letters = acr.replace(/[a-z]/g, "").toLowerCase();
    if (letters.length < 2) continue;
    const words = m[1].trim().split(/\s+/);
    for (let k = letters.length - 1; k <= Math.min(words.length, letters.length + 1); k++) {
      const phrase = words.slice(words.length - k);
      const initials = phrase.flatMap((w) => w.split("-").filter(Boolean)).map((w) => w[0].toLowerCase()).join("");
      const initials2 = phrase.map((w) => w[0].toLowerCase()).join("");
      if ((initials === letters || initials2 === letters) && !STOP.has(phrase[0].toLowerCase())) {
        if (!out.has(acr)) out.set(acr, phrase.join(" "));
        break;
      }
    }
  }
  return out;
}

/** Runs of words a term can be made of: broken at stop words, numbers, symbols and punctuation; "of" joins ("conservation of mass"). */
function runs(sentence: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  const end = () => {
    while (cur.length && cur[cur.length - 1] === "of") cur.pop();
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const tok of sentence.split(/\s+/)) {
    // An opening bracket starts an aside: "law of thermodynamics (balance of energy)" is two terms.
    if (/^[([{]/.test(tok)) end();
    // Names joined by an en dash are one word: "Piola–Kirchhoff", "Cauchy–Green".
    const word = tok.replace(/^[("'“‘[]+|[)"'”’\],.;:!?]+$/g, "").replace(/(?<=\p{L})[‐‑–](?=\p{L})/gu, "-");
    if (word === "of" && cur.length && !cur.includes("of")) {
      cur.push(word);
      continue;
    }
    // Words of letters only: no maths letters, Greek symbols or two-letter scraps ("PN da", "δe dv").
    const plain = /^\p{L}[\p{L}’'-]*\p{L}$/u.test(word) && !/[\u{1D400}-\u{1D7FF}Ͱ-Ͽ]/u.test(word) && (word.length >= 3 || /^\p{Lu}{2}$/u.test(word));
    if (!plain || STOP.has(word.toLowerCase())) {
      end();
      continue;
    }
    cur.push(word);
    // Punctuation after a word ends the run.
    if (/[,.;:!?)]$/.test(tok)) end();
  }
  end();
  return out;
}

const keyOf = (words: string[]) => words.map(wordKey).join(" ");

/** Words of `a` appear in `b` in a row. */
function inside(a: string[], b: string[]): boolean {
  return a.length < b.length && ` ${b.join(" ")} `.includes(` ${a.join(" ")} `);
}

/** Two terms share a run of at least two words without either containing the other: pieces of one longer term. */
function overlap(a: string[], b: string[]): boolean {
  // "of the Jacobian" in "role of the Jacobian" and "two uses of the Jacobian" is no shared piece.
  for (let i = 0; i + 1 < a.length; i++) if (!/^(of|the|and|a|an)$/.test(a[i]) && !/^(of|the|and|a|an)$/.test(a[i + 1]) && ` ${b.join(" ")} `.includes(` ${a[i]} ${a[i + 1]} `)) return true;
  return false;
}

let common: Set<string> | null = null;
/** Everyday English words: on its own, one of them is rarely what a material is about ("strain", "mass", "element"). */
function everyday(w: string): boolean {
  common ??= new Set(ENGLISH_WORDS.split(" "));
  const forms = (x: string) => [x, x.replace(/s$/, ""), x.replace(/es$/, ""), x.replace(/ies$/, "y"), x.replace(/ed$/, ""), x.replace(/ing$/, ""), x.replace(/ing$/, "e"), x.replace(/ly$/, "")];
  // "non-uniform": every part is everyday.
  return w.split("-").filter(Boolean).every((part) => forms(part).some((f) => common!.has(f)) || /^(non|un|re|pre|sub|multi|micro|macro|semi)$/.test(part));
}

/** The material's key terms, best first: phrases it repeats, that its title, abstract and headings use. */
export function keyTerms(text: string, max = 24): KeyTerm[] {
  // Exercises and quizzes go over the text's terms again: they count, at half weight.
  const sentences = sentencesOf(text, true);
  if (!sentences.filter((s) => !s.drill).length) return [];
  // Where each sentence is among the quotable ones (a term's first mention is given in those).
  const rank: number[] = [];
  sentences.reduce((n, s, i) => ((rank[i] = n), s.drill ? n : n + 1), 0);
  const acr = acronyms(sentences.map((s) => s.text).join(" "));
  const acrKey = new Map([...acr].map(([a, phrase]) => [a, keyOf(phrase.split(/\s+/))]));
  const authors = authorKeywords(text);
  const keysIn = (s: string) => ` ${wordsOf(s).map(wordKey).join(" ")} `;
  const titleKeys = keysIn(text.match(/^#\s+(.+)$/m)?.[1] ?? "");
  const headingKeys = studySections(text)
    .map((s) => keysIn(s.heading))
    .join(" | ");
  // A word written in lower case anywhere is an ordinary word; one that never is (Weibull, Jacobian) is a name.
  const lower = new Set(sentences.flatMap((s) => s.text.match(/(?<![.!?]\s)\b\p{Ll}[\p{L}’'-]*/gu) ?? []).map((w) => w.toLowerCase()));
  // A name is capitalised after a word in lower case, not just inside a Title Case label.
  const named = new Set(sentences.flatMap((s) => s.text.match(/(?<=(?:^|\s)(?!(?:of|and|or|the|a|an|in|for|to|on|by|with|from|at|vs)\s)\p{Ll}[\p{L}’'-]*[,;]?\s)\p{Lu}\p{Ll}[\p{L}’'‐‑–-]*/gu) ?? []).map((w) => w.replace(/[’']s$/, "").replace(/[‐‑–]/g, "-")));

  const cands = new Map<string, Candidate>();
  const add = (words: string[], i: number, prev?: string, next?: string) => {
    const key = keyOf(words);
    let c = cands.get(key);
    if (!c) cands.set(key, (c = { key, prev: new Map(), next: new Map(), forms: new Map(), count: 0, sentences: new Set(), first: rank[i], aliases: new Set(), boost: 1 }));
    const w = sentences[i].drill ? DRILL_WEIGHT : 1;
    if (prev && prev !== "of") c.prev.set(wordKey(prev), (c.prev.get(wordKey(prev)) ?? 0) + w);
    if (next && next !== "of") c.next.set(wordKey(next), (c.next.get(wordKey(next)) ?? 0) + w);
    // Spelt as the text spells it mid-sentence: names (Weibull, Jacobian) and acronyms keep their capitals.
    const form = words.map((w) => (/^\p{Lu}{2,}/u.test(w) || (!lower.has(w.toLowerCase()) && (named.has(w) || !/^\p{Lu}\p{Ll}/u.test(w))) ? w : w.toLowerCase())).join(" ");
    c.forms.set(form, (c.forms.get(form) ?? 0) + 1);
    c.count += w;
    if (!sentences[i].drill) c.sentences.add(i);
  };
  sentences.forEach((s, i) => {
    for (const run of runs(s.text)) {
      for (let len = 1; len <= Math.min(5, run.length); len++)
        for (let at = 0; at + len <= run.length; at++) {
          const words = run.slice(at, at + len);
          if (words[0] === "of" || words[len - 1] === "of" || (len > 4 && !words.includes("of"))) continue;
          // "X of Y" is a term only as a whole ("conservation of linear momentum"), not cut from a longer run.
          if (words.includes("of") && (at > 0 || at + len < run.length)) continue;
          // An acronym counts for the phrase it stands for.
          const bare = words[0].replace(/s$/, "");
          if (len === 1 && acrKey.has(bare) && /^\p{Lu}{2,}s?$/u.test(words[0])) {
            add(acr.get(bare)!.split(/\s+/), i);
            cands.get(acrKey.get(bare)!)!.aliases.add(bare);
            continue;
          }
          const first = words[0].toLowerCase();
          const last = words[len - 1].toLowerCase();
          if (len > 1 && GENERIC.has(first) && !/^(high|low|finite|numerical|micro|macro|initial|total|general)/.test(first)) continue;
          if (len === 1 && GENERIC.has(last)) continue;
          // A verb ("ensures local invertibility", "nonlinearity enters") makes a clause, not a term.
          if (len > 1 && (VERB.test(first) || VERB.test(last))) continue;
          // An adverb starts a clause, not a term ("randomly removes units").
          if (/ly$/.test(first) && first.length > 4 && !/^(assembly|family|anomaly|poly|supply|monopoly|butterfly)$/.test(first)) continue;
          if (len > 1 && /^(high|higher|low|lower|large|small|different|various|several|new|proposed|present|good)$/.test(last)) continue;
          add(words, i, run[at - 1], run[at + len]);
        }
    }
  });
  for (const [a, phrase] of acr) {
    const c = cands.get(keyOf(phrase.split(/\s+/)));
    if (c) {
      c.aliases.add(a);
      c.boost *= 2;
    }
  }
  for (const t of authors) {
    const c = cands.get(keyOf(t.split(/\s+/)));
    if (c) c.boost *= 3;
  }
  // What a box defines or states ("Referential and Spatial Cuts", "Localisation Theorem") is a key term of the notes.
  sentences.forEach((s, i) => {
    if (!s.box) return;
    // Title case in a label isn't the term's own spelling: a word keeps its capital only where the text writes it so mid-sentence (Jacobian, Cauchy).
    const words = s.box.split(/\s+/).map((w, k) => (/^\p{Lu}{2,}/u.test(w) || (!lower.has(w.toLowerCase()) && named.has(w)) ? w : k === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()));
    const key = keyOf(words);
    if (!cands.has(key)) add(words, i);
    const c = cands.get(key)!;
    c.boost *= 3;
    c.box = true;
  });

  const valid = (c: Candidate, form: string) => {
    const words = c.key.split(" ");
    if (words.length === 1 && c.boost === 1 && (GENERIC.has(words[0]) || everyday(form.toLowerCase()) || words[0].length < 4 || c.count < 4)) return false;
    return c.count >= 2 || c.boost > 1;
  };
  const formOf = (c: Candidate) => [...c.forms].sort((a, b) => b[1] - a[1])[0][0];
  // Nearly always qualified ("low strain material", "high strain material"): the qualified phrases are the terms.
  const qualified = (c: Candidate) => {
    let n = 0;
    for (const [w, k] of c.prev) if (QUALIFIER.test(w)) n += k;
    return c.boost === 1 && c.count >= 3 && n >= 0.7 * c.count;
  };
  // A longer phrase whose shorter part is used much more often on its own is that part plus a word that
  // isn't part of the term ("learning rate controls", "enhanced strain field" next to "enhanced strain").
  const pairs = [...cands.values()].filter((c) => c.count >= 2 && c.key.split(" ").length === 2);
  const inPhrases = (c: Candidate) => pairs.reduce((n, p) => n + (p.key.split(" ").includes(c.key) ? p.count : 0), 0);
  const extended = (c: Candidate) => {
    const words = c.key.split(" ");
    if (words.length < 2 || c.boost > 1) return false;
    for (let len = words.length - 1; len >= 1; len--)
      for (let at = 0; at + len <= words.length; at++) {
        const sub = cands.get(words.slice(at, at + len).join(" "));
        // A word that is itself mostly part of phrases ("Weibull" in "Weibull modulus") doesn't stand for them.
        if (sub && sub !== c && sub.count >= 1.5 * c.count && valid(sub, formOf(sub)) && !qualified(sub) && !(len === 1 && sub.boost === 1 && inPhrases(sub) >= 0.5 * sub.count)) return true;
      }
    return false;
  };
  const scored = [...cands.values()]
    .map((c) => ({ c, form: formOf(c) }))
    .filter(({ c }) => !extended(c))
    .filter(({ c, form }) => {
      const words = c.key.split(" ");
      // On its own, an everyday word ("strain", "mass") is part of a longer term; a name or a coined word stands alone.
      if (words.length === 1 && c.boost === 1 && (GENERIC.has(words[0]) || everyday(form.toLowerCase()) || words[0].length < 4)) return false;
      if (words.length === 1 && c.boost === 1 && c.count < 4) return false;
      // A lone adjective ("nonlinear", "tensile", "constitutive") qualifies a term rather than being one.
      if (words.length === 1 && c.boost === 1 && /(al|ive|ar|ile|ic|ous|ary|ory|able|ible)$/.test(words[0]) && !/^\p{Lu}/u.test(form)) return false;
      // A word mostly used inside longer terms ("tangent" in "consistent tangent", "tangent stiffness") is those terms.
      if (words.length === 1 && c.boost === 1 && inPhrases(c) >= 0.5 * c.count) return false;
      // Part of a longer term: nearly always written with the same word before or after it ("element model" after "finite").
      const most = (m: Map<string, number>) => Math.max(0, ...m.values());
      if (c.boost === 1 && c.count >= 2 && Math.max(most(c.prev), most(c.next)) >= 0.7 * c.count) return false;
      if (qualified(c)) return false;
      // Operator names in formulas ("sym Grad η", "Div P") are maths, not terms.
      if (c.boost === 1 && words.some((w) => /^(sym|grad|div|curl|det|tr|dev|diag)$/.test(w))) return false;
      // Terms the material uses once are kept only when it names them as key (author keywords, an acronym).
      return c.count >= 2 || c.boost > 1;
    })
    .map(({ c, form }) => {
      const words = c.key.split(" ");
      let score = Math.log(1 + c.count) * (1 + 0.7 * (Math.min(words.length, 4) - 1)) * c.boost;
      if (titleKeys.includes(` ${c.key} `)) score *= 1.6;
      if (headingKeys.includes(` ${c.key} `)) score *= 1.4;
      if ([...c.sentences].some((i) => sentences[i].lead)) score *= 1.25;
      if (words.length === 1 && c.boost === 1) score *= c.count >= 6 ? 0.8 : 0.6;
      // A generic word in front ("model results", "effect of fiber") makes a weak term.
      if (words.length > 1 && GENERIC.has(words[0])) score *= 0.7;
      // A term ending in a word for any quantity ("strain values") names the measure, not a concept.
      if (words.length > 1 && /\s(value|result|number|data|level|case|point|part|thing|amount)s?$/i.test(form)) score *= 0.6;
      return { c, score, form };
    })
    .sort((a, b) => b.score - a.score);

  // Terms that are pieces of one another count once: a shorter term used mostly inside a longer one
  // ("volume element" in "representative volume element") is the longer one, a longer one used much less than
  // its shorter form ("enhanced strain field" next to "enhanced strain") gives way to it, and pieces of one long
  // name ("driven return mapping", "strain driven return") are that name.
  const picked: { c: Candidate; score: number; form: string }[] = [];
  for (const s of scored) {
    if (picked.length >= max) break;
    const words = s.c.key.split(" ");
    const clash = picked.some((p) => {
      const pw = p.c.key.split(" ");
      if (inside(words, pw)) return s.c.count <= p.c.count * 3;
      if (inside(pw, words)) return s.c.count < Math.max(3, p.c.count * 0.5);
      return overlap(words, pw) && s.c.count <= p.c.count * 1.5;
    });
    if (!clash) picked.push(s);
  }
  return picked.map(({ c, score, form }) => ({
    term: form,
    aliases: [...c.aliases, ...[...c.forms.keys()].filter((f) => f !== form && f.toLowerCase() !== form.toLowerCase()).slice(0, 2)],
    count: c.count,
    score: Math.round(score * 100) / 100,
    first: c.first,
  }));
}

/* ---------------- What the material says about each term ---------------- */

const DEFINES = /\b(is|are|refers? to|is defined as|are defined as|denotes?|is called|are called|known as|means|stands for|describes?|consists? of)\b/i;

function contains(s: Sentence, keys: string[][]): boolean {
  return keys.some((k) => {
    outer: for (let i = 0; i + k.length <= s.keys.length; i++) {
      for (let j = 0; j < k.length; j++) if (s.keys[i + j] !== k[j]) continue outer;
      return true;
    }
    return false;
  });
}

function termKeys(term: string, aliases: string[]): string[][] {
  return [term, ...aliases].map((t) => wordsOf(t).map(wordKey)).filter((k) => k.length);
}

/** Readable, not a line of maths or a broken extraction. */
function quotable(t: string, lenient = false): boolean {
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  const words = t.split(/\s+/).length;
  // A reference ("Wriggers, P. Nonlinear Finite Element Methods.") names a book; it doesn't teach.
  if (/^\p{Lu}[\p{L}'-]+,\s+(\p{Lu}\.\s?)+/u.test(t)) return false;
  return words >= (lenient ? 4 : 6) && words <= 70 && letters / t.length > (lenient ? 0.4 : 0.6) && (lenient || !isGarbled(t));
}

/** The sentences of `text` that best say what it teaches about a term, in the order it says them. */
export function evidenceFor(text: string, term: string, aliases: string[] = [], others: string[] = [], n = 3): Evidence[] {
  return evidenceIn(sentencesOf(text), term, aliases, others, n);
}

function evidenceIn(sentences: Sentence[], term: string, aliases: string[], others: string[], n: number, used = new Set<string>()): Evidence[] {
  const keys = termKeys(term, aliases);
  const otherKeys = others.filter((o) => o !== term).map((o) => termKeys(o, []));
  const boxKey = keyOf(term.split(/\s+/));
  const opens = (s: Sentence) => !!s.box && keyOf(s.box.split(/\s+/)) === boxKey;
  const using = sentences.map((s, i) => ({ s, i })).filter(({ s }) => contains(s, keys) || opens(s));
  // Where every sentence using it is mostly maths, the best of those is still what the material says.
  const strict = using.filter(({ s }) => quotable(s.text));
  const hits = (strict.length ? strict : using.filter(({ s }) => quotable(s.text, true)))
    .map(({ s, i }) => {
      let score = 0;
      const at = s.text.toLowerCase().indexOf(term.toLowerCase().split(" ")[0]);
      if (DEFINES.test(s.text.slice(Math.max(0, at), at + term.length + 40))) score += 3;
      if (aliases.some((a) => s.text.includes(`(${a})`) || s.text.includes(`(${a}s)`))) score += 2;
      score += Math.min(3, otherKeys.filter((k) => contains(s, [k[0] ?? []])).length) * 0.7;
      if (s.lead) score += 1;
      // The box that names it says what it is.
      if (opens(s)) score += 4;
      // Another term's note already quotes it: say something new where the material does.
      if (used.has(s.text)) score -= 2.5;
      const words = s.text.split(" ").length;
      if (words > 45) score -= 1;
      // The first time a term comes up is usually where it is introduced.
      return { s, i, score: score - i / (sentences.length * 4) };
    });
  const seen = new Set<string>();
  return hits
    .sort((a, b) => b.score - a.score)
    .filter((h) => !seen.has(h.s.text) && seen.add(h.s.text))
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map(({ s }) => ({ text: s.text, where: s.where, start: s.start }));
}

/* ---------------- The keyword map ---------------- */

/** Characters past which a material counts as long (a paper, a chapter of notes). */
const LONG_TEXT = 20000;

/**
 * The material's keyword map: up to `mains` main terms in the order the material takes them up, each
 * with the terms used most with it, and every term with what the material says about it.
 */
export function keywordMap(text: string, opts: { mains?: number; children?: number; terms?: KeyTerm[] } = {}): KeywordNode[] {
  const sentences = sentencesOf(text);
  // A long paper or set of notes has more to map than a short handout.
  const long = text.length > LONG_TEXT;
  const terms = opts.terms ?? keyTerms(text, long ? 44 : 24);
  if (!terms.length) return [];
  const nMain = Math.min(opts.mains ?? (long ? 12 : 7), Math.max(3, Math.ceil(terms.length / 3)));
  // A box's sentences are about what its label names, though the label itself isn't in them.
  const boxOf = (s: Sentence) => (s.box ? wordsOf(s.box).map(wordKey).join(" ") : null);
  const sets = new Map(terms.map((t) => [t.term, new Set(sentences.flatMap((s, i) => (contains(s, termKeys(t.term, t.aliases)) || boxOf(s) === wordsOf(t.term).map(wordKey).join(" ") ? [i] : [])))]));
  // Main terms are ones the material keeps coming back to.
  const strong = terms.filter((t) => t.count >= 3);
  const main = (strong.length >= 3 ? strong : terms).slice(0, nMain);
  const rest = terms.filter((t) => !main.includes(t));
  const kids = new Map<string, KeyTerm[]>(main.map((m) => [m.term, []]));
  const words = (t: string) => new Set(t.toLowerCase().split(/\s+/).map(wordKey));
  const weak = new Map<string, string>();
  for (const t of rest) {
    let best: { m: KeyTerm; a: number } | null = null;
    for (const m of main) {
      const a = sets.get(t.term)!;
      const b = sets.get(m.term)!;
      let shared = 0;
      for (const x of a) if (b.has(x)) shared++;
      let assoc = shared / Math.sqrt((a.size || 1) * (b.size || 1));
      // Sharing a word ("low-strain ply" and "middle ply") ties terms together too.
      if ([...words(t.term)].some((w) => words(m.term).has(w))) assoc += 0.25;
      if (assoc > 0 && (!best || assoc > best.a)) best = { m, a: assoc };
    }
    // Nothing shared: the main term the same section or slide talks about ("Skew" in "Element Quality").
    if (!best) {
      const at = Math.min(...sets.get(t.term)!);
      const where = sentences[at]?.where;
      let near = Infinity;
      for (const m of main)
        for (const x of sets.get(m.term)!)
          if (sentences[x].where === where && Math.abs(x - at) < near) (near = Math.abs(x - at)), (best = { m, a: 0 });
      if (best) weak.set(t.term, best.m.term);
      continue;
    }
    if (kids.get(best.m.term)!.length < (opts.children ?? 5)) kids.get(best.m.term)!.push(t);
  }
  const all = terms.map((t) => t.term);
  const used = new Set<string>();
  const node = (t: KeyTerm, children: KeywordNode[]): KeywordNode => {
    const evidence = evidenceIn(sentences, t.term, t.aliases, all, 3, used);
    if (evidence[0]) used.add(evidence[0].text);
    return { term: t.term, aliases: t.aliases, note: evidence[0]?.text ?? "", evidence, start: evidence[0]?.start ?? null, children };
  };
  // A sub-term the material says nothing new about (its only sentences are already quoted for another
  // term) is a passing mention, not part of the map.
  const child = (k: KeyTerm): KeywordNode[] => {
    const before = new Set(used);
    const n = node(k, []);
    const named = k.aliases.some((a) => /^\p{Lu}{2,}/u.test(a));
    return n.note && (named || !before.has(n.note)) ? [n] : [];
  };
  const tree = main
    .sort((a, b) => a.first - b.first)
    .map((m) => {
      const parent = node(m, []);
      parent.children = kids
        .get(m.term)!
        .sort((a, b) => a.first - b.first)
        .flatMap(child);
      return parent;
    });
  // Terms placed only by where they are said come last, so they don't take another term's quote.
  for (const t of rest) {
    const p = tree.find((n) => n.term === weak.get(t.term));
    if (!p || p.children.length >= (opts.children ?? 5)) continue;
    p.children.push(...child(t));
    p.children.sort((a, b) => terms.find((x) => x.term === a.term)!.first - terms.find((x) => x.term === b.term)!.first);
  }
  return tree;
}

/** A label for a term: its acronym after it when the material uses one ("Representative volume element (RVE)"). */
export function termLabel(term: string, aliases: string[] = []): string {
  const acr = aliases.find((a) => /^\p{Lu}{2,}[a-z]?$/u.test(a) && !term.includes(a));
  const t = term[0].toUpperCase() + term.slice(1);
  return acr ? `${t} (${acr})` : t;
}

/* ---------------- Grounding terms from elsewhere (the AI) ---------------- */

export interface TermItem {
  term: string;
  parent: string | null;
  note: string;
  start: string | null;
}

/**
 * Terms someone else picked (the AI), as a keyword map grounded in the material: a term the text never uses
 * is dropped (its children move up), every kept term gets the material's own sentences about it, and the
 * acronym the material uses for it.
 */
export function groundTerms(text: string, items: TermItem[]): KeywordNode[] {
  const sentences = sentencesOf(text);
  const acr = acronyms(sentences.map((s) => s.text).join(" "));
  const all = items.map((i) => i.term);
  const used = new Set<string>();
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const nodes = new Map<string, KeywordNode & { parent: string | null }>();
  for (const it of items) {
    const term = it.term.replace(/\s+/g, " ").trim();
    if (!term || nodes.has(norm(term))) continue;
    // "Representative volume element (RVE)": the bracket is the acronym.
    const bracket = term.match(/^(.*?)\s*\(([^)]{2,10})\)$/);
    const base = bracket ? bracket[1] : term;
    const aliases = [...acr].filter(([, phrase]) => norm(phrase) === norm(base) || norm(phrase).replace(/s$/, "") === norm(base).replace(/s$/, "")).map(([a]) => a);
    if (bracket && !aliases.includes(bracket[2])) aliases.push(bracket[2]);
    const keys = termKeys(base, aliases);
    if (!sentences.some((s) => contains(s, keys))) continue;
    const evidence = evidenceIn(sentences, base, aliases, all, 3, used);
    if (evidence[0]) used.add(evidence[0].text);
    nodes.set(norm(term), { term: base, aliases, note: it.note.trim() || evidence[0]?.text || "", evidence, start: it.start ?? evidence[0]?.start ?? null, children: [], parent: it.parent ? norm(it.parent) : null });
  }
  const roots: KeywordNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parent && n.parent !== norm(n.term) ? nodes.get(n.parent) : undefined;
    const { parent: _p, ...node } = n;
    // Two levels: a term under a sub-term goes under that sub-term's main term.
    const host = parent && parent.parent && nodes.get(parent.parent) ? nodes.get(parent.parent)! : parent;
    if (host && host !== n) host.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/* ---------------- The material's own summary ---------------- */

/** A paper's abstract, which says what it is about better than its title and author lines do. */
export function abstractOf(text: string): string | null {
  // Older journals call it the summary ("SUMMARY"); it ends at a blank line, a heading or the numbered introduction.
  const m = text.slice(0, 8000).match(/^(?:#{1,6}\s*)?(?:abstract|summary)[.:]?\s*$\n([\s\S]{80,}?)(?:\n\s*\n|\n#{1,6}\s|\n1\.?\s+\p{Lu}|$)/imu);
  return m ? m[1] : null;
}

/** The first sentences of a material's abstract, cleaned of citation marks, or null without one. */
export function abstractSentences(text: string, n: number): string | null {
  const own = sentencesOf(text).filter((s) => s.where === "Abstract" && quotable(s.text));
  return own.length >= 2 ? own.slice(0, n).map((s) => s.text).join(" ") : null;
}
