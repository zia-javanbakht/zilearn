import { isWord } from "./textRepair";

/*
 * Turning a PDF's text layer into study text, page by page: lines with their font size (so headings can be
 * marked), running headers and footers removed, maths glyphs from symbol fonts put back, and a check of
 * whether the layer is worth trusting at all (a bad OCR layer from a scanner) or holds maths it can't
 * carry (display equations flattened onto separate lines). Pure functions apart from pdfLines.
 */

export interface PdfLine {
  text: string;
  /** Largest font size of the line's text, in points (a list bullet set larger doesn't count). */
  size: number;
  /** The line started with a list bullet (a Beamer triangle, "•"), now written as "- ". */
  bullet?: boolean;
  /** Its font is italic and not bold: a journal sets its subsection titles so, at the size of its section titles. */
  italic?: boolean;
}

type Pdf = {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; getOperatorList?(): Promise<unknown>; commonObjs?: { get(id: string): unknown } }>;
};
type Item = { str?: string; transform?: number[]; width?: number; hasEOL?: boolean; fontName?: string };

const BULLETS = /^[•●⚫▪■▶►▸‣◆◦○➤✓✗]$/;

/** A line from its items: the text, its size, and a leading bullet glyph turned into "- ". */
function lineOf(items: Item[], italic: (font?: string) => boolean = () => false): PdfLine {
  const sizeOf = (it: Item) => (it.transform ? Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10 : 0);
  const text = items.filter((it) => it.str?.trim());
  // A bullet: a bullet character opening the line, or a lone glyph set larger than the word after it
  // (Beamer's triangles come out as "K" or "n" from a symbol font; "ℓ" before a "max" subscript isn't one).
  const first = text[0];
  const bullet =
    !!first &&
    text.length > 1 &&
    first.str!.trim().length === 1 &&
    (BULLETS.test(first.str!.trim()) || (sizeOf(first) > sizeOf(text[1]) * 1.1 && /^\s*\p{Lu}\p{Ll}{2,}/u.test(text[1].str!)));
  const rest = fractions(bullet ? items.slice(items.indexOf(first) + 1) : items, sizeOf);
  // Exponents: a short piece raised above the maths symbol before it ("𝑱" then "−1" a little higher is 𝑱^{−1}).
  // A raised number after a word or a full stop is a citation ("study,8"), which stays as it is, and so
  // is a raised number of two digits or more after a bracket ("(Figure A1)16").
  let str = "";
  let exp: { y: number; text: string; tail: string; x: number; base: Item | undefined; sub: string } | null = null;
  const group = (x: string) => (x.length > 1 ? `{${x}}` : x);
  const close = () => {
    if (exp) str += `${exp.sub ? `_${group(exp.sub)}` : ""}^${group(exp.text)}${exp.tail}`;
    exp = null;
  };
  // "\u0001" is a minus from a broken symbol font, put back later.
  const at = new Map<number, number>();
  for (const it of rest) if (it.str?.trim() && it.transform) at.set(Math.round(it.transform[5]), (at.get(Math.round(it.transform[5])) ?? 0) + it.str.trim().length);
  const lineBase = at.size ? [...at].sort((a, b) => b[1] - a[1])[0][0] : null;
  const SCRIPT = /^[\p{L}\p{N}+−\-′*/\u0001þ]{1,6}\s?$/u;
  rest.forEach((it, k) => {
    const t = it.str ?? "";
    const h = sizeOf(it);
    const y = it.transform?.[5] ?? 0;
    // Pieces of one exponent set separately ("−", "1") stay together.
    if (exp && t.trim() && !/^\s/.test(t) && !exp.tail && !exp.sub && Math.abs(y - exp.y) < 0.15 * h && SCRIPT.test(t)) {
      exp.text += t.trim();
      exp.tail = /\s$/.test(t) ? " " : "";
      return;
    }
    // A subscript set under the exponent, back at its x ("U" with "j+" over "i"): U_i^{j+}.
    const by = exp?.base?.transform?.[5];
    if (exp && by != null && t.trim() && SCRIPT.test(t) && h <= 0.85 * sizeOf(exp.base!) && by - y > 0.1 * h && by - y < 0.6 * sizeOf(exp.base!) && it.transform![4] <= exp.x + 0.5 * h) {
      exp.sub += t.trim();
      exp.tail = /\s$/.test(t) ? " " : exp.tail;
      return;
    }
    if (exp && t === "") return;
    if (exp && !t.trim() && exp.sub) {
      if (/\s/.test(t)) exp.tail = " ";
      return;
    }
    close();
    const prev = [...rest.slice(0, k)].reverse().find((p) => p.str?.trim());
    const before = prev?.str ?? "";
    // Raised against the symbol it follows, not the line: in a stacked fraction the line has no one baseline.
    // After a big bracket (set high, from a symbol font), against the line's baseline: "(σ11/XT)" then "2".
    const tall = !!prev && /^[\u0010-\u0017]$/.test(before.trim());
    const raised = tall && lineBase != null ? y - lineBase : prev?.transform ? y - prev.transform[5] : 0;
    const piece = t.trim();
    const smaller = !!prev && h <= 0.85 * sizeOf(prev);
    const isExp =
      h > 0 &&
      raised > 0.25 * h &&
      raised < (tall ? 2.2 : 0.8) * h &&
      /^[\p{L}\p{N}+−\-′*/]{1,6}\s?$/u.test(t) &&
      ((/[\u{1d400}-\u{1d7ff}\u0370-\u03ff\u2100-\u214f)\]\u0011\u0013\u0015]$/u.test(before) && /[\d+−\u{1d400}-\u{1d7ff}]/u.test(piece)) ||
        // Set smaller after a symbol or a capital standing for one (pdfTeX's "F" then "T": Fᵀ; "(QF)" then "T").
        (smaller && /^[\p{L}\p{N}+−′*]{1,4}$/u.test(piece) && /(?:^|[\s(=+−,⋅·])[A-Z]{1,3}\s?$|[)\]\u0370-\u03ff\u{1d400}-\u{1d7ff}]$/u.test(before))) &&
      !(/[)\]]$/.test(before) && /^\d{2,}$/.test(piece));
    // A subscript: set smaller and a little lower after a symbol ("ϵ" then "ik": ϵ_{ik}).
    const lowered = prev?.transform ? prev.transform[5] - y : 0;
    const isSub =
      !isExp && smaller && lowered > 0.1 * h && lowered < 0.6 * sizeOf(prev!) && /^[\p{L}\p{N}]{1,4}\s?$/u.test(t) && /[\u{1d400}-\u{1d7ff}\u0370-\u03ff]\s?$|(?:^|[\s(=+−,⋅·])[A-Z]\s?$/u.test(before);
    if (isExp) {
      // The exponent sits on the symbol, not after the space pdf.js put behind it.
      if (/\s$/.test(before)) str = str.replace(/\s$/, "");
      exp = { y, text: piece, tail: /\s$/.test(t) ? " " : "", x: it.transform?.[4] ?? 0, base: prev, sub: "" };
    } else if (isSub) str = `${str.replace(/\s$/, "")}_${group(piece)}${/\s$/.test(t) ? " " : ""}`;
    else str += t;
  });
  close();
  const size = Math.max(0, ...rest.filter((it) => it.str?.trim()).map(sizeOf));
  const lead = rest.find((it) => it.str?.trim());
  return { text: bullet ? `- ${str.trim()}` : str, size, ...(bullet ? { bullet } : {}), ...(lead && italic(lead.fontName) ? { italic: true } : {}) };
}

