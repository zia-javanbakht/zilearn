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

describe("offline mock exams", () => {
  it("asks which term fills a gap, offers related terms as distractors, and marks from the materials", async () => {
    const { generateExam } = await import("@/lib/generate");
    const { course } = dynamicsCourse();
    const exam = await generateExam(course.id, { scope: { kind: "course" }, questionCount: 12, mix: { mcq: 6, short: 3, long: 3 }, durationMinutes: 60 });
    const mcqs = exam.questions.filter((q) => q.type === "mcq");
    expect(mcqs.length).toBeGreaterThan(0);
    for (const q of mcqs) {
      expect(q.prompt).toMatch(/^Which term fills the gap\?/);
      // The answer isn't in the clue, and neither is any option.
      for (const o of q.options) expect(q.prompt.toLowerCase()).not.toContain(o.toLowerCase());
      expect(q.options[q.answer_index!]).toBe(q.topic_title);
    }
    // Written questions carry a marking guide from the materials, not an empty summary.
    for (const q of exam.questions.filter((x) => x.type !== "mcq")) expect(q.model_answer.length).toBeGreaterThan(20);
  });
});

describe("offline notes and podcasts", () => {
  it("reads only sentences of words aloud", async () => {
    const { speakable } = await import("@/lib/generate");
    expect(speakable("The linear momentum of the spatial cut 𝑆𝑝 is 𝑳𝑆𝑝 = ∫𝑆𝑝 𝜌𝒗 d𝑣.")).toBeNull();
    expect(speakable("(20) The **damping ratio** $\\zeta$ says how quickly free vibration dies away.")).toBe("The damping ratio says how quickly free vibration dies away.");
  });

  it("writes review notes from the definitions and results in the materials", async () => {
    const { generateNotes } = await import("@/lib/generate");
    const { course } = dynamicsCourse();
    const n = await generateNotes(course.id, { kind: "course" }, "concise");
    expect(n.content).toMatch(/smallest damping/);
    expect(n.content).toMatch(/\*\(Lecture 3/);
    expect(n.content).not.toMatch(/\n{3,}/);
  });
});
