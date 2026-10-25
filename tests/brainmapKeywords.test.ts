import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { openDb, setDb } from "@/lib/db";
import { createCourse, getMaterial, insertMaterial, setDigest } from "@/lib/store";
import { extractFile } from "@/lib/extract";
import type { Digest, Material } from "@/lib/types";

const ai = { on: false, generateStructured: vi.fn() };
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  aiEnabled: () => ai.on,
  generateStructured: (...a: unknown[]) => ai.generateStructured(...a),
}));

const { structureCourse, heuristicTopics } = await import("@/lib/brainmap");
const { digestNow, listMaterialsWithMaps, offlineDigest } = await import("@/lib/digest");

beforeEach(() => {
  setDb(openDb(":memory:"));
  ai.on = false;
  ai.generateStructured.mockReset();
});

// Abdellahi et al. 2024, the paper the brainmap must be built from by its key terms.
let paper = "";
beforeAll(async () => {
  paper = (await extractFile(fs.readFileSync("tests/fixtures/papers/abs2024.pdf"), "abs2024.pdf", "application/pdf")).text;
}, 120_000);

const material = (id: string, title: string, text: string, digest: Digest | null): Material =>
  ({ id, course_id: "c", kind: "pdf", title, source_type: "file", filename: null, mime: null, path: null, url: null, text, status: "ready", note: null, created_at: "", digest }) as unknown as Material;
const course = { id: "c", name: "Composites", code: null, description: null } as never;