/**
 * A fraction set as a numerator raised above the line and a denominator below it ("∂Ψ" over "∂F") as one
 * piece on the baseline: "∂Ψ/∂F", or "(a + b)/(c)" when either part has spaces.
 */
function fractions(items: Item[], sizeOf: (it: Item) => number): Item[] {
  const text = items.filter((it) => it.str?.trim() && it.transform);
  if (text.length < 3) return items;
  // The baseline: the height most of the line's characters sit at.
  const at = new Map<number, number>();
  for (const it of text) at.set(Math.round(it.transform![5]), (at.get(Math.round(it.transform![5])) ?? 0) + it.str!.trim().length);
  const base = [...at].sort((a, b) => b[1] - a[1])[0][0];
  const out: Item[] = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const h = sizeOf(it);
    const dy = (x: Item) => (x.transform ? x.transform[5] - base : 0);
    if (!it.str?.trim() || !it.transform || !(dy(it) > 0.25 * h && dy(it) < 1.1 * h)) {
      out.push(it);
      continue;
    }
    // The numerator: pieces at its height; then the denominator: pieces as far below.
    let j = k;
    let num = "";
    while (j < items.length && (!items[j].str?.trim() || (items[j].transform && Math.abs(dy(items[j]) - dy(it)) < 0.15 * h))) num += items[j++].str ?? "";
    const x0 = it.transform[4];
    let den = "";
    const d0 = items[j];
    if (d0?.transform && dy(d0) < -0.25 * h && dy(d0) > -1.1 * h && d0.transform[4] >= x0 - h && sizeOf(d0) >= 0.85 * h) {
      while (j < items.length && (!items[j].str?.trim() || (items[j].transform && Math.abs(dy(items[j]) - dy(d0)) < 0.15 * h))) den += items[j++].str ?? "";
    }
    if (!num.trim() || !den.trim() || sizeOf(it) < 0.85 * Math.max(...text.map(sizeOf))) {
      out.push(it);
      continue;
    }
    const part = (x: string) => (/\s/.test(x.trim()) ? `(${x.trim()})` : x.trim());
    out.push({ ...it, str: `${part(num)}/${part(den)}`, transform: [...it.transform.slice(0, 5), base] });
    k = j - 1;
  }
  return out;
}

