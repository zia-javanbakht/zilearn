import { describe, expect, it } from "vitest";
import { badge, cleanLabel, conceptMermaid, echoesList, framingProblems, homes, linksFromText, mainTerms, mapGroups, mentions, repeats, shortHeading, tidyTerms } from "@/lib/lessonTerms";
import { spoilers } from "@/lib/lessonCheck";
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

  it("drops links that say what doesn't happen, or that no block states, and says why", () => {
    const d = tidyTerms(doc({ concept_links: [{ from: "damping ratio $\\zeta$", to: "critical damping", label: "does not change" }, { from: "critical damping", to: "logarithmic decrement $\\delta$", label: "removes the peaks of" }] }));
    expect(d.concept_links?.some((l) => l.label === "does not change")).toBe(false);
    const p = framingProblems(d).join("\n");
    expect(p).toMatch(/"damping ratio ζ does not change critical damping" is off the map because it states a negative/);
    expect(p).toMatch(/"critical damping removes the peaks of logarithmic decrement δ" is off the map because no section discusses both terms/);
  });


  it("finds the main key terms and flags a missing one and a map in pieces", () => {
    const d = tidyTerms(doc({ keywords: ["damping ratio", "critical damping", "damped natural frequency"], concept_links: [] }));
    d.concept_links = [{ from: "damping ratio $\\zeta$", to: "critical damping", label: "compares damping with" }];
    expect(mainTerms(d)).toEqual(["damping ratio $\\zeta$", "critical damping"]);
    expect(mapGroups(d)).toEqual([["damping ratio $\\zeta$", "critical damping"], ["logarithmic decrement $\\delta$"]]);
    const p = framingProblems(d).join("\n");
    expect(p).toMatch(/main key term "damped natural frequency" is missing/);
    expect(p).toMatch(/falls apart into 2 unconnected groups/);
    expect(conceptMermaid(d)).toContain("class k0,k1 main");
  });

  it("flags the app's own words, a dashed curve that isn't, and text over budget", () => {
    const d = doc();
    d.sections[0].blocks[0].body += " The exam needs level 3, so this is a faded example.";
    d.sections[1].blocks[0].figure = { type: "plot", caption: "The envelope (dashed) bounds the response.", diagram: null, plot: { x_label: "t", y_label: "u", x_min: 0, x_max: 1, y_min: null, y_max: null, curves: [{ expr: "x", label: "u" }] } };
    const p = framingProblems(d, { budget: 10 }).join("\n");
    expect(p).toMatch(/"level 3" is the app's own word/);
    expect(p).toMatch(/mentions a dashed curve/);
    expect(p).toMatch(/over this level's 10/);
  });

  it("catches a sentence or a derivation an earlier level already gave", () => {
    const early = doc({ depth: 1 });
    early.sections[0].blocks[0].body = "Each cycle the amplitude shrinks by about twelve percent when the damping ratio is two percent, which is typical for steel frames. $$\\delta = 2\\pi\\zeta$$ $$u = e^{-\\zeta\\omega_n t}$$";
    const now = doc();
    now.sections[1].blocks[0].body = "For steel frames, the amplitude shrinks by about twelve percent each cycle when the damping ratio is two percent.";
    expect(repeats(now, [early])[0]).toMatch(/repeats what level 1 already said/);
    now.sections[1].blocks[0].body = "Again: $$\\delta = 2\\pi\\zeta$$ and $$u = e^{-\\zeta\\omega_n t}$$";
    expect(repeats(now, [early])[0]).toMatch(/redoes 2 equations from level 1/);
  });

  it("shortens a long heading at a word for the map", () => {
    expect(shortHeading("Measuring damping from a free-vibration record in the lab")).toBe("Measuring damping from a…");
    expect(shortHeading("Short one")).toBe("Short one");
  });

  it("draws maths subscripts the app can't write in Unicode as HTML", () => {
    const d = tidyTerms(doc({ glossary: [{ term: "damping ratio $\\zeta$", meaning: "" }, { term: "critical damping $c_{cr}$", meaning: "" }] }));
    expect(conceptMermaid(d)).toContain('"critical damping c<sub>cr</sub>"');
  });

  it("flags an example that copies the setup and wording of the student's own question", () => {
    const d = doc();
    d.sections[1].blocks.push({
      kind: "example",
      title: "A rooftop sign",
      body: "A sign frame has mass 2 t and lateral stiffness 900 kN/m. A pull-back test displaces the top 40 mm and releases it. After 8 complete cycles the amplitude is 9 mm. Find the damping ratio.",
      solution: "1. ...",
    });
    const q = { source: "Tutorial 3, Q1", text: "A one-storey frame has mass 20 t and lateral stiffness 8000 kN/m. A pull-back test displaces the roof 25 mm and releases it. After 5 complete cycles the amplitude is 12 mm. (a) Find the natural period. (b) Find the damping ratio." };
    expect(spoilers(d, [q])).toEqual([expect.objectContaining({ kind: "wording", source: "Tutorial 3, Q1" })]);
  });

  it("tidies link labels: raw subscripts as maths, no trailing article", () => {
    expect(cleanLabel("holds at ω_n the")).toBe("holds at $ω_{n}$");
    expect(cleanLabel("is about $2\\pi$ times")).toBe("is about $2\\pi$ times");
  });

  it("spots a diagram that only redraws its block's list", () => {
    const b = {
      kind: "keypoint" as const,
      title: "Three kinds of response",
      body: "- **Underdamped**: oscillates and decays\n- **Critically damped**: fastest return\n- **Overdamped**: slow return",
      figure: { type: "diagram" as const, caption: "", plot: null, diagram: { direction: "TD" as const, nodes: [{ id: "a", label: "Underdamped" }, { id: "b", label: "Critically damped" }, { id: "c", label: "Overdamped" }], edges: [] } },
    };
    expect(echoesList(b)).toBe(true);
    expect(echoesList({ ...b, body: "Three cases follow from the sign under the root." })).toBe(false);
  });

  it("flags a question its own list of mistakes answers, and a mistake that repeats a pitfall", () => {
    const d = doc({
      common_mistakes: [{ mistake: "Thinking a heavier damper always makes the structure oscillate faster after release", correction: "Damping lowers the frequency of oscillation slightly, so the damped period is longer" }],
      check_yourself: [{ question: "Does a heavier damper make the structure oscillate faster after release?", answer: "No: damping lowers the frequency of oscillation slightly, so the damped period is longer." }],
    });
    d.sections[0].blocks.push({ kind: "pitfall", title: "Faster with more damping?", body: "A heavier damper does not make the structure oscillate faster after release: damping lowers the frequency slightly, so the damped period is longer." });
    const p = framingProblems(d).join("\n");
    expect(p).toMatch(/check_yourself.0 is answered by common_mistakes.0/);
    expect(p).toMatch(/common_mistakes.0 repeats the pitfall "Faster with more damping\?"/);
  });

  it("writes accents in map labels as Unicode", async () => {
    const { plainLabel } = await import("@/lib/figure");
    expect(plainLabel("initial conditions $u(0), \\dot u(0)$")).toBe("initial conditions u(0), u\u0307(0)");
    expect(plainLabel("$\\ddot{x}$")).toBe("x\u0308");
  });
});
