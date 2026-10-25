import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { addCards, createCourse, savePlan, setPlanItemDone, todayOverview } from "@/lib/store";

beforeEach(() => setDb(openDb(":memory:")));

const item = (date: string, title: string, position: number) => ({
  day: 1, date, iteration: 1, kind: "study" as const, topic_id: null, topic_title: title, depth: 1, minutes: 20, activities: [], done: false, position,
});

describe("today overview", () => {
  it("lists today's unfinished sessions, overdue ones and cards, and leaves idle courses out", () => {
    const a = createCourse({ name: "Dynamics", exam_date: "2026-11-01" });
    createCourse({ name: "Idle" });
    const plan = savePlan({ course_id: a.id, start_date: "2026-10-24", end_date: "2026-11-01", target_level: 2, iterations: 1, warnings: [], items: [item("2026-10-24", "Old", 0), item("2026-10-25", "Damping", 1), item("2026-10-25", "Resonance", 2)] });
    setPlanItemDone(plan.items[2].id, true);
    addCards(a.id, [{ front: "Q1", back: "A1", topic_id: null }, { front: "Q2", back: "A2", topic_id: null }], "manual", "student");
    const rows = todayOverview("2026-10-25");
    expect(rows).toHaveLength(1);
    expect(rows[0].course.name).toBe("Dynamics");
    expect(rows[0].sessions.map((s) => s.topic_title)).toEqual(["Damping"]);
    expect(rows[0].overdue).toBe(1);
    expect(rows[0].cards).toBe(2);
    expect(rows[0].examInDays).toBe(7);
  });
});
