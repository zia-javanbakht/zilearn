import { ENGLISH_WORDS } from "./englishWords";
import { COLLIDING_PAIRS, COLLIDING_WORDS, LIGATURE_WORDS } from "./ligatureWords";
import { stem, tokenize } from "./text";

/**
 * Repairs the damage PDF text extraction and OCR do to words. PDF fonts often draw ff, fi, fl, ffi
 * and ffl as one glyph (a ligature); without a proper Unicode map that glyph comes out as nothing
 * ("eect"), a space ("e ect"), a stray character ("e\uFFFDect") or a separate piece ("e ff ect").
 * Words hyphenated at a line end arrive split ("differ-\nent"), and OCR confuses letter shapes
 * ("rn" for "m"). Fixes are checked against a list of English words with these letter pairs plus
 * the document's own spelling, and a fix that could turn a real word into another ("at" -> "flat")
 * is never made unless the text shows a trace of the ligature.
 */

export interface RepairReport {
  ligatures: number;
  hyphens: number;
  spaced: number;
  ocr: number;
  examples: string[];
}

export interface RepairOptions {
  /** OCR output: also undo letter-shape confusions ("rn" read for "m", "1" for "l"). */
  ocr?: boolean;
  /** Text whose spelling counts as evidence (e.g. a whole material when repairing one key term). */
  context?: string;
}

const LIGS = ["ffi", "ffl", "ff", "fi", "fl"];
const CODEPOINTS: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
  // Apple's private-use slots for fi and fl.
  "\uF001": "fi",
  "\uF002": "fl",
};
// Old TeX font encodings keep ligatures in control-character slots: OT1 at 0x0B-0x0F, T1 at 0x1B-0x1F.
const SLOTS: Record<string, string> = {
  "\x0B": "ff",
  "\x0C": "fi",
  "\x0D": "fl",
  "\x0E": "ffi",
  "\x0F": "ffl",
  "\x1B": "ff",
  "\x1C": "fi",
  "\x1D": "fl",
  "\x1E": "ffi",
  "\x1F": "ffl",
};
const MARKER = "[\\uFFFD\\uE000-\\uF8FF\\x0B-\\x0F\\x1B-\\x1F]";
// Prefixes that keep their hyphen when a line break falls after them ("self-\nadjoint" is "self-adjoint").
const KEEP_HYPHEN = new Set("self well non ill all half cross high low long short full semi quasi pre post anti multi first second third two three one time state".split(" "));
const SPACED_CAPS = new Set(["AND", "THE", "FOR", "ARE", "NOT", "BUT", "ITS"]);
// Real two-letter words: anything else of that length ("de", "ne") is a fragment, not a word.
const SHORT_WORDS = new Set("a i am an as at be by do go he if in is it me my no of on or so to up us we ok ah oh ox".split(" "));

let english: Set<string> | null = null;
/** A common English word (two-letter ones from a short list, as most two-letter strings are fragments). */
export function isWord(w: string): boolean {
  if (w.length <= 2) return SHORT_WORDS.has(w);
  return (english ??= new Set(ENGLISH_WORDS.split(" "))).has(w);
}

let builtin: { words: Set<string>; colliding: Set<string>; pairs: Set<string> } | null = null;
function lists() {
  return (builtin ??= {
    words: new Set(LIGATURE_WORDS.split(" ")),
    colliding: new Set(COLLIDING_WORDS.split(" ")),
    pairs: new Set(COLLIDING_PAIRS.split(" ").map((p) => p.replace("_", " "))),
  });
}

const hasLig = (w: string) => /ff|fi|fl/.test(w);
const isCapitalised = (w: string) => /^[A-Z][a-z]*$/.test(w);
const isPlain = (w: string) => /^[A-Za-z][a-z]*$/.test(w);
/** Copy the capital of the first letter, if any. */
const likeCase = (orig: string, fixed: string) => (/^[A-Z]/.test(orig) ? fixed[0].toUpperCase() + fixed.slice(1) : fixed);

interface Vocab {
  has(w: string): boolean;
  /** A common word (not slang or a name), safe to restore with no trace in the text. */
  common(w: string): boolean;
  /** Seen intact in the document. */
  inDoc(w: string): boolean;
}

