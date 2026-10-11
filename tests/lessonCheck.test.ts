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
    expect(mathProblems("costs $5 and more")).toEqual(["stray $ (unbalanced, or a space just inside the delimiters)"]);
    expect(mathProblems("Units: $\\text{kg} \\times \\text{rad/s} = $ N s/m")).toHaveLength(1);
    expect(defuse("Units: $\\text{kg} \\times \\text{rad/s} = $ N s/m")).toBe("Units: $\\text{kg} \\times \\text{rad/s} =$ N s/m");
    expect(defuse("costs $5 and more")).toBe("costs \\$5 and more");
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

describe("spoilers", () => {
  it("finds examples and questions that reuse the student's own tutorial question, and drops them when they can't be rewritten", async () => {
    const { spoilers, checkLesson } = await import("@/lib/lessonCheck");
    const { sourceQuestions } = await import("@/lib/lessonOffline");
    const qs = sourceQuestions([{ title: "Tutorial 3", kind: "tutorial", text: "Q1. A frame of mass 120 t is pulled back 25 mm; after 5 cycles the amplitude is 12 mm. Find the damping ratio.\nQ2. Explain critical damping." }]);
    expect(qs.map((q) => q.source)).toEqual(["Tutorial 3, Q1", "Tutorial 3, Q2"]);
    const doc = {
      version: 2, title: "T", depth: 3, level: "Apply", goal: "", by: "claude",
      map: { course: "C", path: [], before: [], after: [], children: [], related: [] },
      objectives: [], where_it_fits: "", recall: [], glossary: [], common_mistakes: [], connections: [], takeaways: [], read: [],
      sections: [{ heading: "Worked", blocks: [
        { kind: "example", title: "Pull-back test", body: "A 120 t frame is pulled back 25 mm and after 5 cycles reads 12 mm. Find $\\zeta$.", solution: "Steps", source: null, figure: null },
        { kind: "example", title: "Fresh one", body: "A 40 t frame is pulled back 30 mm and after 4 cycles reads 18 mm.", solution: "Steps", source: null, figure: null },
      ] }],
      check_yourself: [{ question: "Pulled back 25 mm, 12 mm after 5 cycles: what is the damping ratio?", answer: "0.023", kind: "apply", hint: null }],
    } as never;
    const sp = spoilers(doc, qs);
    expect(sp.map((x) => x.paths[0])).toEqual(["sections.0.blocks.0.body", "check_yourself.0.question"]);
    const out = await checkLesson(doc, qs);
    expect(out.sections[0].blocks.map((b) => b.title)).toEqual(["Fresh one"]);
    expect(out.check_yourself).toEqual([]);
  });
});

describe("provenance and referee", () => {
  it("marks AI blocks without a source as beyond the notes, and skips the referee offline", async () => {
    const { markProvenance, lessonToMarkdown } = await import("@/lib/lesson");
    const { refereeLesson } = await import("@/lib/lessonCheck");
    const d = doc("Body");
    d.sections[0].blocks.push({ kind: "note", title: "Cited", body: "From the notes.", source: "Lecture 3 notes" });
    const marked = markProvenance(d);
    expect(marked.sections[0].blocks.map((b) => b.source)).toEqual(["Beyond your notes", "Lecture 3 notes"]);
    expect(lessonToMarkdown(d)).toContain("📚 Beyond your notes");
    expect(markProvenance({ ...d, by: "heuristic" }).sections[0].blocks[0].source ?? null).toBeNull();
    expect(await refereeLesson(d, "")).toEqual([]);
  });
});
