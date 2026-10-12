import { describe, expect, it } from "vitest";
import { chunkText, cosine, splitSections, tfidfVectors, topKeywords } from "@/lib/text";
import { heuristicTopics, toFlowchart, toMindmap } from "@/lib/brainmap";
import { buildTree } from "@/lib/store";
import { guessKind } from "@/lib/extract";
import { youtubeId } from "@/lib/youtube";
import type { Material } from "@/lib/types";

describe("text utilities", () => {
  it("chunks long text without losing content", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} about gradient descent and learning rates.`).join("\n\n");
    const chunks = chunkText(text, 300);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
    expect(chunks.join(" ")).toContain("Paragraph 49");
  });

  it("detects headings in markdown, numbered and slide text", () => {
    const s = splitSections("# Intro\nhello\n2.1 Linear Regression\nbody\nSlide 3: Overfitting\n- bias\nNEURAL NETWORKS\nlayers");
    expect(s.map((x) => x.heading)).toEqual(["Intro", "Linear Regression", "Overfitting", "Neural Networks"]);
  });

  it("finds keywords and similarity", () => {
    expect(topKeywords("entropy entropy entropy information gain gain tree")[0]).toBe("entropy");
    const [a, b, c] = tfidfVectors(["neural network backpropagation gradient", "gradient descent for neural networks", "medieval french poetry"]);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
});

describe("ingestion helpers", () => {
  it("guesses material kinds from names", () => {
    expect(guessKind("Final Exam 2023.pdf")).toBe("sample_exam");
    expect(guessKind("week3_tutorial.pdf")).toBe("tutorial");
    expect(guessKind("Lecture 4.pptx")).toBe("slides");
    expect(guessKind("memo.m4a")).toBe("audio_memo");
    expect(guessKind("Lab 2 workshop.docx")).toBe("workshop");
  });
  it("parses YouTube ids", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=abc123XYZ")).toBe("abc123XYZ");
    expect(youtubeId("https://youtu.be/abc123XYZ")).toBe("abc123XYZ");
    expect(youtubeId("https://example.com")).toBeNull();
  });
});

describe("brainmap", () => {
  const m = (id: string, title: string, text: string): Material => ({
    id, course_id: "c", kind: "lecture_notes", title, source_type: "text", filename: null, mime: null, path: null, url: null, text, status: "ready", note: null, created_at: "",
  });

  it("nests a paper's subsections under their sections and names the branch by the paper's title", () => {
    const text = "# Mixed assumed strain methods\n## 1 Introduction\nWhy.\n## 2 Model problem\nSetup.\n### 2.1 Mixed approximations\nSpaces.\n### 2.2 Stability\nInf-sup.\n#### 2.2.1 A detail\nMore.\n## References\n1. A.";
    const topics = heuristicTopics([m("m1", "simo1990", text)]);
    const by = new Map(topics.map((t) => [t.ref, t.title]));
    expect(topics.map((t) => `${t.parent_ref ? by.get(t.parent_ref) : "-"} > ${t.title}`)).toEqual([
      "- > Mixed assumed strain methods",
      "Mixed assumed strain methods > Model problem",
      "Model problem > Mixed approximations",
      "Model problem > Stability",
      "Stability > A detail",
    ]);
  });

  it("leaves the introduction and conclusions out of a paper's topics and mends OCR slips in its headings", () => {
    const text = "# Mixed Jinite element methods\n## 1 Introduction\nWhy.\n## 2 Axis ymmetric problems\nThe axisymmetric case is axisymmetric. Finite elements are finite.\n## 3 Model Problem 11\nModel Problem I and Model Problem II.\n## 4 Conclusions\nDone.";
    const titles = heuristicTopics([m("m1", "simo1990", text)]).map((t) => t.title);
    expect(titles).toEqual(["Mixed finite element methods", "Axisymmetric problems", "Model Problem II"]);
  });

  it("keeps captions and table rows out of a section's summary", () => {
    const text = "# A paper\n## Validation\nTwo composites were modelled, one with the conventional method and another\nTable 5. Properties of cohesive zone between plies.\nGIc (N/mm) K (MPa/mm)\n0.199 0.5 67 105\n\n--- Page 18 ---\nusing the thin-ply method. Both agree with the tests well.";
    const v = heuristicTopics([m("m1", "paper", text)]).find((t) => t.title === "Validation")!;
    expect(v.summary).toBe("Two composites were modelled, one with the conventional method and another using the thin-ply method. Both agree with the tests well.");
  });

  it("reads numbered notes and slides: no title-page topics, references or box labels in summaries", () => {
    const notes = "# Balance Laws\n### Zia Javanbakht\nSchool of Engineering\n### 1 Overview\nThe balance laws considered are:\n- Conservation of mass\n### 2 Tools\nDefinition 2.1 — Cauchy Theorem (Gurtin 1981). The traction depends on the normal only, and linearly so.\n### 3 Mass\nMass is conserved in a closed system.\n### References I\nCook, RD (2002).";
    const topics = heuristicTopics([m("m1", "bal", notes)]);
    expect(topics.map((t) => t.title)).toEqual(["Balance Laws", "Overview", "Tools", "Mass"]);
    expect(topics[0].summary).toBe("The balance laws considered are: Conservation of mass The traction depends on the normal only, and linearly so.");
    expect(topics[2].summary).toBe("The traction depends on the normal only, and linearly so.");
  });

  it("builds an offline topic tree from headings", () => {
    const topics = heuristicTopics([m("m1", "Week 1", "# Supervised learning\nLabels are given.\n# Unsupervised learning\nNo labels.")]);
    expect(topics.map((t) => t.title)).toEqual(["Week 1", "Supervised learning", "Unsupervised learning"]);
    expect(topics[1].parent_ref).toBe(topics[0].ref);
  });

  it("renders valid-looking mermaid with mastery classes", () => {
    const tree = buildTree([
      { id: "a", course_id: "c", parent_id: null, title: 'Root "quoted"', summary: "", keywords: [], material_ids: [], importance: 2, position: 0, mastery: "know", achieved_depth: 0 },
      { id: "b", course_id: "c", parent_id: "a", title: "Child (x)", summary: "", keywords: [], material_ids: [], importance: 2, position: 1, mastery: null, achieved_depth: 0 },
    ]);
    expect(tree[0].children[0].effective_mastery).toBe("know");
    const flow = toFlowchart("ML", tree);
    expect(flow.code).toContain(':::know');
    expect(flow.code).toContain("#34;");
    expect(Object.values(flow.nodeIds)).toEqual(["a", "b"]);
    const big = buildTree(
      Array.from({ length: 60 }, (_, i) => ({
        id: `t${i}`, course_id: "c", parent_id: i < 3 ? null : i < 12 ? `t${i % 3}` : `t${3 + (i % 9)}`, title: `T${i}`, summary: "", keywords: [], material_ids: [], importance: 2, position: i, mastery: null, achieved_depth: 0,
      })),
    );
    const collapsed = toFlowchart("Big", big);
    expect(collapsed.collapsed).toBe(true);
    expect(collapsed.code).toMatch(/\(\+\d+\)/);
    expect(Object.values(collapsed.nodeIds)).not.toContain("t20");
    const focused = toFlowchart("Big", big, { focusId: "t5" });
    expect(Object.values(focused.nodeIds)).toContain("t20"); // a child of t5
    const mind = toMindmap("ML (intro)", tree);
    expect(mind.code).toMatch(/^mindmap/);
    expect(mind.code).not.toMatch(/\(x\)/);
    expect(Object.values(mind.nodeIds)).toEqual(["a", "b"]);
    // The mindmap folds like the flowchart and names topics the same way.
    const bigMind = toMindmap("Big", big, { closed: new Set(["t0"]) });
    expect(bigMind.toggles[Object.entries(bigMind.nodeIds).find(([, t]) => t === "t0")![0]]).toBe("closed");
    expect(Object.values(bigMind.nodeIds)).not.toContain("t3");
    expect(bigMind.code).toMatch(/T0 \+\d+\]/);
  });
});
