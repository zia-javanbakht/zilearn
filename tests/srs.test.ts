import { beforeEach, describe, expect, it } from "vitest";
import { NEW_CARD, nextDueIn, review } from "@/lib/srs";
import { openDb, setDb } from "@/lib/db";
import { addCards, cardStats, createCourse, dueCards, replaceTopics, reviewCard, updateCourse } from "@/lib/store";
import { cardsFromMistakes, generateCards } from "@/lib/generate";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

describe("spaced repetition schedule", () => {
  it("grows intervals with Good and resets on Again", () => {
    let s = NEW_CARD;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) intervals.push((s = review(s, 3)).interval);
    expect(intervals.slice(0, 3)).toEqual([1, 3, 8]);
    expect(intervals[4]).toBeGreaterThan(intervals[3]);
    const lapsed = review(s, 1);
    expect(lapsed).toMatchObject({ interval: 0, reps: 0, lapses: 1 });
    expect(lapsed.ease).toBeCloseTo(2.3);
  });

  it("orders the buttons Hard < Good < Easy and keeps ease at least 1.3", () => {
    const s = { ease: 2.5, interval: 10, reps: 3, lapses: 0 };
    const [h, g, e] = [2, 3, 4].map((r) => review(s, r as 2 | 3 | 4).interval);
    expect(h).toBeLessThan(g);
    expect(g).toBeLessThan(e);
    let low = s;
    for (let i = 0; i < 20; i++) low = review(low, 2);
    expect(low.ease).toBe(1.3);
  });

  it("brings cards back before the exam", () => {
    expect(nextDueIn({ ease: 2.5, interval: 30, reps: 4, lapses: 0 }, 10)).toBe(9);
    expect(nextDueIn({ ease: 2.5, interval: 5, reps: 4, lapses: 0 }, 10)).toBe(5);
    expect(nextDueIn({ ease: 2.5, interval: 30, reps: 4, lapses: 0 }, null)).toBe(30);
  });
});

describe("flashcard store", () => {
  beforeEach(() => setDb(openDb(":memory:")));

  function seed() {
    const c = createCourse({ name: "Stats" });
    replaceTopics(c.id, [
      { ref: "1", parent_ref: null, title: "Inference", summary: "Drawing conclusions from data.", keywords: ["p-value"], material_ids: [], importance: 3 },
      { ref: "1.1", parent_ref: "1", title: "Hypothesis tests", summary: "Test a claim against a null hypothesis.", keywords: ["null hypothesis"], material_ids: [], importance: 3 },
    ]);
    return c;
  }

  it("skips duplicate fronts and schedules reviews", () => {
    const c = seed();
    const added = addCards(c.id, [
      { front: "What is a p-value?", back: "P(data this extreme | H0)", topic_id: null },
      { front: "what is a P-value", back: "dup", topic_id: null },
      { front: "Define power", back: "1 - beta", topic_id: "not-a-topic" },
    ], "manual", "student");
    expect(added).toBe(2);
    const today = "2026-10-11";
    expect(cardStats(c.id, today)).toEqual({ total: 2, due: 0, fresh: 2, learned: 0 });
    const [first, second] = dueCards(c.id, today);
    expect(second.topic_id).toBeNull();
    reviewCard(first.id, 3, today);
    const again = reviewCard(second.id, 1, today)!;
    expect(again.due).toBe(today);
    expect(cardStats(c.id, today)).toEqual({ total: 2, due: 1, fresh: 0, learned: 1 });
    expect(dueCards(c.id, "2026-10-12").map((x) => x.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("caps the next review before the exam date", () => {
    const c = seed();
    updateCourse(c.id, { exam_date: "2026-10-14" });
    addCards(c.id, [{ front: "Q", back: "A", topic_id: null }], "manual", "student");
    const [card] = dueCards(c.id, "2026-10-11");
    const r = reviewCard(card.id, 4, "2026-10-11")!; // Easy on a new card is 4 days, past the exam
    expect(r.due).toBe("2026-10-13");
  });

  it("generates offline cards linked to topics and turns exam mistakes into cards", async () => {
    const c = seed();
    const out = await generateCards(c.id, { kind: "course" }, 10);
    expect(out.by).toBe("heuristic");
    expect(out.cards.length).toBeGreaterThan(0);
    expect(out.cards.every((x) => x.topic_id)).toBe(true);
    const mistakes = cardsFromMistakes(
      [
        { id: "q1", type: "mcq", topic_id: null, topic_title: "x", prompt: "Pick", options: ["a", "b"], answer_index: 1, model_answer: "b", marks: 1 },
        { id: "q2", type: "short", topic_id: null, topic_title: "x", prompt: "Explain", options: [], answer_index: null, model_answer: "Because", marks: 4 },
        { id: "q3", type: "short", topic_id: null, topic_title: "x", prompt: "Self", options: [], answer_index: null, model_answer: "m", marks: 2 },
      ],
      [
        { question_id: "q1", score: 0, max: 1, feedback: "Correct answer: b" },
        { question_id: "q2", score: 4, max: 4, feedback: "Good" },
        { question_id: "q3", score: 0, max: 2, feedback: "Needs marking: ..." },
      ],
    );
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0].back).toContain("B.");
  });
});

describe("undoing a review", () => {
  it("puts the card's schedule back as it was", async () => {
    const { openDb, setDb } = await import("@/lib/db");
    const { addCards, createCourse, listCards, restoreCard, reviewCard } = await import("@/lib/store");
    setDb(openDb(":memory:"));
    const c = createCourse({ name: "X" });
    addCards(c.id, [{ front: "Q", back: "A", topic_id: null }], "manual", "student");
    const before = listCards(c.id)[0];
    const after = reviewCard(before.id, 1, "2026-10-25")!;
    expect(after.due).not.toBeNull();
    const back = restoreCard(before.id, before)!;
    expect([back.due, back.reps, back.lapses, back.ease, back.interval]).toEqual([before.due, before.reps, before.lapses, before.ease, before.interval]);
  });
});
