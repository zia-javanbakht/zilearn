import { wordCounts } from "./pdfText";
import { isWord } from "./textRepair";

/**
 * OCR slips in a document's headings, mended with the document itself as evidence: words split by a
 * stray space ("Axis ymmetric"), letters read as their look-alikes ("Jinite" for "finite",
 * "viscoplusticity"), and roman numerals read as ones ("Appendix 111", "Model Problem 11") when the
 * document numbers that kind of part in roman numerals elsewhere.
 */

/** Look-alike letters an OCR engine confuses, each way round. */
const LOOKALIKE: [string, string][] = [
  ["J", "f"], ["j", "f"], ["u", "a"], ["a", "u"], ["1", "l"], ["l", "i"], ["i", "l"], ["c", "e"], ["e", "c"], ["o", "a"], ["rn", "m"], ["m", "rn"], ["0", "o"], ["5", "s"], ["h", "b"], ["b", "h"],
];

export function headingRepairer(text: string): (heading: string) => string {
  const counts = wordCounts(text.toLowerCase());
  const known = (w: string) => isWord(w) || (counts.get(w) ?? 0) >= 2;
  // Labels the document numbers in roman numerals: "Model Problem I", "Appendix II".
  const roman = new Set([...text.matchAll(/\b(appendix|problem|part|example|chapter|section)\s+([IVX]{1,4})\b/gi)].map((m) => m[1].toLowerCase()));

  const mendWord = (w: string, first: boolean): string => {
    const lower = w.toLowerCase();
    if (lower.length < 4 || !/^[a-z0-9]+$/.test(lower) || known(lower)) return w;
    for (const [from, to] of LOOKALIKE)
      for (let at = w.indexOf(from); at >= 0; at = w.indexOf(from, at + 1)) {
        const fixed = w.slice(0, at) + to + w.slice(at + from.length);
        if (!/^[A-Za-z]+$/.test(fixed) || !known(fixed.toLowerCase())) continue;
        // "Jinite" was "finite": the capital came from the misread letter, not the heading.
        if (at === 0 && from === "J") return first ? fixed[0].toUpperCase() + fixed.slice(1) : fixed;
        return at === 0 && /^[A-Z]/.test(w) ? fixed[0].toUpperCase() + fixed.slice(1) : fixed;
      }
    return w;
  };

  // Words too garbled for one slip ("Enkanwd srrainjfield"): the phrase the document uses that reads closest.
  let phrases: Map<string, string> | null = null;
  const mendPhrase = (h: string): string => {
    const words = h.split(/\s+/);
    const bad = words.map((w) => /^[A-Za-z]{4,}$/.test(w) && !known(w.toLowerCase()));
    const from = bad.indexOf(true);
    // One unknown word may be a real one the document uses once ("Derivation"); two side by side are a misread.
    if (from < 0 || !bad[from + 1]) return h;
    const to = bad.lastIndexOf(true);
    phrases ??= phrasesOf(text, known);
    // The garbled run, with a word either side of it the phrase can share.
    for (const [a, b] of [[from, to + 1], [from, to + 2], [from - 1, to + 1], [from - 1, to + 2]]) {
      if (a < 0 || b > words.length) continue;
      const run = words.slice(a, b).join("").toLowerCase();
      let best: string | null = null;
      let bestD = Math.floor(run.length * 0.3) + 1;
      for (const [flat, phrase] of phrases) {
        if (flat[0] !== run[0] || Math.abs(flat.length - run.length) > 3) continue;
        const d = distance(run, flat, bestD);
        if (d < bestD) (bestD = d), (best = phrase);
      }
      if (best) {
        const fixed = words[a] && /^[A-Z]/.test(words[a]) ? best[0].toUpperCase() + best.slice(1) : best;
        return [...words.slice(0, a), fixed, ...words.slice(b)].join(" ");
      }
    }
    return h;
  };

  return (heading: string) => {
    let h = heading.replace(/\b(appendix|problem|part|example|chapter|section)\s+(1{1,3})\b/gi, (m, label: string, ones: string) => (roman.has(label.toLowerCase()) ? `${label} ${"I".repeat(ones.length)}` : m));
    // A word split by a stray space: join when the joined word is known and a half isn't.
    h = h.replace(/\b([A-Za-z]{2,})\s+([a-z]{2,})\b/g, (m, a: string, b: string) => {
      const joined = (a + b).toLowerCase();
      return known(joined) && (!known(a.toLowerCase()) || !known(b.toLowerCase())) ? a + b : m;
    });
    h = h.replace(/[A-Za-z0-9]+/g, (w, at: number) => mendWord(w, at === 0));
    // A scan's stray space before a colon or comma ("Example I : A plane …").
    return mendPhrase(h).replace(/(\S)\s+([:;,])(?=\s)/g, "$1$2");
  };

}

/** Phrases of two to four known words the text uses at least twice, by their letters without spaces. */
function phrasesOf(text: string, known: (w: string) => boolean): Map<string, string> {
  const counts = new Map<string, number>();
  for (const line of text.toLowerCase().split(/[.\n;:,()]+/)) {
    const w = line.split(/\s+/).filter((x) => /^[a-z]+$/.test(x));
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= w.length; i++) if (w.slice(i, i + n).every(known)) counts.set(w.slice(i, i + n).join(" "), (counts.get(w.slice(i, i + n).join(" ")) ?? 0) + 1);
  }
  return new Map([...counts].filter(([, k]) => k >= 2).map(([p]) => [p.replace(/ /g, ""), p]));
}

/** Edit distance, given up once it reaches `cap`. */
function distance(a: string, b: string, cap: number): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low >= cap) return cap;
    prev = cur;
  }
  return prev[b.length];
}
