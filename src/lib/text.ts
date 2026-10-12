const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers herself him himself
  his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours
  ourselves out over own same she should so some such than that the their theirs them themselves then there these they this
  those through to too under until up very was we were what when where which while who whom why will with would you your
  yours yourself yourselves also may might must shall can't cannot use used using one two three first second new however
  thus therefore e g eg ie etc via per within without upon let lets get gets got make makes made many much well like slide
  page lecture week chapter section figure table example examples note notes see`.split(/\s+/),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9\-]{1,}/g) ?? [])
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Light stemming so "networks"/"network" and "learning"/"learned" match. */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

// Words about the paper or the recording rather than the subject; fine in search, useless as key terms.
const BOILERPLATE = new Set("question questions marks mark total answer answers points minutes hour hours instructions candidates attempt tutorial workshop exam exams received recording".split(" "));

export function topKeywords(text: string, n = 8): string[] {
  const counts = new Map<string, { n: number; word: string }>();
  for (const w of tokenize(text)) {
    if (BOILERPLATE.has(w)) continue;
    const s = stem(w);
    const c = counts.get(s);
    if (c) c.n++;
    else counts.set(s, { n: 1, word: w });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.word.localeCompare(b.word))
    .slice(0, n)
    .map((c) => c.word);
}

/** Split text into ~size-char chunks on paragraph/sentence boundaries for search indexing. */
export function chunkText(text: string, size = 1200): string[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n\s*\n/);
  const chunks: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const p of paras) {
    if (p.length > size) {
      push();
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (cur.length + s.length > size) push();
        cur += (cur ? " " : "") + s.slice(0, size * 2);
      }
      push();
    } else {
      if (cur.length + p.length > size) push();
      cur += (cur ? "\n\n" : "") + p;
    }
  }
  push();
  return chunks;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/* ---------- TF-IDF similarity used by the knowledge base ---------- */

export type Vector = Map<string, number>;

export function tfidfVectors(docs: string[]): Vector[] {
  const tfs = docs.map((d) => {
    const m = new Map<string, number>();
    for (const w of tokenize(d)) {
      const s = stem(w);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  });
  const df = new Map<string, number>();
  for (const tf of tfs) for (const k of tf.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const N = docs.length;
  return tfs.map((tf) => {
    const v: Vector = new Map();
    let norm = 0;
    for (const [k, c] of tf) {
      const w = (1 + Math.log(c)) * Math.log(1 + N / (df.get(k) ?? 1));
      v.set(k, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [k, w] of v) v.set(k, w / norm);
    return v;
  });
}

export function cosine(a: Vector, b: Vector): number {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [k, w] of small) {
    const o = big.get(k);
    if (o) s += w * o;
  }
  return s;
}

export function sharedTerms(a: Vector, b: Vector, n = 4): string[] {
  const out: [string, number][] = [];
  for (const [k, w] of a) {
    const o = b.get(k);
    if (o) out.push([k, w * o]);
  }
  return out
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([k]) => k);
}

/* ---------- Heading detection for the offline brainmap ---------- */

export interface Section {
  heading: string;
  body: string;
  /** How deep the heading sits: 0 for a document title ("# …"), 1 for a section, 2 for a subsection, … */
  level?: number;
}

/** The depth of a heading line, from its Markdown hashes or its numbering ("2.1" is 2). */
function headingLevel(line: string): number {
  const md = line.match(/^(#{1,4})\s+(.*)$/);
  if (md) {
    const num = md[2].match(/^(\d+(?:\.\d+){0,3})\.?\s/);
    return num ? num[1].split(".").length : md[1].length - 1;
  }
  const num = line.match(/^(\d+(?:\.\d+){0,3})[.)]?\s/);
  return num ? num[1].split(".").length : 1;
}

export function splitSections(text: string): Section[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const h = headingOf(line);
    // A title set over two lines ("A CLASS OF … METHODS AND" / "THE METHOD OF …") is one heading.
    if (h && cur && cur.heading && !cur.body && TRAILING_FUNCTION_WORD.test(cur.heading)) {
      cur.heading += ` ${h}`;
    } else if (h) {
      if (cur) sections.push(cur);
      cur = { heading: h, body: "", level: headingLevel(line) };
    } else if (line) {
      if (!cur) cur = { heading: "", body: "" };
      cur.body += line + "\n";
    }
  }
  if (cur) sections.push(cur);
  return sections.filter((s) => s.heading || s.body.trim());
}

function headingOf(line: string): string | null {
  if (!line) return null;
  // Marked headings may be long (a paper's title); guessed ones may not.
  let m = line.length <= 200 ? line.match(/^#{1,4}\s+(.+)$/) : null;
  if (m) return m[1].trim();
  if (line.length > 90) return null;
  m = line.match(/^(?:slide\s+\d+\s*[:\-–]\s*)(.+)$/i);
  if (m) return m[1].trim();
  // "Section 2 is violated." ends a sentence that wrapped; only a title-like rest is a heading.
  m = line.match(/^(?:chapter|section|part|topic|week|lecture)\s+\d+[.:)\-–]?\s+(.+)$/i);
  if (m && titleLike(m[1], 12)) return unshout(m[1].trim());
  // Appendices keep their label: "Appendix II: Stability proof" is how the paper refers to it.
  m = line.match(/^(appendix\s+(?:\d+|[IVX]+|[A-Z]))[.:)\-–]?\s+(.+)$/i);
  if (m && titleLike(m[2], 12)) return `${unshout(m[1])}: ${unshout(m[2].trim())}`;
  m = line.match(/^(\d+(?:\.\d+){0,2})[.)]?\s+([A-Z][^.!?]{2,80})$/);
  // Numbered list items in running prose ("2. Equations (9)-(10) are the Euler equations of") and
  // wrapped maths ("2 KE2, E = 1") aren't headings.
  if (m && titleLike(m[2], 9)) return unshout(m[2].trim());
  const caps = line.replace(/[*†‡]+$/, "");
  const words = caps.split(/\s+/);
  if (words.length >= 1 && words.length <= 8 && /^[A-Z0-9][A-Z0-9 &:\-/,()']+$/.test(caps) && /[A-Z]{3}/.test(caps)) {
    return titleCase(caps);
  }
  return null;
}

const TRAILING_FUNCTION_WORD = /\b(of|the|and|or|to|in|a|an|by|with|for|from|on)$/i;

/** Reads like a title rather than a sentence or a line of maths. */
function titleLike(s: string, maxWords: number): boolean {
  const t = s.trim();
  return (
    /^\p{Lu}/u.test(t) &&
    /\p{L}{3}/u.test(t) &&
    !/[.,;:=]$|[=<>≤≥]/.test(t) &&
    t.split(/\s+/).length <= maxWords &&
    !SENTENCE_WORDS.test(t) &&
    !/\(\d/.test(t) &&
    !TRAILING_FUNCTION_WORD.test(t)
  );
}

const SENTENCE_WORDS = /\b(is|are|was|were|be|been|has|have|had|can|will|we|our|this|these|which|that|it)\b/i;

/** Back matter that teaches nothing: references, funding, declarations and the like. */
export const BACK_MATTER = /^(references|bibliography|works cited|literature cited|acknowledge?ments?|funding|declarations?( of (conflicting )?interests?)?|conflicts? of interests?|competing interests?|author(s'|'s)? contributions?|credit authorship contribution statement|data availability( statement)?|orcid( id)?s?|supplementary (material|data)|ethical approval|consent for publication)$/i;

/** Labels on a document's first page that aren't topics. */
const FRONT_LABELS = /^(lecture notes?|notes|handout|original article|research article|review article|article|abstract|keywords?|contents|table of contents|summary)$/i;

/** "Behzad Abdellahi, Fatemeh Azhari and Phu Nguyen": names joined by commas and "and". */
export function isAuthorLine(s: string): boolean {
  // Private-use glyphs are ORCID and e-mail icons.
  const t = s.replace(/[*†‡§\d\uE000-\uF8FF]/g, "").trim();
  if (!/,|\sand\s|&/i.test(t)) return false;
  const words = t.split(/[\s,&]+/).filter(Boolean);
  // "Kinematics and Primary Solution Field" is a title: names come with commas or initials.
  if (!t.includes(",") && !words.some((w) => /^\p{Lu}\.$/u.test(w))) return false;
  return words.length >= 3 && words.length <= 30 && words.every((w) => /^(and|et|al\.?|van|von|de|der|da|di|du|la|le|bin|ibn)$/i.test(w) || /^\p{Lu}[\p{L}.'-]*$/u.test(w));
}

/**
 * The sections worth studying: headings without numbering clutter, back matter (references, funding,
 * declarations) left out, and front-page labels and author lines kept only as untitled text.
 */
export function studySections(text: string): Section[] {
  const out: Section[] = [];
  splitSections(text).forEach((s, i) => {
    const h = s.heading.replace(/^(appendix\s+)?[\dIVX]+(\.\d+)*\.?\s+(?=\p{L})/u, "").trim();
    if (BACK_MATTER.test(h)) return;
    // Front matter sits before the first few headings; a closing "Summary" is a real section.
    if (s.heading && i < 5 && (FRONT_LABELS.test(h) || isAuthorLine(s.heading))) out.push({ heading: "", body: s.body });
    // Numbering is the paper's bookkeeping; the level keeps the structure it carried.
    else out.push({ ...s, heading: h });
  });
  return out;
}

/** "INTRODUCTION AND MOTIVATION" reads as "Introduction and Motivation". */
function unshout(s: string) {
  return /\p{Ll}/u.test(s) || !/\p{Lu}{4}/u.test(s) ? s : titleCase(s);
}

const SMALL_WORDS = new Set("a an and as at but by for from in of on or the to via with".split(" "));

function titleCase(s: string) {
  return s.toLowerCase().replace(/[a-z][a-z']*/g, (w, i: number) => (i > 0 && SMALL_WORDS.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
}