/**
 * Each page's lines as pdf.js gives them (the same text unpdf's extractText makes), with font sizes.
 * A jump to another height starts a new line too: pdf.js can run a slide's title into the labels of
 * the figure under it.
 */
export async function pdfLines(pdf: Pdf): Promise<PdfLine[][]> {
  const pages: PdfLine[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    // The fonts' names say which are italic ("…-Italic", "….I"); pdf.js loads them while reading the page's drawing.
    const fonts = new Map<string, boolean>();
    if (page.getOperatorList && page.commonObjs && (items as Item[]).some((it) => it.str?.trim()))
      await page.getOperatorList().catch(() => null);
    const italic = (font?: string) => {
      if (!font || !page.commonObjs) return false;
      if (!fonts.has(font)) {
        let name = "";
        try {
          name = String((page.commonObjs.get(font) as { name?: string } | null)?.name ?? "");
        } catch {
          name = "";
        }
        fonts.set(font, /(italic|oblique|[.-]I(?:t)?(?:[+.]|$)|-?It$)/i.test(name) && !/(bold|black|heavy|[.-]B(?:I)?(?:[+.]|$)|Bd)/i.test(name));
      }
      return fonts.get(font)!;
    };
    const lines: PdfLine[] = [];
    let cur: Item[] = [];
    let y: number | null = null;
    let size = 0;
    const flush = (eol = false) => {
      if (eol || cur.some((it) => it.str)) lines.push(lineOf(cur, italic));
      cur = [];
      y = null;
      size = 0;
    };
    // pdf.js ends a line after a fraction's numerator; the line goes on if its denominator comes next.
    let eol = false;
    for (const it of items as Item[]) {
      if (it.str == null) continue;
      if (it.str.trim() && it.transform) {
        const h = Math.hypot(it.transform[2], it.transform[3]);
        // Against the piece before, so a fraction's numerator after its denominator doesn't break the line,
        // nor does its denominator after its numerator (raised above the line's baseline, then set below it).
        // The baseline is where the line's first full-size piece sits; the numerator is raised above it and the
        // denominator starts under it. Full-size pieces only: a superscript over a subscript ("F" with "t" over "f") is smaller.
        const full = cur.filter((c) => c.str?.trim() && c.transform && Math.hypot(c.transform[2], c.transform[3]) >= 0.85 * size);
        const base = full[0]?.transform?.[5];
        const ny = it.transform[5];
        const numX = base == null ? undefined : full.find((c) => c.transform![5] - base > 0.25 * h)?.transform?.[4];
        const stacked =
          base != null && y != null && numX != null && h >= 0.85 * size && y - base > 0.25 * h && y - base < 1.1 * h && base - ny > 0.25 * h && base - ny < 1.1 * h && it.transform[4] >= numX - h;
        // pdf.js also ends the line after an exponent with a subscript under it still to come ("U", "j+", then "i").
        const last = [...cur].reverse().find((c) => c.str?.trim() && c.transform);
        const under =
          base != null && last?.transform != null && h <= 0.85 * size && Math.hypot(last.transform[2], last.transform[3]) <= 0.85 * size && last.transform[5] - base > 0.2 * size && base - ny > 0 && base - ny < 0.6 * size && Math.abs(it.transform[4] - last.transform[4]) < 1.5 * size;
        // A display equation's tall pieces (a big bracket, a fraction's numerator) are raised a little and go on
        // to the right of the piece before; a new line starts back at the left, or lower down.
        // Only where the line is set in a symbol font whose glyphs come out as control characters ("¼" for "="):
        // pdfTeX's cmex lines (Thompson) keep their own handling.
        const maths = /[\u0000-\u001f¼þ]/u;
        const onward =
          base != null &&
          last?.transform != null &&
          it.transform[4] >= last.transform[4] + (last.width ?? 0) - 0.5 &&
          it.str.trim().length <= 4 &&
          // cmex's big glyphs come out as letters ("Z" is ∫, "n" a brace): those are put back later, line by line.
          !/^[A-Za-z]$/.test(it.str.trim()) &&
          !/^[A-Za-z]$/.test(last.str!.trim()) &&
          ny - base < 1.6 * size &&
          ny - base > 0.25 * size &&
          cur.some((c) => maths.test(c.str ?? ""));
        if (eol && !stacked && !under && !onward) flush(true);
        else if (y != null && !stacked && !under && !onward && Math.abs(ny - y) > 1.2 * Math.max(size, h)) flush();
        eol = false;
        y = it.transform[5];
        size = Math.max(size, h);
      }
      cur.push(it);
      if (it.hasEOL) eol = true;
    }
    flush(eol);
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

/** A slide's frame counter ("3/6"). */
const FRAME_COUNTER = /^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/;

/**
 * Slide furniture that sits anywhere on the page, not just at its edges: a navigation sidebar listing
 * the sections (three or more lines in a row, each repeated at the same size on a quarter of the pages)
 * and frame counters. Returns, per page, the indexes to drop.
 */
export function repeatedBlocks(pages: PdfLine[][]): Set<number>[] {
  const drop = pages.map(() => new Set<number>());
  if (pages.length < 4) return drop;
  const min = Math.max(3, Math.ceil(pages.length * 0.25));
  const key = (l: PdfLine) => `${l.size}|${l.text.trim().replace(/\s+/g, " ").toLowerCase()}`;
  const on = new Map<string, Set<number>>();
  pages.forEach((lines, p) =>
    lines.forEach((l) => {
      if (!l.text.trim()) return;
      const k = key(l);
      if (!on.has(k)) on.set(k, new Set());
      on.get(k)!.add(p);
    }),
  );
  const often = (l: PdfLine) => (on.get(key(l))?.size ?? 0) >= min;
  pages.forEach((lines, p) => {
    let run: number[] = [];
    const end = () => {
      if (run.length >= 3) run.forEach((i) => drop[p].add(i));
      run = [];
    };
    lines.forEach((l, i) => {
      if (!l.text.trim()) return;
      if (often(l)) run.push(i);
      else end();
    });
    end();
  });
  if (pages.filter((lines) => lines.some((l) => FRAME_COUNTER.test(l.text))).length >= min)
    pages.forEach((lines, p) => lines.forEach((l, i) => FRAME_COUNTER.test(l.text) && drop[p].add(i)));
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
  accents: number;
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
  const report: GlyphReport = { mathpi, controls: 0, integrals: 0, accents: 0 };
  // The integral: "Z" alone at a line end (or alone on a line), its domain alone on the next line.
  const lone = (text.match(/(?:^|[ =(])Z\n[^\s]{1,6}\n/gm) ?? []).length;
  if (lone >= 2)
    text = text.replace(/(^|[ =(])Z\n([^\s]{1,6})\n/gm, (_m, pre: string, dom: string) => {
      report.integrals++;
      return `${pre}∫_${dom.length > 1 ? `{${dom}}` : dom} `;
    });
  // TeX sets an accent before its letter, so the text layer hangs the dot or hat on the character
  // before ("Sincė 𝑭", "𝜌̇ 𝜙"); on a maths letter it belongs to the one after ("Since 𝑭̇", "𝜌 𝜙̇").
  text = text.replace(/([\u0300-\u036f]+)([ \n]?)([\u{1d400}-\u{1d7ff}\u2100-\u214f\u0391-\u03a9\u03b1-\u03c9\u03d1\u03d5\u03f5])/gu, (_m, mark: string, gap: string, base: string) => {
    report.accents++;
    return `${gap}${base}${mark}`;
  });
  // A stacked d/dt comes out as "d" over "d𝑡" on two lines.
  text = text.replace(/(^|[\s(=:])d\n(d[\u{1d400}-\u{1d7ff}a-z])/gmu, "$1d/$2");
  // An integral's domain is set below it, which ends the line: "∫𝑆𝑝" then the integrand on the next.
  text = text.replace(/(∫\S{0,6})\n(?!\n|--- Page|#)/g, "$1 ");
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
  // A line of bold maths ("𝝈 ⋅⋅ 𝑫 d𝑣. Then") is set large but isn't a title.
  if ((t.match(/[\u{1d400}-\u{1d7ff}]/gu) ?? []).length >= 2 && (t.match(/\b[A-Za-z][a-z]{2,}\b/g) ?? []).length < 2) return 0;
  const level = sizes.length > 1 && line.size >= sizes[sizes.length - 1] * 0.98 && line.size < sizes[0] ? 3 : 2;
  // Italic at a section title's size: a subsection.
  return line.italic ? level + 1 : level;
}

/**
 * Pages of text from the lines: running heads and page numbers dropped, headings marked with "##" or
 * "###" (by size, except on pages with an OCR layer). Maths glyphs are left for fixMathGlyphs, after ligature repair has read its slots.
 */
export function pagesFromLines(pages: PdfLine[][], opts: { ocrPages?: ReadonlySet<number> } = {}): { pages: string[]; running: number } {
  const body = bodySize(pages);
  // Heading sizes, largest first; the title on page 1 is usually the largest and becomes "#".
  const sizes = [...new Set(pages.flat().filter((l) => l.size >= body * 1.12 && l.text.trim().length >= 3).map((l) => l.size))].sort((a, b) => b - a);
  const blocks = repeatedBlocks(pages);
  // Running heads are found twice: among all lines, and with the sidebar left out, where they sit at the
  // page's edge. The first never takes a heading (a frame title that repeats a sidebar entry).
  const all = runningLines(pages.map((p) => p.map((l) => l.text)));
  const drop = runningLines(pages.map((p, n) => p.map((l, i) => (blocks[n].has(i) ? "" : l.text))));
  all.forEach((a, p) => a.forEach((i) => !headingLevel(pages[p][i], body, sizes) && drop[p].add(i)));
  blocks.forEach((b, p) => b.forEach((i) => drop[p].add(i)));
  // Slides: a navigation sidebar or frame counters on a quarter of the pages.
  const deck = blocks.filter((b) => b.size).length >= Math.max(3, Math.ceil(pages.length * 0.25));
  let running = 0;
  // A book-style running head names the current section and the page: "4 Conservation of Linear Momentum 2".
  const headings = new Set(pages.flat().filter((l) => headingLevel(l, body, sizes)).map((l) => l.text.trim().replace(/\s+/g, " ").toLowerCase()));
  const sectionHead = (t: string) => {
    const m = t.trim().match(/^(\d+(?:\.\d+)*\s+.+?)\s+\d{1,4}$/);
    return !!m && headings.has(m[1].replace(/\s+/g, " ").toLowerCase());
  };
  const texts = pages.map((lines, p) => {
    const out: { text: string; level: number; size: number }[] = [];
    const top = lines.findIndex((l, i) => l.text.trim() && !drop[p].has(i));
    lines.forEach((l, i) => {
      if (drop[p].has(i) || (p === 0 && (i < 25 || i >= lines.length - 12) && isPublisherLine(l.text)) || (p > 0 && i === top && sectionHead(l.text))) {
        running++;
        return;
      }
      // An OCR layer's sizes follow the scanned glyphs, not the document's styles.
      // On a slide only the frame title at the top is a heading; larger type further down is a plot's
      // axis labels or a subfigure's caption.
      const level = opts.ocrPages?.has(p + 1) || (deck && out.some((x) => x.text.trim() && !x.level)) ? 0 : headingLevel(l, body, sizes);
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
    const marked = out.map((x, i) => ({
      ...x,
      // The largest type near the top of page 1 is the document's title.
      level: x.level && p === 0 && i < 12 && sizes.length > 1 && x.size >= sizes[0] * 0.98 ? 1 : x.level,
    }));
    const kept = structural(marked, p, deck);
    return figureLabels(shatteredMatrices(kept.map((x) => (x.level ? `${"#".repeat(x.level)} ${x.text}` : x.text)), p + 1), p + 1).join("\n").trim();
  });
  return { pages: texts, running };
}

/**
 * A matrix set with big brackets comes out as one bracket piece per line ("⎡", "⎢", "⎣") with its
 * entries scattered between them; its layout can't be rebuilt from that, so it is pointed to instead.
 */
export function shatteredMatrices(lines: string[], page: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[⎡⎛]\s*$/.test(lines[i])) {
      const close = lines.findIndex((l, j) => j > i && /^\s*[⎦⎠]\s*$/.test(l));
      if (close > 0 && close - i <= 60) {
        out.push(`[matrix, see PDF page ${page}]`);
        i = close;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out;
}

/**
 * A drawn figure's labels come out as a run of short lines ("Gauss", "Quadrature", "𝑲𝑼 = 𝒇", "(reduced)")
 * just before its caption; read as prose they are noise, so the run is pointed to instead. A run is at least
 * four lines of at most five plain words with no sentence end, stopping at a heading, list item, blank line
 * or prose. A run that holds or follows a table's caption, or three rows of numbers, is a table and is kept.
 */
export function figureLabels(lines: string[], page: number): string[] {
  const words = (l: string) => (l.match(/[A-Za-z]{2,}/g) ?? []).length;
  const label = (l: string) => l.trim() !== "" && !/^\s*(#|- |\d+\.\s|\[matrix)/.test(l) && !/[.;:]$/.test(l.trim()) && (words(l) <= 5 || (l.trim().length <= 50 && words(l) <= 7));
  const out = [...lines];
  for (let i = out.length - 1; i > 0; i--) {
    if (!/^\s*(Figure|Fig\.)\s*\d+[.:]/.test(out[i])) continue;
    let start = i;
    while (start > 0 && label(out[start - 1])) start--;
    const run = out.slice(start, i);
    const table = /^\s*Table\s+[\dIVXl]+\b/i.test(out[start - 1] ?? "") || run.some((l) => /^\s*Table\s+[\dIVXl]+\b/i.test(l)) || run.filter((l) => (l.match(/\d+(?:[.,:]\d+)?/g) ?? []).length >= 3).length >= 3;
    if (run.length >= 4 && !table) {
      out.splice(start, i - start, `[diagram, see PDF page ${page}]`);
      i = start;
    }
  }
  return out;
}

/**
 * Pages that only organise the document: a table of contents, a deck's title slide (its title is kept, not the course,
 * lecturer and date lines under it), and divider slides that hold nothing but a heading or two ("Part I"
 * with a part title, "Mesh"). They aren't content, so a divider's headings never become topics.
 */
function structural<T extends { text: string; level: number }>(lines: T[], p: number, deck: boolean): T[] {
  const filled = lines.filter((x) => x.text.trim());
  // A table of contents: dot leaders to page numbers. The headings themselves come later.
  const leaders = filled.filter((x) => /(\.\s?){5,}\s*\d+$/.test(x.text.trim())).length;
  if (leaders >= 3 && leaders >= filled.length / 2) return [];
  if (p === 0) return deck && filled.some((x) => x.level === 1) ? filled.filter((x) => x.level === 1) : lines;
  const divider = filled.length > 0 && filled.length <= 3 && filled.every((x) => x.level) && (deck || filled.some((x) => /^part\s+([ivx]+|\d+)\b/i.test(x.text.trim())));
  return divider ? [] : lines;
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
 * A page whose maths the text layer can't carry: a numbered display equation, unnumbered display
 * equations (short lines of symbols with a relation), lines that are mostly symbols and single letters
 * (fractions and sub/superscripts split onto lines of their own), or, where an OCR layer left the
 * equations out altogether, sentences that stop short where a display followed ("More precisely, let").
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
  const displays = lines.filter((l) => {
    const t = l.trim();
    return t.length <= 70 && /[=≤≥<>→∈⊂∪∩≈]/.test(t) && (t.match(/\b[a-z]{3,}\b/g) ?? []).length <= 2 && !/^#/.test(t);
  }).length;
  const long = lines.map((l) => l.trim().length).filter((n) => n >= 30).sort((a, b) => a - b);
  const width = long.length >= 5 ? long[Math.floor(long.length / 2)] : 0;
  const dangling = width
    ? lines.slice(0, -1).filter((l) => {
        const t = l.trim();
        return t.length < width * 0.6 && t.split(/\s+/).length >= 2 && /[a-z,:;]$/.test(t) && /[a-z]{3}/.test(t) && !/^(#|\d|[A-Z0-9 .:-]+$)/.test(t);
      }).length
    : 0;
  // One numbered equation is enough: its sub- and superscripts, bars and fractions are lost all the same.
  return numbered >= 1 || scraps >= 6 || displays >= 3 || displays + scraps >= 6 || dangling >= 2;
}
