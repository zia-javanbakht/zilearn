import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { cloze, generateCards } from "@/lib/generate";
import { dynamicsCourse } from "./fixtures/dynamics";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

beforeEach(() => setDb(openDb(":memory:")));

describe("offline flashcards", () => {
  it("asks for definitions and formulas the materials state, citing them", async () => {
    const { course, topic } = dynamicsCourse();
    const { cards, by } = await generateCards(course.id, { kind: "topic", topicId: topic.id }, 20);
    expect(by).toBe("heuristic");
    const crit = cards.find((c) => /\*\*critical damping\*\*/i.test(c.front));
    expect(crit?.back).toMatch(/smallest damping/);
    expect(crit?.back).toMatch(/\*From Lecture 3/);
    // A formula card hides the right-hand side.
    const formula = cards.find((c) => c.front.includes("= \\;?$$"));
    expect(formula).toBeTruthy();
    expect(formula!.back).toMatch(/^\$\$.+=.+\$\$/);
    // Fronts never give the answer away.
    for (const c of cards) expect(c.front).not.toContain(c.back.split("\n")[0]);
  });

  it("takes turns between topics so a small deck covers many of them", async () => {
    const { course } = dynamicsCourse();
    const { cards } = await generateCards(course.id, { kind: "course" }, 5);
    expect(new Set(cards.map((c) => c.topic_id)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("cloze", () => {
  it("gaps the term and its plural, and refuses when too little is left", () => {
    expect(cloze("Shape functions interpolate both the geometry and the displacement of each element.", "Shape function")).toBe(
      "_____ interpolate both the geometry and the displacement of each element.",
    );
    expect(cloze("Conservation of angular momentum", "Angular momentum")).toBeNull();
    expect(cloze("Nothing about it here at all, really nothing.", "Jacobian")).toBeNull();
  });
});
