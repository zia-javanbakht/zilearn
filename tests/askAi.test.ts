import { describe, expect, it, vi } from "vitest";
import { dynamicsCourse } from "./fixtures/dynamics";

const calls: string[] = [];
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  aiEnabled: () => true,
  generateText: async (o: { prompt: string }) => {
    calls.push(o.prompt);
    return { text: "Damping is measured from the decay of peaks [1]. It is about $2\\pi\\zeta$ [1][9]. See [2-3].", truncated: false };
  },
}));

describe("Ask this course with an AI", () => {
  it("sends numbered passages and the conversation, and keeps only real citations", async () => {
    const { answerQuestion } = await import("@/lib/ask");
    const { course } = dynamicsCourse();
    const a = await answerQuestion(course.id, "How is damping measured?", [
      { role: "user", content: "What is damping?" },
      { role: "assistant", content: "Energy loss [4]." },
    ]);
    expect(a.by).toBe("claude");
    expect(calls[0]).toMatch(/<passage n="1"/);
    expect(calls[0]).toContain("You: Energy loss.");
    expect(a.text).toBe("Damping is measured from the decay of peaks [1]. It is about $2\\pi\\zeta$ [1]. See [2][3].");
    expect(a.citations.map((c) => c.n)).toEqual([1, 2, 3]);
  });
});
