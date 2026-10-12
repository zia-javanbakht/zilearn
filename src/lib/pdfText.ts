import { isWord } from "./textRepair";

/*
 * Turning a PDF's text layer into study text, page by page: lines with their font size (so headings can be
 * marked), running headers and footers removed, maths glyphs from symbol fonts put back, and a check of
 * whether the layer is worth trusting at all (a bad OCR layer from a scanner) or holds maths it can't
 * carry (display equations flattened onto separate lines). Pure functions apart from pdfLines.
 */

export interface PdfLine {
  text: string;
  /** Largest font size on the line, in points. */
  size: number;
}

type Pdf = { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> };

/** Each page's lines as pdf.js gives them (the same text unpdf's extractText makes), with font sizes. */
export async function pdfLines(pdf: Pdf): Promise<PdfLine[][]> {
  const pages: PdfLine[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    const lines: PdfLine[] = [];
    let cur: PdfLine = { text: "", size: 0 };
    for (const it of items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
      if (it.str == null) continue;
      cur.text += it.str;
      if (it.str.trim() && it.transform) cur.size = Math.max(cur.size, Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10);
      if (it.hasEOL) {
        lines.push(cur);
        cur = { text: "", size: 0 };
      }
    }
    if (cur.text) lines.push(cur);
    pages.push(lines);
  }
  return pages;
}

/* ---------------- Running headers and footers ---------------- */

const PAGE_NUMBER = /^\s*(?:page\s*)?(?:\d{1,5}|(?=[ivxlc])x{0,3}(?:ix|iv|v?i{0,3}))(?:\s*(?:\/|of)\s*\d{1,5})?\s*$/i;
const EDGE = 3;

/** A line's identity across pages: letters only, with OCR's usual confusions folded, so page numbers and misreadings ("SlMO", "RIFAl") don't matter. */
function edgeKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/[l1|!]/g, "i")
    .replace(/0/g, "o")
    .replace(/rn/g, "m")
    .replace(/[^a-z\u00e0-\u024f\u0370-\u03ff]/g, "");
}

/** Edit distance, stopping early once it passes `max`. */
function near(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * Lines at the top or bottom of pages that repeat on many pages (journal names, author running heads,
 * "Dr. X, University, date. 3 / 29"), and bare page numbers there. Returns, per page, the indexes to drop.
 */
export function runningLines(pages: string[][]): Set<number>[] {
  const drop = pages.map(() => new Set<number>());
  const edges = pages.map((lines) => {
    const idx = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim());
    return [...idx.slice(0, EDGE), ...idx.slice(Math.max(EDGE, idx.length - EDGE))].map(([l, i]) => ({ l, i, k: edgeKey(l) }));
  });
  // Odd and even pages often carry different heads, so a quarter of the pages is enough.
  const min = Math.max(3, Math.ceil(pages.length * 0.25));
  const all = edges.flatMap((e, p) => e.filter((x) => x.k.length >= 4).map((x) => ({ ...x, p })));
  edges.forEach((e, p) => {
    for (const x of e) {
      if (pages.length >= 4 && x.k.length >= 4) {
        const slack = Math.floor(x.k.length / 10);
        const on = new Set(all.filter((y) => y.k === x.k || (slack && near(x.k, y.k, slack))).map((y) => y.p));
        if (on.size >= min) {
          drop[p].add(x.i);
          continue;
        }
      }
      if (PAGE_NUMBER.test(x.l)) drop[p].add(x.i);
    }
  });
  return drop;
}

/** Publisher furniture on a first page: article type, journal volume, DOI, copyright, reuse notices, emails. */
export function isPublisherLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 160) return false;
  return (
    /^(original|research|review|technical|short)?\s*(article|paper|communication)$/i.test(t) ||
    /check for updates|article reuse guidelines|journals-permissions|journals\.sagepub|sciencedirect\.com|elsevier\.com\/locate|wileyonlinelibrary|tandfonline\.com|springer\.com|all rights reserved|orcid\.org|^orcid id/i.test(t) ||
    /^(doi:?\s*)?(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,}\/\S+$/i.test(t) ||
    /^doi:/i.test(t) ||
    /^(©|\(c\)|copyright\b)/i.test(t) ||
    /^(\d{4},?\s*)?vol(\.|ume)?\s*\d+/i.test(t) ||
    /^(received|accepted|revised|published online)\b.*\d{4}/i.test(t) ||
    /^(corresponding author|e-?mail)\b/i.test(t) ||
    /^\S+@\S+\.\w+$/.test(t)
  );
}

/* ---------------- Maths glyphs from symbol fonts ---------------- */

/**
 * TeX's big delimiters (the cmex font) come out as control characters: their slot numbers. Sage and
 * Elsevier's MathPi fonts put =, +, ( and ) in the slots of ¼, þ, ð and Þ, and the minus sign in 0x01.
 */
