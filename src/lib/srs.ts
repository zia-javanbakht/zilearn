/**
 * Spaced repetition with FSRS (Free Spaced Repetition Scheduler, version 5, the scheduler Anki uses),
 * with Anki-style ratings. Pure, so it runs in tests and in the browser (to show each button's next
 * interval before the student picks it).
 *
 * FSRS models each card's memory with two numbers: stability (days until the chance of recalling it
 * falls to 90%) and difficulty (1-10). Reviews are day-based: a card forgotten today ("Again") comes
 * back later in the same session, and those same-day reviews use FSRS's short-term formula.
 */

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export const RATING_LABELS: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export interface SrsState {
  stability: number; // days until recall probability drops to 90%; 0 = never reviewed
  difficulty: number; // 1 (easy) to 10 (hard); 0 = never reviewed
  interval: number; // days until the next review; 0 = again today
  reps: number; // successful reviews in a row
  lapses: number; // times forgotten after being learned
}

export const NEW_CARD: SrsState = { stability: 0, difficulty: 0, interval: 0, reps: 0, lapses: 0 };

/** FSRS-5 default parameters (trained on Anki review logs). */
export const FSRS_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898,
  0.51655, 0.6621,
];

/** Chance of remembering a card when it comes up for review. */
export const DESIRED_RETENTION = 0.9;
export const MAX_INTERVAL = 365;

const w = FSRS_WEIGHTS;
const DECAY = -0.5;
const FACTOR = 19 / 81; // makes retrievability exactly 90% after `stability` days

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Probability of recalling a card `days` after its last review. */
export function retrievability(days: number, stability: number): number {
  return stability > 0 ? Math.pow(1 + (FACTOR * Math.max(0, days)) / stability, DECAY) : 0;
}

function initDifficulty(g: Rating) {
  return w[4] - Math.exp(w[5] * (g - 1)) + 1;
}

function nextDifficulty(d: number, g: Rating) {
  const next = d - w[6] * (g - 3) * ((10 - d) / 9); // linear damping: changes shrink near the top
  return clamp(w[7] * initDifficulty(4) + (1 - w[7]) * next, 1, 10); // mean reversion
}

function recallStability(d: number, s: number, r: number, g: Rating) {
  const hard = g === 2 ? w[15] : 1;
  const easy = g === 4 ? w[16] : 1;
  return s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy);
}

function forgetStability(d: number, s: number, r: number) {
  return Math.min(s, w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r)));
}

function intervalFor(stability: number) {
  const days = (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_INTERVAL);
}

/** The next state for each rating (Again, Hard, Good, Easy), with Hard < Good < Easy in days. */
export function preview(s: SrsState, elapsedDays: number): [SrsState, SrsState, SrsState, SrsState] {
  const fresh = !(s.stability > 0);
  const r = fresh ? 0 : retrievability(elapsedDays, s.stability);
  const out = ([1, 2, 3, 4] as Rating[]).map((g) => {
    let stability: number;
    let difficulty: number;
    if (fresh) {
      stability = w[g - 1];
      difficulty = clamp(initDifficulty(g), 1, 10);
    } else {
      difficulty = nextDifficulty(s.difficulty || initDifficulty(3), g);
      if (elapsedDays < 1) stability = s.stability * Math.exp(w[17] * (g - 3 + w[18])); // again on the same day
      else stability = g === 1 ? forgetStability(s.difficulty, s.stability, r) : recallStability(s.difficulty, s.stability, r, g);
    }
    stability = Math.max(0.01, stability);
    const forgot = g === 1;
    return {
      stability: round2(stability),
      difficulty: round2(difficulty),
      interval: forgot ? 0 : intervalFor(stability),
      reps: forgot ? 0 : s.reps + 1,
      lapses: s.lapses + (forgot && s.reps > 0 ? 1 : 0),
    };
  }) as [SrsState, SrsState, SrsState, SrsState];
  // Each button must give more time than the one before it.
  out[2].interval = Math.min(MAX_INTERVAL, Math.max(out[2].interval, out[1].interval + (fresh ? 0 : 1)));
  out[3].interval = Math.min(MAX_INTERVAL, Math.max(out[3].interval, out[2].interval + 1));
  return out;
}

export function review(s: SrsState, rating: Rating, elapsedDays: number): SrsState {
  return preview(s, elapsedDays)[rating - 1];
}

/** The fields a stored card carries; `due` null means never reviewed. */
export interface StoredSchedule {
  stability: number | null;
  difficulty: number | null;
  interval: number;
  reps: number;
  lapses: number;
  due: string | null;
  last_review: string | null;
  ease?: number;
}

/** A stored card's memory state, converting SM-2 cards (ease and interval only) on the way. */
export function cardState(c: StoredSchedule): SrsState {
  if (c.due == null) return NEW_CARD;
  if (c.stability && c.stability > 0 && c.difficulty) return { stability: c.stability, difficulty: c.difficulty, interval: c.interval, reps: c.reps, lapses: c.lapses };
  return { ...fromSm2(c.ease ?? 2.5, c.interval), interval: c.interval, reps: c.reps, lapses: c.lapses };
}

/**
 * FSRS memory state for a card scheduled by SM-2. At 90% retention the interval equals the stability,
 * so the current interval is the stability; ease maps onto difficulty (2.5, the starting ease, is middling,
 * 1.3, the floor, is hardest).
 */
export function fromSm2(ease: number, interval: number): { stability: number; difficulty: number } {
  const d = ease <= 2.5 ? 5 + ((2.5 - ease) / 1.2) * 5 : 5 - ((ease - 2.5) / 0.8) * 4;
  return { stability: round2(interval > 0 ? interval : w[0]), difficulty: round2(clamp(d, 1, 10)) };
}

/** Whole days between two YYYY-MM-DD dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

/** Days since the card was last reviewed (its interval when the date is unknown). */
export function elapsedDays(c: StoredSchedule, today: string): number {
  if (c.due == null) return 0;
  return c.last_review ? Math.max(0, daysBetween(c.last_review, today)) : c.interval;
}

/**
 * Days until the card is next due. With an exam ahead, intervals are squeezed so every card
 * comes up at least once more before the exam instead of landing after it.
 */
export function nextDueIn(next: SrsState, daysToExam: number | null): number {
  if (next.interval === 0) return 0;
  if (daysToExam != null && daysToExam > 1 && next.interval >= daysToExam) return Math.max(1, daysToExam - 1);
  return next.interval;
}

export function describeInterval(days: number): string {
  if (days <= 0) return "now";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
}
