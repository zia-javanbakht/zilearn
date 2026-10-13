import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { extractFile } from "@/lib/extract";
import { authorKeywords, evidenceFor, groundTerms, keyTerms, keywordMap, termLabel } from "@/lib/keywords";
import { offlineDigest } from "@/lib/digest";
import { heuristicTopics } from "@/lib/brainmap";
import type { Material } from "@/lib/types";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

// Abdellahi et al. 2024: a journal paper with author keywords, acronyms, an appendix and the usual back
// matter (declarations, funding, ORCID, references) that isn't subject content.
let paper = "";
beforeAll(async () => {
  paper = (await extractFile(fs.readFileSync("tests/fixtures/papers/abs2024.pdf"), "abs2024.pdf", "application/pdf")).text;
}, 120_000);

const flat = (s: string) => s.replace(/\s+/g, " ");

describe("key terms of a paper", () => {
  it("reads the author's keywords", () => {
    expect(authorKeywords(paper)).toEqual(["Pseudo-ductile composite", "finite element model", "micro-mechanical model", "multiscale model"]);
  });

  it("finds the subject's terms, with their acronyms, and nothing from the title page or back matter", () => {
    const terms = keyTerms(paper);
    const names = terms.map((t) => t.term.toLowerCase());
    expect(names.slice(0, 5)).toEqual(expect.arrayContaining(["pseudo-ductile composites", "representative volume element", "periodic boundary conditions"]));
    expect(terms.find((t) => t.term === "representative volume element")?.aliases).toContain("RVE");
    expect(terms.find((t) => t.term === "periodic boundary conditions")?.aliases).toContain("PBC");
    for (const junk of ["monash", "university", "civil engineering", "conflicting", "financial support", "orcid", "publication", "netravali"])
      expect(names.filter((n) => n.includes(junk))).toEqual([]);
    // A generic word on its own says nothing about the subject.
    // A phrase always written after "low" or "high" is part of those terms, not a term of its own.
    expect(names).not.toContain("strain material");
    for (const generic of ["model", "results", "fibers", "behavior", "high", "low", "different", "proposed", "study", "composite"]) expect(names).not.toContain(generic);
  });

  it("maps the terms and quotes what the paper says about each, with the section it says it in", () => {
    const map = keywordMap(paper);
    expect(map.length).toBeGreaterThanOrEqual(4);
    expect(map.length).toBeLessThanOrEqual(7);
    const all = map.flatMap((n) => [n, ...n.children]);
    expect(all.length).toBeGreaterThanOrEqual(12);
    const text = flat(paper);
    for (const n of all) {
      expect(n.evidence.length).toBeGreaterThan(0);
      expect(n.note).toBe(n.evidence[0].text);
      // Quotes are the paper's own sentences (citation marks aside; a sentence a figure cut in two is joined again).
      for (const e of n.evidence) {
        const w = e.text.split(" ");
        expect(text.includes(w.slice(0, 3).join(" ")) || text.includes(w.slice(-3).join(" "))).toBe(true);
      }
    }
    const pbc = all.find((n) => n.term === "periodic boundary conditions")!;
    expect(pbc.note).toMatch(/Periodic boundary conditions \(PBCs\) were applied/);
    expect(termLabel(pbc.term, pbc.aliases)).toBe("Periodic boundary conditions (PBC)");
    // The quotes say where: a section of the paper, or its abstract.
    expect(all.every((n) => n.evidence.every((e) => e.where && !/^(references|funding)/i.test(e.where)))).toBe(true);
  });

  it("makes the material's digest a keyword map, not its section list", () => {
    const d = offlineDigest(paper);
    expect(d.basis).toBe("keywords");
    const titles = d.topics.map((t) => t.title);
    for (const section of ["Introduction", "Conclusion", "Results and discussion"]) expect(titles).not.toContain(section);
    expect(titles.some((t) => /^Prediction of the failure/.test(t))).toBe(false);
    expect(titles).toContain("Representative volume element (RVE)");
    // The abstract, without its label or citation numbers, is the summary.
    expect(d.summary).toMatch(/^The hybridization technique has recently been used/);
  });
});

describe("terms from the AI", () => {
  const text = "# Notes\n\n## Damping\n\nViscous damping (VD) removes energy in proportion to velocity. The damping ratio sets how fast the free response decays. Critical damping is the smallest damping with no oscillation.\n";
  it("keeps only terms the material uses, nests them under their main term and quotes the material", () => {
    const nodes = groundTerms(text, [
      { term: "Viscous damping", parent: null, note: "Energy loss proportional to velocity.", start: null },
      { term: "Damping ratio", parent: "Viscous damping", note: "", start: null },
      { term: "Critical damping", parent: "damping ratio", note: "No oscillation.", start: null },
      { term: "Coulomb friction", parent: null, note: "Not in the notes.", start: null },
    ]);
    expect(nodes.map((n) => n.term)).toEqual(["Viscous damping"]);
    expect(nodes[0].aliases).toContain("VD");
    // Two levels: a term under a sub-term goes under the main term.
    expect(nodes[0].children.map((c) => c.term)).toEqual(["Damping ratio", "Critical damping"]);
    expect(nodes[0].children[0].note).toBe("The damping ratio sets how fast the free response decays.");
    expect(nodes[0].evidence[0]).toMatchObject({ text: "Viscous damping (VD) removes energy in proportion to velocity.", where: "Damping" });
    expect(evidenceFor(text, "critical damping")[0].text).toMatch(/^Critical damping is the smallest/);
  });
});

describe("the course map follows the student's keyword map", () => {
  it("uses an edited map's terms and leaves out what the student deleted", () => {
    const d = offlineDigest(paper);
    const kept = d.topics.slice(0, 2);
    const edited = { ...d, topics: [...kept, { title: "My own term", start: null, summary: "Added by me.", subtopics: [] }], edited: true };
    const m = { id: "m1", course_id: "c", kind: "paper", title: "abs2024", text: paper, digest: edited } as unknown as Material;
    const topics = heuristicTopics([m]);
    // The main terms are the brainmap's branches; no branch for the paper itself.
    const branches = topics.filter((t) => !t.parent_ref).map((t) => t.title);
    expect(branches).toEqual([...kept.map((t) => t.title), "My own term"]);
    // The terms under each main term are its sub-branches.
    const first = topics.find((t) => t.title === kept[0].title)!;
    expect(topics.filter((t) => t.parent_ref === first.ref).map((t) => t.title)).toEqual((kept[0].subtopics ?? []).map((s) => s.title));
    const dropped = d.topics.slice(2).map((t) => t.title);
    expect(topics.filter((t) => dropped.includes(t.title))).toEqual([]);
    // Notes say where the paper says it.
    expect(topics.find((t) => t.title === kept[0].title)?.summary).toMatch(/\((Abstract|Introduction|[A-Z][^)]+)\)$/);
  });
});