const CMEX: Record<string, string> = {
  "\u0000": "(", "\u0001": ")", "\u0002": "[", "\u0003": "]", "\u0004": "⌊", "\u0005": "⌋", "\u0006": "⌈", "\u0007": "⌉",
  "\u0008": "{", "\u0009": "}", "\u000a": "⟨", "\u000b": "⟩", "\u000c": "|", "\u000d": "‖", "\u000e": "/", "\u000f": "\\",
  "\u0010": "(", "\u0011": ")", "\u0012": "(", "\u0013": ")", "\u0014": "[", "\u0015": "]", "\u0016": "⌊", "\u0017": "⌋",
  "\u0018": "⌈", "\u0019": "⌉", "\u001a": "{", "\u001b": "}", "\u001c": "⟨", "\u001d": "⟩", "\u001e": "/", "\u001f": "\\",
};
const MATHPI: Record<string, string> = { "¼": "=", "þ": "+", "ð": "(", "Þ": ")", "\u0001": "−", "\u0007": "(", "\u0008": ")" };

export interface GlyphReport {
  mathpi: boolean;
  controls: number;
  integrals: number;
}

/** Whether a document shows MathPi's substitutions: several "¼" for "=", or "ð…Þ" pairs. */
export function usesMathPi(text: string): boolean {
  const eq = (text.match(/\s¼\s/g) ?? []).length;
  const pairs = (text.match(/ð[^ðÞ\n]{0,40}Þ/g) ?? []).length;
  return eq >= 3 || pairs >= 2;
}

/**
 * Put maths glyphs back: MathPi's symbols (when the document shows them), cmex delimiters, and the
 * cmex integral, which comes out as a lone "Z" with its limits on the next line ("Z\nB0" is ∫ over B0).
 * Other control characters are dropped.
 */
