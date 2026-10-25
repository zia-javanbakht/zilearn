import { beforeEach, describe, expect, it } from "vitest";
import { cardState, elapsedDays, fromSm2, NEW_CARD, nextDueIn, preview, retrievability, review } from "@/lib/srs";
import { openDb, setDb } from "@/lib/db";
import { addCards, cardStats, createCourse, dueCards, replaceTopics, reviewCard, updateCourse } from "@/lib/store";
import { cardsFromMistakes, generateCards } from "@/lib/generate";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

describe("FSRS schedule", () => {
  it("grows intervals with Good, by more each time, and starts over on Again", () => {
    let s = NEW_CARD;
    const intervals: number[] = [];
    // Each review on the day it falls due.
    for (let i = 0; i < 5; i++) intervals.push((s = review(s, 3, s.interval)).interval);
    expect(intervals[0]).toBe(3); // FSRS-5's first Good
    for (let i = 1; i < 5; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1] * 1.5);
    const lapsed = review(s, 1, s.interval);
    expect(lapsed).toMatchObject({ interval: 0, reps: 0, lapses: 1 });
    expect(lapsed.stability).toBeLessThan(s.stability);
    expect(lapsed.difficulty).toBeGreaterThan(s.difficulty);
  });

  it("orders the buttons Hard < Good < Easy and keeps difficulty within 1-10", () => {
    const s = { stability: 10, difficulty: 5, interval: 10, reps: 3, lapses: 0 };
    const [a, h, g, e] = preview(s, 10).map((x) => x.interval);
    expect(a).toBe(0);
    expect(h).toBeLessThan(g);
    expect(g).toBeLessThan(e);
    let hard = s;
    for (let i = 0; i < 30; i++) hard = review(hard, 1, 1);
    expect(hard.difficulty).toBeLessThanOrEqual(10);
    let easy = s;
    for (let i = 0; i < 30; i++) easy = review(easy, 4, easy.interval);
    expect(easy.difficulty).toBeGreaterThanOrEqual(1);
    expect(easy.interval).toBeLessThanOrEqual(365);
  });

  it("relearns a forgotten card on the same day with the short-term formula", () => {
    const forgot = review(NEW_CARD, 1, 0);
    expect(forgot.interval).toBe(0);
    const again = review(forgot, 3, 0);
    // A day or two: Hard gets the 1-day minimum and Good must give more.
    expect([1, 2]).toContain(again.interval);
    expect(again.stability).toBeGreaterThan(forgot.stability);
  });

  it("is 90% sure of recall after `stability` days", () => {
    expect(retrievability(7, 7)).toBeCloseTo(0.9, 5);
    expect(retrievability(0, 7)).toBe(1);
  });

  it("converts SM-2 cards: interval becomes stability, ease becomes difficulty", () => {
    expect(fromSm2(2.5, 20)).toEqual({ stability: 20, difficulty: 5 });
    expect(fromSm2(1.3, 3).difficulty).toBe(10);
    expect(fromSm2(3.3, 3).difficulty).toBe(1);
    expect(fromSm2(2.5, 0).stability).toBeGreaterThan(0);
    // A stored SM-2 card without FSRS fields still schedules.
    const st = cardState({ ease: 2.1, interval: 12, reps: 4, lapses: 1, due: "2026-10-20", last_review: "2026-10-08", stability: null, difficulty: null });
    expect(st.stability).toBe(12);
    expect(elapsedDays({ interval: 12, reps: 4, lapses: 1, due: "2026-10-20", last_review: "2026-10-08", stability: 12, difficulty: 5 }, "2026-10-20")).toBe(12);
  });

  it("brings cards back before the exam", () => {
    const s = (interval: number) => ({ stability: interval, difficulty: 5, interval, reps: 4, lapses: 0 });
    expect(nextDueIn(s(30), 10)).toBe(9);
    expect(nextDueIn(s(5), 10)).toBe(5);
    expect(nextDueIn(s(30), null)).toBe(30);
  });
});

describe("moving an SM-2 database to FSRS", () => {
  it("gives reviewed cards a memory state once, and leaves new cards new", async () => {
    const Database = (await import("better-sqlite3")).default;
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zl-")), "old.db");
    // An old database: cards with SM-2 fields only.
    const old = new Database(file);
    old.exec(`CREATE TABLE courses (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT, description TEXT, exam_date TEXT, target_level INTEGER NOT NULL DEFAULT 3, hours_per_day REAL NOT NULL DEFAULT 2, summary TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE cards (id TEXT PRIMARY KEY, course_id TEXT NOT NULL, topic_id TEXT, front TEXT NOT NULL, back TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'generated', ease REAL NOT NULL DEFAULT 2.5, interval INTEGER NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, due TEXT, last_review TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), generated_by TEXT NOT NULL);
      INSERT INTO courses (id, name) VALUES ('c', 'C');
      INSERT INTO cards (id, course_id, front, back, ease, interval, reps, due, last_review, generated_by) VALUES ('a', 'c', 'Q1', 'A1', 2.5, 20, 3, '2026-11-01', '2026-10-12', 'student');
      INSERT INTO cards (id, course_id, front, back, generated_by) VALUES ('b', 'c', 'Q2', 'A2', 'student');`);
    old.close();
    const d = openDb(file);
    const rows = d.prepare("SELECT id, stability, difficulty, kind, ord FROM cards ORDER BY id").all();
    expect(rows).toEqual([
      { id: "a", stability: 20, difficulty: 5, kind: "basic", ord: 0 },
      { id: "b", stability: null, difficulty: null, kind: "basic", ord: 0 },
    ]);
    d.close();
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
    // Good on a new card is three days under FSRS.
    expect(dueCards(c.id, "2026-10-12").map((x) => x.id)).toEqual([second.id]);
    expect(dueCards(c.id, "2026-10-14").map((x) => x.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("caps the next review before the exam date", () => {
    const c = seed();
    updateCourse(c.id, { exam_date: "2026-10-14" });
    addCards(c.id, [{ front: "Q", back: "A", topic_id: null }], "manual", "student");
    const [card] = dueCards(c.id, "2026-10-11");
    const r = reviewCard(card.id, 4, "2026-10-11")!; // Easy on a new card is 16 days, past the exam
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
    expect([back.due, back.reps, back.lapses, back.stability, back.difficulty, back.interval]).toEqual([before.due, before.reps, before.lapses, before.stability, before.difficulty, before.interval]);
  });
});
