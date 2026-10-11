import { describe, expect, it } from "vitest";
import { buildIcs, esc, fold } from "@/lib/ics";
import type { Course, PlanItem } from "@/lib/types";

const course = { id: "c1", name: "Machine Learning, Intro", exam_date: "2026-11-01" } as Course;
const item = (id: string, date: string, minutes: number, extra: Partial<PlanItem> = {}): PlanItem => ({
  id, plan_id: "p", day: 0, date, iteration: 1, kind: "study", topic_id: "t", topic_title: "Backprop; chain rule", depth: 1, minutes,
  activities: ["Read the slides", "Write 3 key terms"], done: false, position: 0, ...extra,
});
const items = [item("a", "2026-10-12", 30), item("b", "2026-10-12", 45, { kind: "checkpoint", topic_title: "End of pass 1" }), item("c", "2026-10-13", 20, { done: true }), item("d", "2026-10-11", 20)];
const unfold = (s: string) => s.replace(/\r\n /g, "");

describe("calendar export", () => {
  it("lays sessions back to back from the start time with stable ids and one reminder per day", () => {
    const ics = buildIcs(course, items, { start: "18:30", mode: "sessions", breakMinutes: 5, includeDone: false, from: "2026-10-12", reminderMinutes: 10, now: new Date("2026-10-11T00:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const flat = unfold(ics);
    expect(flat).toContain("UID:a@zilearn\r\nDTSTAMP:20261011T000000Z\r\nDTSTART:20261012T183000\r\nDTEND:20261012T190000");
    expect(flat).toContain("DTSTART:20261012T190500\r\nDTEND:20261012T195000");
    expect(flat).not.toContain("UID:c@zilearn"); // done
    expect(flat).not.toContain("UID:d@zilearn"); // before `from`
    expect(flat.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(flat).toContain("SUMMARY:📘 Backprop\; chain rule (pass 1: Survey) · Machine Learning\\, Intro");
    expect(flat).toContain("DTSTART;VALUE=DATE:20261101");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("can make one event per day and wraps late sessions past midnight", () => {
    const ics = unfold(buildIcs(course, items, { start: "23:30", mode: "days", breakMinutes: 0, includeDone: true, reminderMinutes: null }));
    expect(ics).toContain("UID:day-2026-10-12-c1@zilearn");
    expect(ics).toContain("DTSTART:20261012T233000\r\nDTEND:20261013T004500");
    expect(ics).not.toContain("VALARM");
  });

  it("escapes and folds text per RFC 5545", () => {
    expect(esc("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
    const long = "SUMMARY:" + "é".repeat(60);
    const folded = fold(long);
    expect(folded.split("\r\n ").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
});