export function fixMathGlyphs(text: string, mathpi = usesMathPi(text)): { text: string; report: GlyphReport } {
  const report: GlyphReport = { mathpi, controls: 0, integrals: 0 };
  // The integral: "Z" alone at a line end (or alone on a line), its domain alone on the next line.
  const lone = (text.match(/(?:^|[ =(])Z\n[^\s]{1,6}\n/gm) ?? []).length;
  if (lone >= 2)
    text = text.replace(/(^|[ =(])Z\n([^\s]{1,6})\n/gm, (_m, pre: string, dom: string) => {
      report.integrals++;
      return `${pre}∫_${dom.length > 1 ? `{${dom}}` : dom} `;
    });
  text = text.replace(/[\u0000-\u0008\u000b\u000e-\u001f¼þðÞ]/g, (c) => {
    if (mathpi && MATHPI[c]) {
      if (c < " ") report.controls++;
      return MATHPI[c];
    }
    if (c >= " ") return c;
    report.controls++;
    return CMEX[c] ?? "";
  });
  return { text, report };
}

/* ---------------- Headings ---------------- */

/** The size most of the text is set in (by characters). */
export function bodySize(pages: PdfLine[][]): number {
  const count = new Map<number, number>();
  for (const l of pages.flat()) if (l.size) count.set(l.size, (count.get(l.size) ?? 0) + l.text.trim().length);
  let best = 0;
  let most = -1;
  for (const [s, n] of count) if (n > most) [best, most] = [s, n];
  return best;
}

/**
 * A line set larger than the body text that reads like a title: short, with letters, not a sentence
 * running on, not a formula. Returns its Markdown level (2 for the largest sizes, 3 below), or 0.
 */
export function headingLevel(line: PdfLine, body: number, sizes: number[]): number {
  const t = line.text.trim();
  if (!body || line.size < body * 1.12 || t.length < 3 || t.length > 110) return 0;
  if (!/[A-Za-z]{3}/.test(t) || /[.,;:]$/.test(t) || /[=<>≤≥∑∫]/.test(t) || PAGE_NUMBER.test(t)) return 0;
  if (t.split(/\s+/).length > 14 || /^[a-z]/.test(t) || /\b(of|the|and|to|in|a|an|by|with|for|from|on)$/i.test(t)) return 0;
  return sizes.length > 1 && line.size >= sizes[sizes.length - 1] * 0.98 && line.size < sizes[0] ? 3 : 2;
}

/**
 * Pages of text from the lines: running heads and page numbers dropped, headings marked with "##" or
 * "###" (by size, except on pages with an OCR layer). Maths glyphs are left for fixMathGlyphs, after ligature repair has read its slots.
 */
export function pagesFromLines(pages: PdfLine[][], opts: { ocrPages?: ReadonlySet<number> } = {}): { pages: string[]; running: number } {
  const drop = runningLines(pages.map((p) => p.map((l) => l.text)));
  const body = bodySize(pages);
  // Heading sizes, largest first; the title on page 1 is usually the largest, so it gets level 2 too.
  const sizes = [...new Set(pages.flat().filter((l) => l.size >= body * 1.12 && l.text.trim().length >= 3).map((l) => l.size))].sort((a, b) => b - a);
  let running = 0;
  const texts = pages.map((lines, p) => {
    const out: { text: string; level: number; size: number }[] = [];
    lines.forEach((l, i) => {
      if (drop[p].has(i) || (p === 0 && (i < 25 || i >= lines.length - 12) && isPublisherLine(l.text))) {
        running++;
        return;
      }
      // An OCR layer's sizes follow the scanned glyphs, not the document's styles.
      const level = opts.ocrPages?.has(p + 1) ? 0 : headingLevel(l, body, sizes);
      const last = out[out.length - 1];
      // A title set over several lines is one heading, including lines that start in lower case
      // ("Prediction of the failure" / "behavior of pseudo-ductile" / …).
      // A new capitalised line at the same size is the next heading ("Finite element model" then
      // "Generation of the RVE"), except in the title on page 1 or after a dangling "of", "and", "-".
      const same = last?.level && last.size === l.size && last.text.length < 200 && /\p{L}/u.test(l.text) && !/[.;:]$/.test(last.text);
      const joins = /^\p{Ll}/u.test(l.text.trim()) || /(\b(of|the|and|or|to|in|a|an|by|with|for|from|on)|-)$/i.test(last?.text ?? "") || (p === 0 && l.size >= sizes[0] * 0.98);
      if (same && (level === last.level || !level) && joins) last.text += ` ${l.text.trim()}`;
      else out.push({ text: level ? l.text.trim() : l.text, level, size: l.size });
    });
    return out
      .map((x) => (x.level ? `${"#".repeat(x.level)} ${x.text}` : x.text))
      .join("\n")
      .trim();
  });
  return { pages: texts, running };
}

/* ---------------- How trustworthy a page's text is ---------------- */

export interface PageQuality {
  /** Letters spaced out as separate words ("A N D", "m a k e"), per 100 words. */
  spaced: number;
  /** Share of lowercase words (4+ letters) that are neither English nor used elsewhere in the document. */
  garbled: number;
  /** How many such words; a short page of technical terms has a high share but few of them. */
  odd: number;
  words: number;
}

/** How often each lowercase word occurs in the whole document, so technical terms count as words. */
export function wordCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of text.match(/\b[a-z]{4,}\b/g) ?? []) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

export function pageQuality(text: string, counts = wordCounts(text)): PageQuality {
  const tokens = text.match(/[A-Za-z]+/g) ?? [];
  const runs = (text.match(/(?:\b[A-Za-z] ){2,}[A-Za-z]\b/g) ?? []).length;
  // OCR misreadings ("srrain", "nslrs", "Jinite") are one-offs; technical terms repeat.
  const lower = text.match(/\b[a-z]{4,}\b/g) ?? [];
  const bad = lower.filter((w) => !isWord(w) && (counts.get(w) ?? 0) < 2).length;
  const words = tokens.length;
  return { spaced: words ? (runs * 100) / words : 0, garbled: lower.length ? bad / lower.length : 0, odd: bad, words };
}

/**
 * Whether a page's text is too damaged to teach from. An OCR layer (text guessed from a scan) is judged
 * strictly, since a few split or misread words mean its equations are lost too.
 */
export function isPoor(q: PageQuality, ocrLayer: boolean): boolean {
  if (q.words < 30) return false;
  return ocrLayer ? q.spaced >= 0.5 || (q.garbled >= 0.04 && q.odd >= 4) : q.spaced >= 3 && q.garbled >= 0.1;
}

/** Software that writes OCR layers over scans; their text can't be trusted for maths. */
export const OCR_PRODUCER = /paper capture|capture|scan|abbyy|finereader|omnipage|readiris|tesseract|ocr|kofax|xerox|canon|ricoh|kodak|fujitsu|digital sender|imagerunner|hp digital/i;

/**
 * A page whose maths the text layer can't carry: a numbered display equation, or lines that are mostly
 * symbols and single letters (fractions and sub/superscripts split onto lines of their own).
 */
export function mathsHeavy(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) return false;
  // The number may end the equation's line or sit on a line of its own after it.
  const numbered = lines.filter((l) => /(?:\S\s*|^\s*)\(\d{1,3}[a-z]?\)\s*$/.test(l) && !/[a-z]{4,}[.,]?\s*\(\d{1,3}\)\s*$/.test(l)).length;
  const scraps = lines.filter((l) => {
    const t = l.trim();
    if (t.length > 25) return false;
    const letters = (t.match(/[A-Za-z]{3,}/g) ?? []).length;
    return letters <= 1 && /[=+−\-−∫∑∂∇·×/^_()[\]{}|0-9α-ωΑ-Ω]/.test(t);
  }).length;
  // One numbered equation is enough: its sub- and superscripts, bars and fractions are lost all the same.
  return numbered >= 1 || scraps >= 6;
}
