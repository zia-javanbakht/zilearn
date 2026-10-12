import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { digestToTex, lessonToTex, notesToTex, sectionedTex } from "@/lib/latex";
import { compileTex, firstError, STAND_IN_CLASS, texFileName, texSetup, usesZ } from "@/lib/texPdf";
import type { Digest } from "@/lib/types";

const hasXelatex = spawnSync("xelatex", ["--version"]).status === 0;

describe("LaTeX for notes and summaries", () => {
  it("turns Markdown headings into sections, dropping a title H1", () => {
    const t = sectionedTex("# Damping\n\nIntro text.\n\n## Viscous damping\nBody $\\zeta$.\n\n### Ratio\nMore.\n\n#### Deep\nx\n\n##### Deeper\ny\n\n```\n# not a heading\n```");
    expect(t).not.toContain("Damping}");
    expect(t).toContain("\\section*{Viscous damping}");
    expect(t).toContain("\\subsection*{Ratio}");
    expect(t).toContain("\\subsubsection*{Deep}");
    expect(t).toContain("\\paragraph{Deeper}");
    expect(t).toContain("# not a heading");
    expect(t.indexOf("Intro text")).toBeLessThan(t.indexOf("\\section*"));
    // Several H1s are all sections.
    expect(sectionedTex("# A\nx\n# B\ny")).toMatch(/\\section\*\{A\}[\s\S]*\\section\*\{B\}/);
  });

  it("writes review notes and cheat sheets as Z documents", () => {
    const n = notesToTex({ title: "Week 3 - concise", content: "## Modes\n- one\n- two" }, "Dynamics");
    expect(usesZ(n)).toBe(true);
    expect(n).toContain("\\section*{Modes}");
    expect(n).toContain("Review notes");
    expect(n).not.toContain("multicols");
    expect(notesToTex({ title: "Week 3 - cheatsheet", content: "x" }, "Dynamics")).toContain("\\begin{multicols}{2}");
  });

  it("writes a material's summary with its topics and timestamps", () => {
    const d: Digest = {
      summary: "About **damping**.",
      keywords: ["damping ratio", "Q_factor"],
      topics: [{ title: "Free vibration", start: "01:20", summary: "Decay.", subtopics: [{ title: "Log decrement", start: null, summary: "" }] }],
      by: "ai",
    };
    const t = digestToTex("Lecture 3", "Dynamics", "Lecture notes", d);
    expect(t).toContain("\\begin{blbox}[Summary]");
    expect(t).toContain("Q\\_factor");
    expect(t).toMatch(/\\section\*\{.*\[01:20\].*Free vibration\}/);
    expect(t).toContain("\\subsection*{Log decrement}");
    expect(t).toContain("Summary of the lecture notes");
  });

  it("names files and finds the first LaTeX error", () => {
    expect(texFileName("Damping: ratio & Q!", "-summary")).toBe("Damping-ratio-Q-summary");
    expect(firstError("This is XeTeX\n(./a.tex\n./a.tex:12: Undefined control sequence.\nl.12 \\foo\n")).toMatch(/^\.\/a\.tex:12: Undefined/);
    expect(usesZ("\\documentclass{article}")).toBe(false);
    expect(STAND_IN_CLASS).toContain("\\ProvidesClass{Z}");
  });
});

describe.skipIf(!hasXelatex)("compiling to PDF", () => {
  const notes = notesToTex(
    { title: "Damping - concise", content: "# Damping\n## Ratio\nThe ratio $\\zeta = c/c_c$ → decay ≈ fast.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n1. one\n2. two" },
    "Dynamics",
  );

  it("compiles with the stand-in class", async () => {
    const r = await compileTex(notes, "notes", { standIn: true });
    expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.note).toMatch(/stand-in/);
  }, 120_000);

  it("compiles a lesson with whatever Z setup this computer has", async () => {
    const setup = await texSetup(true);
    const lesson = lessonToTex({
      title: "Damping",
      depth: 2,
      level: "Understand",
      goal: "",
      map: { course: "Dynamics", path: ["Vibration"] },
      objectives: ["Explain $\\zeta$"],
      where_it_fits: "After free vibration.",
      recall: [],
      sections: [{ heading: "Ratio", blocks: [{ kind: "definition", title: "Damping ratio", body: "$\\zeta = c / c_c$" }, { kind: "pitfall", title: "Units", body: "It has none." }] }],
      glossary: [],
      common_mistakes: [],
      connections: [],
      check_yourself: [],
      takeaways: ["Light damping decays slowly."],
      read: [],
    } as unknown as Parameters<typeof lessonToTex>[0]);
    const r = await compileTex(lesson, "lesson");
    expect(r.pdf.length).toBeGreaterThan(1000);
    // With Z found the PDF is made with Z, so there is no note; without it the stand-in says so.
    expect(r.note === null).toBe(setup.z.found);
  }, 180_000);
});
