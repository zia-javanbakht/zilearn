import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { createCourse, getMaterial, insertMaterial, listTopics, buildTree } from "@/lib/store";
import { digestNow, offlineDigest, settleNewText, topPhrases } from "@/lib/digest";
import { replaceTopics } from "@/lib/store";
import { digestMindmap } from "@/lib/mermaid";
import { heuristicTopics } from "@/lib/brainmap";
import { formatTranscript } from "@/lib/transcript";
import { POST as addToBrainmap } from "@/app/api/materials/[id]/brainmap/route";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

beforeEach(() => setDb(openDb(":memory:")));

// A lecture transcript with no headings: first gradient descent, then regularisation.
const GD = [
  "Okay so today we look at gradient descent.",
  "Gradient descent updates the weights by stepping against the gradient of the loss function.",
  "The learning rate controls how big each gradient descent step is.",
  "If the learning rate is too large, gradient descent diverges and the loss function explodes.",
  "Stochastic gradient descent uses one mini batch to estimate the gradient.",
];
const REG = [
  "Now let's talk about regularisation and overfitting.",
  "Weight decay adds the squared norm of the weights to the loss function as a penalty.",
  "Regularisation reduces overfitting by keeping the weights small.",
  "Dropout is another regularisation method that randomly removes units during training.",
  "With weight decay the model generalises better to the validation set.",
];
const chunks = [...Array(12).keys()].flatMap((i) => (i < 6 ? GD : REG).map((text, j) => ({ start: i * 60 + j * 10, end: null, text })));
const transcript = formatTranscript(chunks);

describe("digest of a recording", () => {
  it("maps a transcript from its key terms, each with what the lecture says and when", () => {
    expect(topPhrases(transcript, 3).map((p) => p.phrase)).toContain("gradient descent");
    const d = offlineDigest(transcript);
    expect(d).toMatchObject({ by: "offline", basis: "keywords" });
    expect(d.keywords.slice(0, 4)).toEqual(expect.arrayContaining(["gradient descent", "loss function"]));
    expect(d.summary).not.toMatch(/\[\d/);
    expect(d.summary.split(/[.!?]/).filter((s) => s.trim()).length).toBe(3);
    const all = d.topics.flatMap((t) => [t, ...(t.subtopics ?? [])]);
    const titles = all.map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(["Gradient descent", "Loss function", "Learning rate", "Weight decay"]));
    // Terms, not clauses: no verb hangs on the end.
    expect(titles.filter((t) => /\b(controls|adds|removes|updates)\b/.test(t))).toEqual([]);
    expect(d.topics[0]).toMatchObject({ title: "Gradient descent", start: "00:00" });
    expect(all.find((t) => t.title === "Weight decay")?.start).toBe("06:00");
    // Each term's note is the lecture's own sentence about it, kept with the others as evidence.
    for (const t of all) {
      expect(GD.concat(REG)).toContain(t.summary);
      expect(t.evidence?.[0]?.text).toBe(t.summary);
    }
    expect(digestMindmap("Lecture 4", d)).toMatch(/^mindmap\n  root\(\(Lecture 4\)\)\n    n0\[Gradient descent\]/);
  });

  it("gives materials a digest on import and uses it to build the brainmap and a branch", async () => {
    const c = createCourse({ name: "ML" });
    const base = { course_id: c.id, source_type: "file" as const, filename: "lec4.mp4", mime: "video/mp4", path: null, url: null, status: "ready" as const, note: null };
    const [video] = digestNow([insertMaterial({ ...base, kind: "video", title: "Lecture 4", text: transcript })]);
    expect(getMaterial(video.id)?.digest?.topics.length).toBeGreaterThan(1);

    const topics = heuristicTopics([getMaterial(video.id)!]);
    // The keyword map is the brainmap: its main terms are the branches, their terms under them.
    expect(topics[0]).toMatchObject({ title: "Gradient descent", parent_ref: null });
    expect(topics[0].keywords).toContain("Gradient descent");
    expect(topics.filter((t) => !t.parent_ref).map((t) => t.title)).toEqual(video.digest!.topics.map((t) => t.title));
    expect(topics.map((t) => t.title)).toEqual(video.digest!.topics.flatMap((t) => [t.title, ...(t.subtopics ?? []).map((s) => s.title)]));
    expect(topics.every((t) => t.material_ids.includes(video.id))).toBe(true);

    const res = await addToBrainmap(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: video.id }) });
    expect(res.status).toBe(201);
    const tree = buildTree(listTopics(c.id));
    expect(tree[0].title).toBe("Lecture 4");
    expect(tree[0].children[0].summary).toMatch(/^\[00:00\] /);
    expect(listTopics(c.id).every((t) => !t.manual && t.material_ids.includes(video.id))).toBe(true);
    const again = await addToBrainmap(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: video.id }) });
    expect(again.status).toBe(400);
  });

  it("puts a new lecture recording into an existing brainmap by itself", async () => {
    const c = createCourse({ name: "ML" });
    replaceTopics(c.id, [{ ref: "1", parent_ref: null, title: "Probability", summary: "", keywords: [], material_ids: [], importance: 2 }]);
    const base = { course_id: c.id, source_type: "url" as const, filename: null, mime: null, path: null, url: "https://youtu.be/x", status: "ready" as const, note: null };
    const [yt] = digestNow([insertMaterial({ ...base, kind: "youtube", title: "Optimisation lecture", text: transcript })]);
    await settleNewText([yt.id]);
    const tree = buildTree(listTopics(c.id));
    expect(tree.map((t) => t.title)).toEqual(["Probability", "Optimisation lecture"]);
    expect(tree[1].children.map((t) => t.title)).toEqual(yt.digest!.topics.map((t) => t.title));
    await settleNewText([yt.id]); // only once
    expect(buildTree(listTopics(c.id))).toHaveLength(2);
  });
});

