/**
 * Cloze deletions in Anki's syntax: "The {{c1::mitochondrion}} makes {{c2::ATP::a molecule}}." Each
 * number is its own card, asking for the deletions with that number while showing the others.
 */

interface Deletion {
  start: number;
  end: number; // just past the closing }}
  n: number;
  answer: string;
  hint: string;
}

/** Every {{cN::answer::hint}} in the text. Braces inside the answer may nest ({{c1::\frac{a}{b}}}). */
export function deletions(text: string): Deletion[] {
  const out: Deletion[] = [];
  const open = /\{\{c(\d+)::/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    let depth = 0;
    let i = open.lastIndex;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\") i++;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        if (depth > 0) depth--;
        else if (text[i + 1] === "}") break;
      }
    }
    if (i >= text.length) break; // never closed
    const body = text.slice(open.lastIndex, i);
    // A hint is the part after the last top-level "::".
    let split = -1;
    for (let k = 0, d = 0; k < body.length - 1; k++) {
      if (body[k] === "{") d++;
      else if (body[k] === "}") d--;
      else if (!d && body[k] === ":" && body[k + 1] === ":") split = k;
    }
    out.push({
      start: m.index,
      end: i + 2,
      n: Number(m[1]),
      answer: split < 0 ? body : body.slice(0, split),
      hint: split < 0 ? "" : body.slice(split + 2).trim(),
    });
    open.lastIndex = i + 2;
  }
  return out;
}

function replaceDeletions(text: string, fn: (d: Deletion) => string): string {
  let out = "";
  let at = 0;
  for (const d of deletions(text)) {
    out += text.slice(at, d.start) + fn(d);
    at = d.end;
  }
  return out + text.slice(at);
}

export function hasCloze(text: string): boolean {
  return deletions(text).some((d) => d.n > 0);
}

/** The cloze numbers in the text, in order (one card each). */
export function clozeNumbers(text: string): number[] {
  return [...new Set(deletions(text).map((d) => d.n))].filter((n) => n > 0).sort((a, b) => a - b);
}

/** Whether position `i` of `text` is inside $...$ or $$...$$ maths. */
function inMath(text: string, i: number): boolean {
  let open = false;
  for (let k = 0; k < i; k++) {
    if (text[k] === "\\") {
      k++;
      continue;
    }
    if (text[k] === "$") {
      if (text[k + 1] === "$") k++;
      open = !open;
    }
  }
  return open;
}

/**
 * Markdown for one cloze card: the deletions numbered `ord` hidden (or highlighted, once revealed),
 * every other deletion shown as its plain text. Inside maths the gap is a box, so KaTeX still renders.
 */
export function renderCloze(text: string, ord: number, reveal: boolean): string {
  return replaceDeletions(text, (d) => {
    if (d.n !== ord) return d.answer;
    if (inMath(text, d.start)) return reveal ? `\\boxed{${d.answer}}` : `\\boxed{${d.hint ? `\\text{${d.hint}}` : "?"}}`;
    return reveal ? `**[${d.answer}]**` : `**[${d.hint || "…"}]**`;
  });
}

/** The text a cloze card asks for (its deletions numbered `ord`, joined). */
export function clozeAnswer(text: string, ord: number): string {
  return deletions(text)
    .filter((d) => d.n === ord)
    .map((d) => d.answer.trim())
    .join(", ");
}

/** The sentence with all cloze markup removed. */
export function clozePlain(text: string): string {
  return replaceDeletions(text, (d) => d.answer);
}
