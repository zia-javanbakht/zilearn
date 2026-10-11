/**
 * Spaced repetition (SM-2 family, Anki-style ratings). Pure, so it runs in tests and in the browser
 * (to show each button's next interval before the student picks it).
 */

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export const RATING_LABELS: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export interface SrsState {
  ease: number; // multiplier, starts at 2.5, never below 1.3
  interval: number; // days until the next review
  reps: number; // successful reviews in a row
  lapses: number; // times forgotten after being learned
}

export const NEW_CARD: SrsState = { ease: 2.5, interval: 0, reps: 0, lapses: 0 };

export function review(s: SrsState, rating: Rating): SrsState {
  if (rating === 1) {
    // Forgotten: back to the start (seen again later in this session), and grow more slowly from now on.
    return { ease: Math.max(1.3, s.ease - 0.2), interval: 0, reps: 0, lapses: s.lapses + (s.reps > 0 ? 1 : 0) };
  }
  let interval: number;
  let ease = s.ease;
  if (rating === 2) {
    interval = s.reps === 0 ? 1 : Math.max(s.interval + 1, Math.round(s.interval * 1.2));
    ease = Math.max(1.3, ease - 0.15);
  } else if (rating === 3) {
    interval = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(s.interval + 1, Math.round(s.interval * ease));
  } else {
    interval = s.reps === 0 ? 4 : Math.max(s.interval + 2, Math.round(s.interval * ease * 1.3));
    ease += 0.15;
  }
  return { ease: Math.round(ease * 100) / 100, interval: Math.min(interval, 365), reps: s.reps + 1, lapses: s.lapses };
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
