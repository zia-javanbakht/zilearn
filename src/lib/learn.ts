import { answerLine, normAnswer, shortAnswer } from "./cardView";
import type { Card } from "./types";

/**
 * Learn mode, after Quizlet's: drill a set of cards until each is mastered, multiple choice first and
 * then typing the answer. A miss sends the card back to the start. It works on a few cards at a time
 * (bringing in new ones as others are mastered), and doesn't change the spaced-repetition schedule.
 */

export type LearnCard = Pick<Card, "id" | "kind" | "ord" | "front" | "back" | "topic_id" | "topic_title">;

export interface LearnItem {
  card: LearnCard;
  /** 0: not yet answered right; 1: right once (multiple choice); 2: mastered. */
  stage: 0 | 1 | 2;
  misses: number;
  /** The answer to type, when it is short enough to compare (otherwise it's multiple choice twice). */
  typed: string | null;
}

export interface LearnState {
  items: LearnItem[];
  /** Ids of the cards being worked on now, at most `ACTIVE`. */
  active: string[];
  lastId: string | null;
  asked: number;
  right: number;
}

export interface LearnQuestion {
  id: string;
  mode: "choice" | "typed";
  options: string[]; // multiple choice only
  answer: string; // the right option, or the text to type
}

export const ACTIVE = 7;

export function startLearn(cards: LearnCard[]): LearnState {
  const items = cards.map((card): LearnItem => ({ card, stage: 0, misses: 0, typed: shortAnswer(card) }));
  return refill({ items, active: [], lastId: null, asked: 0, right: 0 });
}

function refill(s: LearnState): LearnState {
  const mastered = new Set(s.items.filter((i) => i.stage === 2).map((i) => i.card.id));
  const active = s.active.filter((id) => !mastered.has(id));
  for (const i of s.items) {
    if (active.length >= ACTIVE) break;
    if (i.stage < 2 && !active.includes(i.card.id)) active.push(i.card.id);
  }
  return { ...s, active };
}

export function progress(s: LearnState) {
  return {
    total: s.items.length,
    mastered: s.items.filter((i) => i.stage === 2).length,
    familiar: s.items.filter((i) => i.stage === 1).length,
    done: s.items.every((i) => i.stage === 2),
  };
}

/** The next question, or null once every card is mastered. `random` is injectable for tests. */
export function nextQuestion(s: LearnState, random: () => number = Math.random): LearnQuestion | null {
  if (!s.active.length) return null;
  // Not the same card twice in a row while there are others to ask.
  const pool = s.active.length > 1 ? s.active.filter((id) => id !== s.lastId) : s.active;
  // Cards missed most come up most.
  const items = pool.map((id) => s.items.find((i) => i.card.id === id)!);
  const weights = items.map((i) => 1 + i.misses);
  let r = random() * weights.reduce((a, b) => a + b, 0);
  let item = items[0];
  for (let k = 0; k < items.length; k++) if ((r -= weights[k]) < 0) {
    item = items[k];
    break;
  }
  if (item.stage === 1 && item.typed) return { id: item.card.id, mode: "typed", options: [], answer: item.typed };
  const answer = answerLine(item.card);
  return { id: item.card.id, mode: "choice", options: choices(s, item, answer, random), answer };
}

/** The right answer and up to three others, from the same topic first, in random order. */
function choices(s: LearnState, item: LearnItem, answer: string, random: () => number): string[] {
  const key = normAnswer(answer);
  const seen = new Set([key]);
  const others = s.items
    .filter((i) => i.card.id !== item.card.id)
    // Like with like: cloze answers among cloze answers, short answers among short ones.
    .map((i) => ({ text: answerLine(i.card), near: (i.card.topic_id && i.card.topic_id === item.card.topic_id ? 2 : 0) + (i.card.kind === item.card.kind ? 1 : 0) + random() }))
    .sort((a, b) => b.near - a.near);
  const picked: string[] = [];
  for (const o of others) {
    const k = normAnswer(o.text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    picked.push(o.text);
    if (picked.length === 3) break;
  }
  const all = [answer, ...picked];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

/** Record an answer: right moves the card on a stage, wrong sends it back to the start. */
export function answer(s: LearnState, q: LearnQuestion, right: boolean): LearnState {
  const items = s.items.map((i): LearnItem => {
    if (i.card.id !== q.id) return i;
    if (!right) return { ...i, stage: 0, misses: i.misses + 1 };
    return { ...i, stage: i.stage === 0 ? 1 : 2 };
  });
  return refill({ ...s, items, lastId: q.id, asked: s.asked + 1, right: s.right + (right ? 1 : 0) });
}
