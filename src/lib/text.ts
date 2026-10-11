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
}

export function splitSections(text: string): Section[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const h = headingOf(line);
    if (h) {
      if (cur) sections.push(cur);
      cur = { heading: h, body: "" };
    } else if (line) {
      if (!cur) cur = { heading: "", body: "" };
      cur.body += line + "\n";
    }
  }
  if (cur) sections.push(cur);
  return sections.filter((s) => s.heading || s.body.trim());
}

function headingOf(line: string): string | null {
  if (!line || line.length > 90) return null;
  let m = line.match(/^#{1,4}\s+(.+)$/);
  if (m) return m[1].trim();
  m = line.match(/^(?:slide\s+\d+\s*[:\-–]\s*)(.+)$/i);
  if (m) return m[1].trim();
  m = line.match(/^(?:chapter|section|part|topic|week|lecture)\s+\d+[.:)\-–]?\s+(.+)$/i);
  if (m) return m[1].trim();
  m = line.match(/^(\d+(?:\.\d+){0,2})[.)]?\s+([A-Z][^.!?]{2,80})$/);
  if (m && !/[,;]$/.test(m[2])) return m[2].trim();
  const words = line.split(/\s+/);
  if (words.length >= 1 && words.length <= 8 && /^[A-Z0-9][A-Z0-9 &:\-/,()']+$/.test(line) && /[A-Z]{3}/.test(line)) {
    return titleCase(line);
  }
  return null;
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
