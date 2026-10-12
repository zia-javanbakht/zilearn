import { describe, expect, it } from "vitest";
import { badge, conceptMermaid, framingProblems, homes, linksFromText, mentions, tidyTerms } from "@/lib/lessonTerms";
import type { LessonDoc } from "@/lib/lesson";

const doc = (over: Partial<LessonDoc> = {}): LessonDoc => ({
  version: 2,
  title: "Damped free vibration",
  depth: 2,
  level: "Understand",
  goal: "How it works",
  objectives: [],
  where_it_fits: "",
  map: { course: "Dynamics", path: [], children: [], before: [], after: [], related: [] },
  recall: [],
  sections: [
    {
      heading: "Why the motion dies out",
      terms: ["Damping ratio"],
      blocks: [{ kind: "intuition", title: "Energy leaks away", body: "The **damping ratio** $\\zeta$ compares the damping with **critical damping**: $\\zeta = c/c_{cr}$." }],
    },
    {
      heading: "Measuring it",
      terms: ["logarithmic decrement $\\delta$"],
      blocks: [{ kind: "procedure", title: "From the peaks", body: "The **logarithmic decrement** measures the damping ratio from two successive peaks." }],
    },
  ],
  glossary: [
    { term: "damping ratio $\\zeta$", meaning: "c over c_cr" },
    { term: "critical damping", meaning: "the smallest damping with no oscillation" },
    { term: "logarithmic decrement $\\delta$", meaning: "ln of the peak ratio" },
    { term: "resonance", meaning: "never mentioned" },
  ],
  common_mistakes: [],
  connections: [],
  check_yourself: [],
  takeaways: [],
  read: [],
  concept_links: [
    { from: "damping ratio $\\zeta$", to: "critical damping", label: "compares damping with" },
    { from: "Logarithmic decrement $\\delta$", to: "damping ratio $\\zeta$", label: "measures" },
    { from: "critical damping", to: "logarithmic decrement $\\delta$", label: "never said together" },
  ],
  by: "claude",
  ...over,
});

describe("key terms", () => {
  it("finds a term by its words or its symbol, not by scattered words", () => {
    expect(mentions("The damping ratios of frames", "damping ratio")).toBe(true);
    expect(mentions("we write $\\zeta$ for it", "damping ratio $\\zeta$")).toBe(true);
    expect(mentions("Damping matters. The ratio of peaks is constant, and a long way further on we see more.", "damping ratio")).toBe(false);
  });

  it("puts each term in the section that teaches it and keeps only links the text states", () => {
    const d = tidyTerms(doc());
    expect(d.sections.map((x) => x.terms)).toEqual([["damping ratio $\\zeta$", "critical damping"], ["logarithmic decrement $\\delta$"]]);
    expect(d.concept_links).toEqual([
      { from: "damping ratio $\\zeta$", to: "critical damping", label: "compares damping with" },
      { from: "logarithmic decrement $\\delta$", to: "damping ratio $\\zeta$", label: "measures" },
    ]);
    expect(homes(d).has("resonance")).toBe(false);
    expect(framingProblems(d).join(" ")).toMatch(/"resonance" is in the glossary but no section uses it/);
  });

  it("reads links off sentences that join two terms", () => {
    expect(linksFromText(doc(), ["logarithmic decrement", "damping ratio"])).toEqual([{ from: "logarithmic decrement", to: "damping ratio", label: "measures the" }]);
  });

  it("draws the concept map grouped by numbered section, with jumps to the sections", () => {
    const m = conceptMermaid(tidyTerms(doc()));
    expect(m).toContain(`subgraph s0["${badge(1)} Why the motion dies out"]`);
    expect(m).toContain('k0["damping ratio ζ"]');
    expect(m).toContain('k2 -->|"measures"| k0');
    expect(m).toContain(`%% jump k2 ${badge(2)}`);
  });

  it("flags a diagram whose boxes the text never mentions", () => {
    const d = doc();
    d.sections[1].blocks[0].figure = {
      type: "diagram",
      caption: "The test",
      plot: null,
      diagram: { direction: "LR", nodes: [{ id: "a", label: "Pluck" }, { id: "b", label: "Accelerometer" }, { id: "c", label: "Spectrum" }], edges: [] },
    };
    expect(framingProblems(d).some((p) => p.includes("Accelerometer"))).toBe(true);
  });
});
