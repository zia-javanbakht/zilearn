import { clozeAnswer, clozePlain, renderCloze } from "./cloze";
import type { Card } from "./types";

/**
 * How a card shows in review, Learn and exports. Cloze cards keep the whole note in `front` and
 * which deletion they ask for in `ord`; label cards draw a diagram with a box marked "?".
 */

type Shown = Pick<Card, "kind" | "ord" | "front" | "back">;

export function cardFront(c: Shown, reveal = false): string {
  return c.kind === "cloze" ? renderCloze(c.front, c.ord, reveal) : c.front;
}

/** The answer side under the front (for a cloze card, its extra note, which may be empty). */
export function cardBack(c: Shown): string {
  return c.back;
}

/** The answer in a few words, as a student would type it, or null when it's longer than that. */
export function shortAnswer(c: Shown): string | null {
  const plain = (s: string) =>
    s
      .replace(/\*\*|__|`/g, "")
      .replace(/^[*_]|[*_]$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  let a: string;
  if (c.kind === "cloze") a = clozeAnswer(c.front, c.ord);
  else a = c.back.split(/\n\s*\n/)[0];
  a = plain(a).replace(/[.;:]$/, "");
  // Maths, lists and long sentences can't be marked by comparing text.
  if (!a || a.length > 48 || /[$\\]|^\s*[-*\d]+[.)]?\s/.test(a) || a.split(" ").length > 6) return null;
  return a;
}

/** The answer as one line, for multiple-choice options. */
export function answerLine(c: Shown): string {
  if (c.kind === "cloze") return clozeAnswer(c.front, c.ord);
  const first = c.back.split(/\n\s*\n/)[0].trim();
  return first.length > 220 ? `${first.slice(0, 219)}…` : first;
}

/** Text to search and list a card by. */
export function cardSummary(c: Shown): string {
  const f = c.kind === "cloze" ? clozePlain(c.front) : c.kind === "label" ? c.front.split("\n")[0] : c.front;
  return f.split("\n")[0].replace(/[*_`$#>]/g, "");
}

/** Whether naming the card's topic would give its answer away before it's revealed. */
export function topicGivesAway(c: Shown & Pick<Card, "topic_title">): boolean {
  if (!c.topic_title) return false;
  return !cardFront(c, false).toLowerCase().includes(c.topic_title.toLowerCase());
}

/** Lower-case, unaccented words without articles or punctuation, for comparing typed answers. */
export function normAnswer(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance, a swap of two neighbouring letters counting as one edit (the commonest typo). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** "right", "close" (a typo away: counted right, with the spelling shown) or "wrong". */
export function markTyped(typed: string, answer: string): "right" | "close" | "wrong" {
  const t = normAnswer(typed);
  const a = normAnswer(answer);
  if (!t) return "wrong";
  if (t === a || t.replace(/s\b/g, "") === a.replace(/s\b/g, "")) return "right";
  return a.length >= 5 && distance(t, a) <= Math.max(1, Math.round(a.length * 0.15)) ? "close" : "wrong";
}