describe("the course brainmap is built from key terms", () => {
  it("makes the paper's main terms the branches and the terms under them the sub-branches", async () => {
    const d = offlineDigest(paper);
    const { topics, by } = await structureCourse(course, [material("m1", "abs2024", paper, d)]);
    expect(by).toBe("heuristic");
    // Every main term is a branch; with this many, the paper's sections gather them.
    const terms = topics.filter((t) => t.ref.startsWith("K") && !t.ref.includes("."));
    expect(terms.map((t) => t.title).sort()).toEqual(d.topics.map((t) => t.title).sort());
    expect(terms.map((t) => t.title)).toEqual(expect.arrayContaining(["Representative volume element (RVE)", "Periodic boundary conditions (PBC)"]));
    const sections = topics.filter((t) => t.ref.startsWith("S"));
    expect(sections.length).toBeGreaterThanOrEqual(2);
    // Each section holds terms, directly or in its subsections.
    const under = (ref: string): string[] => topics.filter((t) => t.parent_ref === ref).flatMap((t) => [t.ref, ...under(t.ref)]);
    for (const g of sections.filter((t) => !t.parent_ref)) expect(under(g.ref).filter((r) => r.startsWith("K")).length).toBeGreaterThanOrEqual(1);
    // No branch for the paper itself, its title, or the introduction and conclusion that frame it.
    for (const t of topics) expect(t.title).not.toMatch(/^(Introduction|Conclusions?|Prediction of the failure|abs2024)/);
    const pdc = terms.find((t) => /^Pseudo-ductile composites/.test(t.title))!;
    expect(topics.filter((t) => t.parent_ref === pdc.ref).length).toBeGreaterThanOrEqual(2);
    // Each branch says what the paper says about the term, and where.
    expect(pdc.summary).toMatch(/ \(see “[A-Z][^”]*”\)$/);
  });

  it("merges a term two items share into one branch that cites both", () => {
    const a: Digest = { summary: "", keywords: [], by: "offline", basis: "keywords", topics: [{ title: "Finite element (FE)", start: null, summary: "FE splits the body.", subtopics: [{ title: "Shape functions", start: null, summary: "They interpolate." }] }, { title: "Damping", start: null, summary: "Energy loss." }] };
    const b: Digest = { summary: "", keywords: [], by: "offline", basis: "keywords", topics: [{ title: "finite elements", start: null, summary: "Elements again.", subtopics: [{ title: "Gauss quadrature", start: null, summary: "Integrates." }] }] };
    const topics = heuristicTopics([material("a", "L1", "x", a), material("b", "L2", "y", b)]);
    const tops = topics.filter((t) => !t.parent_ref);
    expect(tops.map((t) => t.title)).toEqual(["Finite element (FE)", "Damping"]);
    expect(tops[0].material_ids).toEqual(["a", "b"]);
    expect(topics.filter((t) => t.parent_ref === tops[0].ref).map((t) => t.title)).toEqual(["Shape functions", "Gauss quadrature"]);
  });

  it("with AI, keeps the key terms as the branches and only describes and groups them", async () => {
    ai.on = true;
    const d = offlineDigest(paper);
    // The AI gathers the terms itself: it is given them without the sections.
    const base = heuristicTopics([material("m1", "abs2024", paper, d)], { gather: false });
    const [k0, k1] = base.filter((t) => !t.parent_ref);
    ai.generateStructured.mockResolvedValue({
      course_summary: "How pseudo-ductile composites fail, modelled at two scales.",
      groups: [{ title: "Composite behaviour", summary: "What the composites do.", members: [k0.ref, k1.ref] }],
      topics: [
        { id: k0.ref, summary: "Composites that fail gradually.", importance: 3 },
        { id: "nonsense", summary: "Dropped.", importance: 3 },
      ],
    });
    const { topics, summary, by } = await structureCourse(course, [material("m1", "abs2024", paper, d)]);
    expect(by).toBe("claude");
    expect(summary).toMatch(/^How pseudo-ductile/);
    // Same terms as without AI, plus the group; no term renamed, added or dropped.
    expect(topics.filter((t) => !t.ref.startsWith("G")).map((t) => t.title)).toEqual(base.map((t) => t.title));
    const g = topics.find((t) => t.title === "Composite behaviour")!;
    expect(topics.filter((t) => t.parent_ref === g.ref).map((t) => t.title)).toEqual([k0.title, k1.title]);
    expect(topics.find((t) => t.ref === k0.ref)!.summary).toBe("Composites that fail gradually.");
    // A branch the AI said nothing about keeps the paper's sentence.
    expect(topics.find((t) => t.ref === k1.ref)!.summary).toBe(k1.summary);
    expect(String(ai.generateStructured.mock.calls[0][0].prompt)).toContain(`[${k0.ref}] ${k0.title}`);
  });

  it("falls back to the paper's own sentences when the AI fails", async () => {
    ai.on = true;
    ai.generateStructured.mockRejectedValue(new Error("overloaded"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = offlineDigest(paper);
    const { topics, by } = await structureCourse(course, [material("m1", "abs2024", paper, d)]);
    expect(by).toBe("heuristic");
    expect(topics.filter((t) => t.ref.startsWith("K") && !t.ref.includes(".")).map((t) => t.title).sort()).toEqual(d.topics.map((t) => t.title).sort());
    warn.mockRestore();
  });

  it("remakes a summary saved before keyword maps (the AI's too) as a keyword map, keeping the AI's overview", () => {
    const c = createCourse({ name: "Composites" });
    const old: Digest = { summary: "An AI overview.", keywords: ["introduction"], by: "ai", topics: [{ title: "Introduction", start: null, summary: "Why." }, { title: "Conclusions", start: null, summary: "Done." }] };
    const m = insertMaterial({ course_id: c.id, kind: "pdf", title: "abs2024", source_type: "file", filename: "abs2024.pdf", mime: "application/pdf", path: null, url: null, status: "ready", note: null, text: paper });
    const [fresh] = digestNow([{ ...m, digest: old }]);
    expect(fresh.digest).toMatchObject({ basis: "keywords", summary: "An AI overview." });
    expect(fresh.digest!.topics.map((t) => t.title)).not.toContain("Introduction");
    expect(getMaterial(m.id)!.digest!.basis).toBe("keywords");
    // The course page lists it with its keyword map, without the full text.
    setDigest(m.id, old);
    const [listed] = listMaterialsWithMaps(c.id);
    expect(listed.digest?.basis).toBe("keywords");
    expect(listed.text!.length).toBeLessThanOrEqual(400);
    // A map the student edited is theirs.
    const edited = { ...old, edited: true };
    expect(digestNow([{ ...m, digest: edited }])[0].digest).toBe(edited);
  });
});
