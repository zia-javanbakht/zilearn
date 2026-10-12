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

  return (heading: string) => {
    let h = heading.replace(/\b(appendix|problem|part|example|chapter|section)\s+(1{1,3})\b/gi, (m, label: string, ones: string) => (roman.has(label.toLowerCase()) ? `${label} ${"I".repeat(ones.length)}` : m));
    // A word split by a stray space: join when the joined word is known and a half isn't.
    h = h.replace(/\b([A-Za-z]{2,})\s+([a-z]{2,})\b/g, (m, a: string, b: string) => {
      const joined = (a + b).toLowerCase();
      return known(joined) && (!known(a.toLowerCase()) || !known(b.toLowerCase())) ? a + b : m;
    });
    return h.replace(/[A-Za-z0-9]+/g, (w, at: number) => mendWord(w, at === 0));
  };
}
