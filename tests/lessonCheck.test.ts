import { describe, expect, it } from "vitest";
import { applyReferee, beyondShare, checkLesson, defuse, unescapeNewlines, equationGaps, equationRefs, lintLesson, mathProblems, metaProblems, normalizeMath, refereePrompt } from "@/lib/lessonCheck";
import { capGlossary } from "@/lib/lesson";
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

  it("checks diagram labels like body text and turns HTML sub- and superscripts into maths", () => {
    const d = doc("b");
    d.sections[0].blocks[0].figure = {
      type: "diagram",
      caption: "c",
      plot: null,
      diagram: { direction: "LR", nodes: [{ id: "a", label: "∫<sub>S_p</sub>σ·n̂ dA" }, { id: "b", label: "bad $\\frac{a}{b$" }], edges: [{ from: "a", to: "b", label: "F<sup>int</sup>" }] },
    };
    const problems = lintLesson(d);
    expect(problems.map((p) => p.path)).toEqual(["sections.0.blocks.0.figure.diagram.nodes.1.label"]);
    const g = d.sections[0].blocks[0].figure!.diagram!;
    expect(g.nodes[0].label).toBe("∫$_{S_p}$σ·n̂ dA");
    expect(g.edges[0].label).toBe("F$^{int}$");
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

describe("referee corrections", () => {
  const withQuestions = () => {
    const d = doc("Text");
    d.objectives = ["Explain the weak form.", "Compute the tangent."];
    d.check_yourself = [{ question: "Why?", answer: "Because.", kind: "explain", hint: null, objective: 1 }];
    return d;
  };

  it("adds a question at the next number, sets objective tags, and reports fields that don't exist", () => {
    const d = withQuestions();
    expect(refereePrompt(d)).toContain('path="check_yourself.0.objective"');
    const done = applyReferee(d, [
      { path: "check_yourself.1.question", problem: "objective 2 untested", text: "Find $K_T$ for $\\Psi = \\tfrac12 K E^2$." },
      { path: "check_yourself.1.answer", problem: "objective 2 untested", text: "$K_T = \\ldots$" },
      { path: "check_yourself.1.objective", problem: "tag it", text: "2" },
      { path: "check_yourself.0.objective", problem: "out of range", text: "7" },
      { path: "sections.4.blocks.0.body", problem: "no such section", text: "x" },
      { path: "check_yourself.5.question", problem: "skips a number", text: "x" },
    ]);
    expect(d.check_yourself).toHaveLength(2);
    expect(d.check_yourself[1]).toMatchObject({ question: "Find $K_T$ for $\\Psi = \\tfrac12 K E^2$.", answer: "$K_T = \\ldots$", objective: 2 });
    expect(d.check_yourself[0].objective).toBeNull();
    expect(done.filter((x) => x.startsWith("not applied"))).toEqual(["not applied, sections.4.blocks.0.body: no such section", "not applied, check_yourself.5.question: skips a number"]);
  });

  it("drops a question added without its answer", () => {
    const d = withQuestions();
    applyReferee(d, [{ path: "check_yourself.1.question", problem: "half", text: "What is $J$?" }]);
    expect(d.check_yourself).toHaveLength(1);
  });

  it("asks the referee to check numbered references, quoted equations and conflicts in the sources", () => {
    const p = refereePrompt(withQuestions());
    expect(p).toMatch(/"Section 4", "eq\. \(12\)", "Table 2"/);
    expect(p).toMatch(/\\tag\{n\}/);
    expect(p).toMatch(/Disagreements within the sources/);
    expect(p).toMatch(/simplify the sources' model/);
  });
});

describe("source equations and meta text", () => {
  it("reads equation references", () => {
    expect(equationRefs("the three Euler equations (5)-(6), eq. (12) and Eqs. 2 and 3; see Table 4 (9)")).toEqual([2, 3, 5, 6, 12]);
  });

  it("asks for equations the lesson or the topic summary name but never write", () => {
    const d = doc("The weak form follows from the Euler equations (5) and the split of eq. (7):\n\n$$\\delta\\varepsilon = \\nabla^s\\eta + \\tilde\\gamma \\tag{7}$$");
    const [msg] = equationGaps(d, "States the Hu-Washizu principle, eqs. (2)-(3).");
    expect(msg).toMatch(/lesson and the topic summary refer to eq\. \(2\), \(3\), \(5\)/);
    expect(msg).not.toMatch(/\(7\)/);
    expect(equationGaps(doc("No equations named here."))).toEqual([]);
  });

  it("flags text about extraction, PDFs and OCR", () => {
    const [msg] = metaProblems(doc("The strength follows a Weibull law (the extracted text flattens this equation)."));
    expect(msg).toMatch(/sections\.0\.blocks\.0\.body talks about "extracted text"/);
    expect(metaProblems(doc("The strength follows a Weibull law."))).toEqual([]);
  });

  it("flags remarks about numbering and lessons mostly from beyond the notes", () => {
    const [msg] = metaProblems(doc("The Jacobian is $J = \\partial(x,y)/\\partial(\\xi,\\eta)$. (Definition 1.2 is not numbered as an equation in your notes.)"));
    expect(msg).toMatch(/drop the remark/);
    const d = doc("x");
    d.sections[0].blocks = [1, 2, 3, 4, 5].map((n) => ({ kind: "note" as const, title: `B${n}`, body: "b", source: n === 1 ? "Notes, Definition 1.2" : null }));
    expect(beyondShare(d)[0]).toMatch(/^4 of 5 blocks have no source/);
    d.sections[0].blocks.forEach((b, i) => (b.source = i < 3 ? "Notes" : null));
    expect(beyondShare(d)).toEqual([]);
  });

  it("adds a key term at the next number", () => {
    const d = doc("x");
    d.glossary = [{ term: "patch test", meaning: "m" }];
    applyReferee(d, [
      { path: "glossary.1.term", problem: "main term missing", text: "enhanced strain $\\tilde{\\varepsilon}$" },
      { path: "glossary.1.meaning", problem: "main term missing", text: "The added strain field." },
    ]);
    expect(d.glossary).toEqual([{ term: "patch test", meaning: "m" }, { term: "enhanced strain $\\tilde{\\varepsilon}$", meaning: "The added strain field." }]);
  });

  it("never cuts a main key term from the glossary", () => {
    const g = ["fibre", "matrix", "ply", "pseudo-ductility", "fragmentation", "delamination"].map((term) => ({ term, meaning: "m" }));
    expect(capGlossary(g, 4, ["fragmentation", "delamination"]).map((x) => x.term)).toEqual(["fibre", "matrix", "fragmentation", "delamination"]);
  });
});

describe("model output repairs", () => {
  it("turns a literal backslash-n into a line break, but not in LaTeX commands", () => {
    expect(unescapeNewlines("| a | b |\\n|---|---|\\n1. Step\\n2. $\\nabla u \\neq \\nu$ and $a \\\\n_1$")).toBe("| a | b |\n|---|---|\n1. Step\n2. $\\nabla u \\neq \\nu$ and $a \\\\n_1$");
  });

  it("lets the referee add a concept-map link", () => {
    const d = doc("x");
    d.concept_links = [];
    applyReferee(d, [
      { path: "concept_links.0.from", problem: "map split", text: "fragmentation" },
      { path: "concept_links.0.to", problem: "map split", text: "pseudo-ductility" },
      { path: "concept_links.0.label", problem: "map split", text: "produces the plateau of" },
      { path: "concept_links.1.from", problem: "half a link", text: "matrix" },
    ]);
    expect(d.concept_links).toEqual([{ from: "fragmentation", to: "pseudo-ductility", label: "produces the plateau of" }]);
  });
});
