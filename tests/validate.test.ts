import { describe, expect, it } from "vitest";
import { CardsInput, check, ExamInput, PodcastInput } from "@/lib/validate";

describe("generation inputs", () => {
  it("never pass NaN on, clamp to range and fall back to defaults", () => {
    const e = check(ExamInput, { questionCount: "x", mix: { mcq: "a" }, durationMinutes: "abc" });
    expect(e.ok && e.data).toMatchObject({ questionCount: 10, mix: { mcq: 5, short: 3, long: 2 }, durationMinutes: 60 });
    expect(e.ok && e.data.depth).toBeFalsy();
    const f = check(ExamInput, { questionCount: 500, mix: { mcq: 1, short: 0, long: 0 }, durationMinutes: 1, depth: 2.6 });
    expect(f.ok && f.data).toMatchObject({ questionCount: 40, mix: { mcq: 1, short: 0, long: 0 }, durationMinutes: 5, depth: 3 });
    expect(CardsInput.parse({ count: "lots" }).count).toBe(20);
    expect(CardsInput.parse({ count: 1000 }).count).toBe(60);
    expect(PodcastInput.parse({}).minutes).toBe(10);
  });
});

describe("file paths", () => {
  it("stay inside the uploads folder", async () => {
    const { dataPath } = await import("@/lib/db");
    expect(dataPath("uploads", "abc", "x.pdf")).toMatch(/uploads[\\/]abc[\\/]x\.pdf$/);
    expect(() => dataPath("uploads", "../..")).toThrow();
    expect(() => dataPath("uploads", "..")).toThrow();
    expect(() => dataPath("/etc/passwd")).toThrow();
    expect(() => dataPath("zilearn.db")).toThrow();
  });
});
