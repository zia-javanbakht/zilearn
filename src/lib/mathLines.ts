import katex from "katex";
import { ENGLISH_WORDS } from "./englishWords";

/*
 * Display equations in a PDF's own text layer come out as lines of Unicode maths between the sentences
 * ("Π(φ) =", "∫_{B0} ρ0b · φ dV −"). Marking them as $$…$$ blocks lets everything downstream tell maths
 * from prose: key terms and summaries skip them, formula cards and lessons quote them, and the reader
 * renders them as maths. The symbols are kept as the PDF wrote them.
 */

const RELATION = /[=≤≥<>≈≡≠∼⇐⇒⟹⟺→↦]/;
const OPERATOR = /[∑∫∮∂∇√∏±∓×⋅·∘⊗]/;
const SYMBOL = /[=≤≥<>≈≡≠∼⇐⇒⟹⟺→↦∑∫∮∂∇√∏±∓×⋅·∘⊗∀∃∈∉⊂⊆∪∩∅∞′^_{}|‖Ͱ-Ͽ\u{1D400}-\u{1D7FF}]/gu;
/** Names maths writes as words: a line of them is still maths ("Div P + ρ0b = 0"). */
const MATH_WORDS = new Set("div grad curl rot det tr sym skew diag dev sin cos tan sinh cosh tanh exp log ln lim sup inf max min arg ker dim span on in for and if or with".split(" "));

let common: Set<string> | null = null;
function english(w: string): boolean {
  common ??= new Set(ENGLISH_WORDS.split(" "));
  const x = w.toLowerCase();
  return common.has(x) || common.has(x.replace(/s$/, "")) || common.has(x.replace(/(ed|ing)$/, ""));
}

/** Words of running text in a line: three or more letters, not a maths name. */
function proseWords(line: string): string[] {
  return (line.match(/(?<![\p{L}\p{N}_^])\p{L}{3,}(?![\p{N}_^])/gu) ?? []).filter((w) => !MATH_WORDS.has(w.toLowerCase()) && /^[A-Za-z]+$/.test(w));
}

/** A line that is (part of) a display equation, not a sentence that mentions some maths. */
export function isMathLine(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length > 160) return false;
  if (/^(#|- |\* |\d+[.)]\s+\p{L}|\$\$|\[(diagram|matrix|figure)|(figure|fig\.|table)\s*\d)/iu.test(t)) return false;
  // An equation's number on its own line.
  if (/^\(\d{1,3}[a-z]?\)$/.test(t)) return true;
  const words = proseWords(t);
  const symbols = (t.match(SYMBOL) ?? []).length;
  if (!symbols) return false;
  // A sentence opens with a word ("we recover ∫ P : Grad η dV ="); an equation with a symbol or a name.
  const first = t.match(/^\p{L}+/u)?.[0] ?? "";
  if (first.length >= 2 && !MATH_WORDS.has(first.toLowerCase()) && (english(first) || /^(we|it|is|as|so|by|if|an|at|to|be|of|or|no)$/i.test(first)) && words.length >= 1) return false;
  const tokens = t.split(/\s+/).length;
  // A table's row of numbers isn't an equation.
  if ((t.match(/(?<![\p{L}])\d+(?:[.,]\d+)?%?(?![\p{L}])/gu) ?? []).length >= 5 && !OPERATOR.test(t)) return false;
  if (words.length <= 2 && (RELATION.test(t) || OPERATOR.test(t))) return true;
  return symbols >= 3 && words.length <= 3 && words.length / tokens < 0.3;
}

/**
 * The text with each run of display-maths lines as one $$…$$ block. Text already holding $$ blocks (an
 * AI transcription, Markdown notes) is left as it is.
 */
export function markDisplayMaths(text: string): string {
  if (/\$\$/.test(text)) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isMathLine(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    const run: string[] = [];
    // A summation's index or a lone subscript set on its own line ("𝑖") sits between two lines of the equation.
    const scrap = (k: number) => k + 1 < lines.length && /^\S{1,3}$/u.test(lines[k].trim()) && !proseWords(lines[k]).length && isMathLine(lines[k + 1]);
    while (i < lines.length && (isMathLine(lines[i]) || scrap(i))) run.push(lines[i++].trim());
    i--;
    // A lone number tag isn't an equation by itself.
    if (run.every((l) => /^\(\d{1,3}[a-z]?\)$/.test(l))) {
      out.push(...run);
      continue;
    }
    const tex = renderable(run.join(" "));
    // What KaTeX can't read (a garbled OCR line) stays plain text.
    if (tex) out.push(`$$${tex}$$`);
    else out.push(...run);
  }
  return out.join("\n");
}

/** The line as maths KaTeX renders, with LaTeX's special characters escaped; null if it still can't. */
function renderable(line: string): string | null {
  let t = line
    .replace(/\$/g, "")
    .replace(/\s*\u0338\s*=/g, " ≠")
    .replace(/[&%#]/g, (c) => `\\${c}`);
  if ((t.match(/\{/g) ?? []).length !== (t.match(/\}/g) ?? []).length) t = t.replace(/[{}]/g, (c) => `\\${c}`);
  try {
    katex.renderToString(t, { displayMode: true, throwOnError: true, strict: "ignore" });
    return t;
  } catch {
    return null;
  }
}