describe("key sentences", () => {
  it("leaves headings out of summaries", async () => {
    const { keySentences } = await import("@/lib/digest");
    const out = keySentences("# Linear Regression\nLinear regression fits a line minimising squared error.\n# Gradient Descent\nGradient descent minimises the loss by stepping against the gradient.", 2);
    expect(out).toBe("Linear regression fits a line minimising squared error. Gradient descent minimises the loss by stepping against the gradient.");
  });
});

describe("long documents for the AI digest", () => {
  it("keeps the headings of the part that doesn't fit", async () => {
    const { docExcerpt } = await import("@/lib/digest");
    const para = "The element passes the patch test for every distorted mesh we tried. ".repeat(20);
    const text = ["1 Introduction", para, "2 Model problem", para, "6.3 Circular plate", para, "Appendix II Stability proof", para].join("\n");
    const out = docExcerpt(text, 2000);
    expect(out.length).toBeLessThan(2200);
    expect(out).toMatch(/Its sections, in order: Circular plate; Appendix II: Stability proof\]$/);
    expect(docExcerpt("short", 3500)).toBe("short");
  });
});

describe("offline overviews", () => {
  it("prefers prose near the start and drops box labels, equation numbers and running heads", async () => {
    const { keySentences } = await import("@/lib/digest");
    const text = [
      "LECTURE NOTES",
      "The path from finite deformation to nonlinear finite elements rests on a single equilibrium statement of the body.",
      "This note derives the reference and spatial forms of equilibrium for nonlinear finite elements.",
      "(3) Definition 3.1 — Mass of the Cuts. The mass of the cut is the integral of the density over the cut.",
      "For the displacement field, F = I + Grad u, and E = 1 2 ( Grad u + Grad uT + Grad uT Grad u ) for the finite elements.",
    ].join("\n");
    const s = keySentences(text, 2);
    expect(s).not.toMatch(/LECTURE|Definition 3\.1|^\(3\)|^1 —/);
    expect(s).not.toMatch(/Grad uT/);
    expect(s).toMatch(/single equilibrium statement/);
  });
});

describe("offline brainmap branch names", () => {
  it("names an item's branch by the document's title when the item is only called by a code-like file name", async () => {
    const { heuristicTopics } = await import("@/lib/brainmap");
    const base = { course_id: "c", source_type: "file", mime: null, path: null, url: null, status: "ready", note: null, digest: null, created_at: "", kind: "slides" } as const;
    const text = "# Introduction to Isoparametric Elements\n## Mapping\nThe mapping takes the parent element to the physical one.\n## Quality\nDistorted elements lose accuracy.";
    const named = (title: string, filename: string) => heuristicTopics([{ ...base, id: "m", title, filename, text } as never])[0].title;
    expect(named("csd l7", "csd_l7.pdf")).toBe("Introduction to Isoparametric Elements");
    expect(named("Week 7 slides on mapping", "csd_l7.pdf")).toBe("Week 7 slides on mapping");
  });
});
