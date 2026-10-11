import { describe, expect, it } from "vitest";
import { checkLesson, defuse, lintLesson, mathProblems, normalizeMath } from "@/lib/lessonCheck";
import type { LessonDoc } from "@/lib/lesson";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const doc = (body: string): LessonDoc => ({
  version: 2,
  title: "T",
  depth: 1,
  level: "Survey",
  goal: "g",
  objectives: ["Compute \\(\\omega_n\\)."],
  where_it_fits: "w",
  map: { course: "C", path: [], children: [], before: [], after: [], related: [] },
  recall: [],
  sections: [{ heading: "H", blocks: [{ kind: "note", title: "N", body, figure: { type: "plot", caption: "c", diagram: null, plot: { x_label: "x", y_label: "y", x_min: 0, x_max: 1, y_min: null, y_max: null, curves: [{ expr: "bad(x)", label: "a" }] } } }] }],
  glossary: [],
  common_mistakes: [],
  connections: [],
  check_yourself: [],
  takeaways: [],
  read: [],
  by: "claude",
});

describe("lesson checks", () => {
  it("normalises maths delimiters and spots maths KaTeX can't render", () => {
    expect(normalizeMath("a \\(x\\) and \\[y\\]")).toBe("a $x$ and $$y$$");
    expect(mathProblems("fine $\\frac{a}{b}$ and $$\\begin{aligned}a&=b\\end{aligned}$$")).toEqual([]);
    expect(mathProblems("bad $\\frac{a}{b$")[0]).toMatch(/end of input/);
    expect(mathProblems("costs $5 and more")).toEqual(["unbalanced $ delimiters"]);
  });

  it("strips HTML outside maths only, fixes delimiters and drops figures that can't be drawn", () => {
    const d = doc("<details><summary>Answer</summary>keep $a<b$ and x > y</details>");
    expect(lintLesson(d)).toEqual([]);
    expect(d.sections[0].blocks[0].body).toBe("Answerkeep $a<b$ and x > y");
    expect(d.objectives[0]).toBe("Compute $\\omega_n$.");
    expect(d.sections[0].blocks[0].figure).toBeNull();
  });

  it("shows maths that still won't render as code", async () => {
    expect(defuse("ok $x^2$ but $\\frac{1}{$ here")).toBe("ok $x^2$ but `\\frac{1}{` here");
    const d = await checkLesson(doc("see $\\undefinedmacro{x}$"));
    expect(d.sections[0].blocks[0].body).toBe("see `\\undefinedmacro{x}`");
  });
});