function vocabOf(text: string): Vocab {
  const doc = new Map<string, number>();
  for (const w of text.toLowerCase().match(/(?<![\w.@/#-])[a-z]{5,}(?![\w@/#-])/g) ?? []) if (hasLig(w)) doc.set(w, (doc.get(w) ?? 0) + 1);
  for (const [w, n] of doc) if (n < 2) doc.delete(w);
  const { words } = lists();
  return { has: (w) => words.has(w) || doc.has(w), common: (w) => words.has(w) && isWord(w), inDoc: (w) => doc.has(w) };
}

function normalise(text: string) {
  return text
    .replace(/[\uFB00-\uFB06\uF001\uF002]/g, (c) => CODEPOINTS[c])
    .replace(/\u00AD[ \t]*\r?\n[ \t]*/g, "\u00AD") // a soft hyphen at a line end only marks a break inside the word
    .replace(/[\u00AD\u200B\u2060\uFEFF]|(?<=[A-Za-z])[\u200C\u200D](?=[A-Za-z])/g, "") // joiners elsewhere hold emoji together
    .replace(/\u00A0/g, " ");
}

export function repairText(input: string, opts: RepairOptions = {}): { text: string; report: RepairReport } {
  const report: RepairReport = { ligatures: 0, hyphens: 0, spaced: 0, ocr: 0, examples: [] };
  const note = (from: string, to: string) => {
    if (report.examples.length < 8 && !report.examples.some((e) => e.startsWith(`"${from}"`))) report.examples.push(`"${from}" → "${to}"`);
  };
  let text = normalise(input);
  const vocab = vocabOf(opts.context ? `${normalise(opts.context)}\n${text}` : text);

  // 1. A stray character where the ligature was: pick the ligature that makes a word.
  text = text.replace(new RegExp(`([A-Za-z]*)(${MARKER})([A-Za-z]*)`, "g"), (all, a: string, mark: string, b: string) => {
    if (!a && !b) return all;
    const order = SLOTS[mark] ? [SLOTS[mark], ...LIGS.filter((l) => l !== SLOTS[mark])] : LIGS;
    // Without a word to confirm it, only a slot between two lowercase letters is trusted ("\f" before "The" is a page break).
    const lig = order.find((l) => vocab.has(`${a}${l}${b}`.toLowerCase())) ?? (SLOTS[mark] && /[a-z]$/.test(a) && /^[a-z]/.test(b) ? SLOTS[mark] : null);
    if (!lig) return all;
    report.ligatures++;
    note(`${a}?${b}`, a + lig + b);
    return a + lig + b;
  });
  // Broken Type 1 fonts sometimes print "!" or '"' for the glyph: only fixed when that makes a known word.
  text = text.replace(/\b([A-Za-z]+)([!"#])([a-z]+)\b/g, (all, a: string, _m: string, b: string) => {
    const lig = LIGS.find((l) => vocab.has(`${a}${l}${b}`.toLowerCase()));
    if (!lig) return all;
    report.ligatures++;
    note(all, a + lig + b);
    return a + lig + b;
  });

  // 2. Words hyphenated across a line break. The whole word moves up to the first line.
  const whole = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  const compounds = new Set(text.toLowerCase().match(/[a-z]+-[a-z]+/g) ?? []);
  text = text.replace(/([A-Za-z]{2,})-[ \t]*\r?\n[ \t]*([a-z]{2,})(\S*)[ \t]*/g, (_all, a: string, b: string, rest: string, at: number, s: string) => {
    report.hyphens++;
    const lower = `${a}${b}`.toLowerCase();
    const keep = !whole.has(lower) && !vocab.has(lower) && (compounds.has(`${a}-${b}`.toLowerCase()) || KEEP_HYPHEN.has(a.toLowerCase()));
    const next = s[at + _all.length];
    return `${keep ? `${a}-${b}` : a + b}${rest}${next === undefined || next === "\n" || next === "\r" ? "" : "\n"}`;
  });

  // 3. Ligatures lost or split off: "e ect", "e ff ect", "signi ficant", "eect".
  text = fixLigatureWords(text, vocab, report, note);

  // 4. Letter-spaced words ("S u m m a r y") when the word occurs intact elsewhere.
  const intact = new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  text = text.replace(/\b(?:[A-Za-z] ){3,}[A-Za-z]\b/g, (all) => {
    const joined = all.replace(/ /g, "");
    if (!intact.has(joined.toLowerCase()) && !vocab.has(joined.toLowerCase())) return all;
    report.spaced++;
    note(all, joined);
    return joined;
  });

  // Short capitals spaced out in a title ("METHODS A N D THE"): only the common little words.
  text = text.replace(/\b([A-Z]) ([A-Z]) ([A-Z])\b/g, (all, a: string, b: string, c: string) => {
    const joined = a + b + c;
    if (!SPACED_CAPS.has(joined)) return all;
    report.spaced++;
    note(all, joined);
    return joined;
  });

  // 5. OCR letter-shape confusions, judged by the document's own majority spelling.
  // Only a rare non-word next to a frequent spelling is changed, so a born-digital text is safe too:
  // a PDF's own text layer may be an old scan's OCR.
  text = fixOcrShapes(text, opts.context, report, note);
  return { text, report };
}

/** Repair one short string (a key term, a title) using a material's text as evidence. */
export function repairTerm(term: string, context: string): string {
  return repairText(term, { context }).text.replace(/\s+/g, " ").trim();
}

function fixLigatureWords(text: string, vocab: Vocab, report: RepairReport, note: (a: string, b: string) => void): string {
  const { colliding, pairs } = lists();
  const parts = text.split(/([A-Za-z]+)/); // odd indexes are words, even ones what lies between
  const word = (i: number) => (i < parts.length ? parts[i] : "");
  const merge = (i: number, upto: number, fixed: string) => {
    note(parts.slice(i, upto + 1).join(""), fixed);
    report.ligatures++;
    parts[i] = fixed;
    for (let k = i + 1; k <= upto; k++) parts[k] = "";
  };
  // Only words in running prose: not code, paths, URLs or contractions ("fs.readFile", "you're", "hi-res").
  const before = (i: number) => /(^|\s)["“‘(\[]?$/.test(parts[i - 1]);
  const after = (i: number) => i + 1 >= parts.length - 1 || /^[.,;:!?)\]"”’]*\s/.test(parts[i + 1]);
  // Two real words side by side are left alone: "bug fix", "file system".
  const bothReal = (a: string, b: string) => (isWord(a) && isWord(b)) || pairs.has(`${a} ${b}`);

  const lost: { i: number; fixed: string }[] = [];
  const guesses = new Map<string, string | null>();
  for (let i = 1; i < parts.length; i += 2) {
    const w0 = parts[i];
    if (!w0 || !isPlain(w0) || !before(i)) continue;
    const l0 = w0.toLowerCase();
    // "the", "and", "for" never lose a piece to a ligature: "the fi rst" is "the first", not "thefirst".
    if (l0.length >= 3 && tokenize(l0).length === 0) continue;
    const w1 = word(i + 2);
    const l1 = w1.toLowerCase();
    if (word(i + 1) === " " && w1 && isPlain(w1) && !isCapitalised(w1)) {
      // "e ff ect", "de fi ne"
      const w2 = word(i + 4);
      const l2 = w2.toLowerCase();
      if (LIGS.includes(l1) && word(i + 3) === " " && w2 && isPlain(w2) && !isCapitalised(w2) && after(i + 4) && vocab.has(l0 + l1 + l2) && !bothReal(l0, l2)) {
        merge(i, i + 4, likeCase(w0, l0 + l1 + l2));
        continue;
      }
      if (after(i + 2) && !bothReal(l0, l1)) {
        // "signi ficant", "signifi cant", "fi rst": the break touches a ligature.
        const joined = l0 + l1;
        // A real word on the side holding the ligature means two words ("backstory field"), not one.
        const split = LIGS.some((l) => (l0.endsWith(l) && !(isWord(l0) && l1.length >= 3)) || (l1.startsWith(l) && !(isWord(l1) && l0.length >= 3)));
        if (vocab.has(joined) && split) {
          merge(i, i + 2, likeCase(w0, joined));
          continue;
        }
        // "e ect", "di erent", "o ce": the ligature became the space. Two lone letters ("e e") are
        // more likely maths than a word.
        const fits = l0.length + l1.length < 3 ? [] : LIGS.map((l) => l0 + l + l1).filter((c) => vocab.has(c));
        const pick = fits.find((c) => vocab.inDoc(c)) ?? (fits.length === 1 ? fits[0] : null);
        if (pick) {
          merge(i, i + 2, likeCase(w0, pick));
          continue;
        }
      }
    }
    // "eect", "rst", "dierent"; OCR also drops one f of a pair ("eficient").
    if (l0.length >= 2 && after(i) && !isWord(l0) && !vocab.has(l0) && !colliding.has(l0)) {
      if (!guesses.has(l0)) {
        const fits = new Set<string>();
        for (let p = 0; p <= l0.length; p++) {
          for (const l of LIGS) fits.add(l0.slice(0, p) + l + l0.slice(p));
          if (l0[p] === "f" || l0[p - 1] === "f") fits.add(l0.slice(0, p) + "f" + l0.slice(p));
        }
        // Two-letter pieces ("fs", "tr") are too often something else; their word must be in the document.
        const ok = [...fits].filter((c) => (vocab.inDoc(c) || (l0.length >= 3 && vocab.common(c))));
        guesses.set(l0, ok.find((c) => vocab.inDoc(c)) ?? (ok.length === 1 ? ok[0] : null));
      }
      const pick = guesses.get(l0);
      if (pick) lost.push({ i, fixed: likeCase(w0, pick) });
    }
  }
  // A silent loss leaves no trace, so it needs the document to show the damage: repairs with a
  // trace above, or several different words that only make sense with their ligature back.
  // About 1% of English words hold ff, fi or fl, so systematic loss shows up as at least 1 in 500 words.
  const distinct = new Set(lost.map((x) => x.fixed.toLowerCase())).size;
  const words = (parts.length - 1) / 2;
  if (report.ligatures >= Math.max(2, words / 1000) || (distinct >= 3 && lost.length >= words / 500)) for (const x of lost) merge(x.i, x.i, x.fixed);
  return parts.join("");
}

const SHAPES: [RegExp, string][] = [
  [/rn/g, "m"],
  [/m/g, "rn"],
  [/cl/g, "d"],
  [/d/g, "cl"],
  [/vv/g, "w"],
  [/li/g, "h"],
  [/1/g, "l"],
  [/0/g, "o"],
  [/5/g, "s"],
  // Scans of old journals: "Jinite", "Jield" for "finite", "field"; "Finany" for "Finally".
  [/j/g, "f"],
  [/n/g, "ll"],
];

/** A rare spelling one OCR confusion away from a frequent one is the frequent one misread. */
function fixOcrShapes(text: string, context: string | undefined, report: RepairReport, note: (a: string, b: string) => void): string {
  const counts = new Map<string, number>();
  for (const w of `${context ?? ""}\n${text}`.toLowerCase().match(/[a-z0-9]+/g) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  const fixes = new Map<string, string>();
  for (const [w, n] of counts) {
    if (n > 5 || w.length < 4 || (w.match(/[a-z]/g) ?? []).length < 3 || isWord(w)) continue;
    let best: { v: string; n: number } | null = null;
    for (const [re, to] of SHAPES) {
      for (const m of w.matchAll(new RegExp(re.source, "g"))) {
        const v = w.slice(0, m.index) + to + w.slice(m.index! + m[0].length);
        const vn = counts.get(v) ?? 0;
        if (vn >= 3 && vn >= 3 * n && (!best || vn > best.n)) best = { v, n: vn };
      }
    }
    if (best) fixes.set(w, best.v);
  }
  if (!fixes.size) return text;
  return text.replace(/\b[A-Za-z0-9]+\b/g, (w) => {
    const to = fixes.get(w.toLowerCase());
    if (!to) return w;
    report.ocr++;
    // A capital J misread for f keeps the word's own case ("Jield" is "field").
    const fixed = /^J[a-z]/.test(w) && to[0] === "f" ? to : likeCase(w, to);
    note(w, fixed);
    return fixed;
  });
}

/** One sentence for a material's note about what was repaired, or null when nothing was. */
export function repairNote(r: RepairReport): string | null {
  const bits: string[] = [];
  if (r.ligatures) bits.push(`${r.ligatures} word${r.ligatures === 1 ? "" : "s"} broken at ff/fi/fl`);
  if (r.ocr) bits.push(`${r.ocr} OCR misreading${r.ocr === 1 ? "" : "s"}`);
  if (r.spaced) bits.push(`${r.spaced} letter-spaced word${r.spaced === 1 ? "" : "s"}`);
  if (!bits.length) return null;
  const eg = r.examples.slice(0, 2).join(", ");
  return `Repaired ${bits.join(", ")}${eg ? ` (e.g. ${eg})` : ""}.`;
}

/* ---------------- Key terms ---------------- */

const FILLER = new Set("the a an of and or for to in on with by from at as is are this that these those its their".split(" "));

/** Damage left in a word: a stray glyph, digits mixed into letters, or a lone ligature fragment. */
export function looksBroken(w: string): boolean {
  // Digits OCR reads for letters (0, 1, 5) inside a word: "c1ass", "0ptimal". "H2O" and "MP3" are fine.
  return new RegExp(MARKER).test(w) || /[a-z]{2,}[015][a-z]|[a-z][015][a-z]{2,}|^[015][a-z]{3,}/i.test(w) || /^(ff|fi|fl|ffi|ffl)$/i.test(w);
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Check key terms against the text they came from: repair ligature damage, respell a word the text
 * spells differently (the text's frequent spelling wins), drop fragments and terms the text never
 * mentions, and merge duplicates. `strict` (offline terms) needs every word in the text; terms an AI
 * wrote may paraphrase, so half is enough.
 */
export function checkKeywords(keywords: string[], text: string, opts: { strict?: boolean; max?: number } = {}): string[] {
  const counts = new Map<string, number>();
  for (const w of normalise(text).toLowerCase().match(/[a-z][a-z'-]*[a-z]|[a-z]/g) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  const stems = new Set([...counts.keys()].map(stem));
  const frequent = [...counts].filter(([w, n]) => n >= 2 && w.length >= 4).map(([w]) => w);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of keywords) {
    let term = repairTerm(raw.replace(/^[\s"'“”‘’•*\-–—:;,.]+|[\s"'“”‘’•*\-–—:;,.]+$/g, ""), text);
    if (!term || term.length > 60 || !/[A-Za-z]/.test(term) || new RegExp(MARKER).test(term)) continue;
    // Respell words the text doesn't contain but nearly does ("Lagrangain" -> "Lagrangian").
    term = term.replace(/[A-Za-z][a-z]{3,}/g, (w) => {
      const l = w.toLowerCase();
      if (counts.has(l) || stems.has(stem(l))) return w;
      const max = l.length >= 8 ? 2 : 1;
      let best: { w: string; d: number; n: number } | null = null;
      for (const f of frequent) {
        if (f[0] !== l[0]) continue;
        const d = editDistance(l, f, max);
        if (d <= max && (!best || d < best.d || (d === best.d && counts.get(f)! > best.n))) best = { w: f, d, n: counts.get(f)! };
      }
      return best ? likeCase(w, best.w) : w;
    });
    const words = tokenize(term).filter((w) => !FILLER.has(w));
    if (!words.length || words.some(looksBroken) || words.every((w) => w.length < 3)) continue;
    const found = words.filter((w) => stems.has(stem(w)) || counts.has(w)).length;
    if (opts.strict ? found < words.length : found * 2 < words.length) continue;
    const key = words.map(stem).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= (opts.max ?? 12)) break;
  }
  return out;
}

/** A sentence still full of extraction damage: not fit to quote in a summary. */
export function isGarbled(sentence: string): boolean {
  const words = sentence.match(/\S+/g) ?? [];
  if (!words.length) return true;
  if (new RegExp(MARKER).test(sentence)) return true;
  // Runs of one- and two-letter pieces ("e ect o ce") or many words with digits inside them.
  if (/\b(?:[a-z]{1,2} ){3,}/.test(sentence.replace(/\b(a|i|am|an|as|at|be|by|do|go|he|if|in|is|it|me|my|no|of|on|or|so|to|up|us|we)\b/gi, "W"))) return true;
  const odd = words.filter((w) => looksBroken(w.replace(/[^\w]/g, ""))).length;
  return odd / words.length > 0.15;
}
