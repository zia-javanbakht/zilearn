import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { createCourse, getMaterial, insertMaterial, listTopics, buildTree } from "@/lib/store";
import { digestNow, offlineDigest, topPhrases } from "@/lib/digest";
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
  it("finds the summary, key terms and topics of a transcript without headings", () => {
    expect(topPhrases(transcript, 3).map((p) => p.phrase)).toContain("gradient descent");
    const d = offlineDigest(transcript);
    expect(d.by).toBe("offline");
    expect(d.keywords.slice(0, 4)).toEqual(expect.arrayContaining(["gradient descent", "loss function"]));
    expect(d.summary).not.toMatch(/\[\d/);
    expect(d.summary.split(/[.!?]/).filter((s) => s.trim()).length).toBe(3);
    const titles = d.topics.map((t) => t.title.toLowerCase());
    expect(titles[0]).toBe("gradient descent");
    expect(titles.at(-1)).toMatch(/regularisation|weight decay/);
    expect(d.topics[0].start).toBe("00:00");
    expect(d.topics.length).toBeLessThanOrEqual(3);
    expect(digestMindmap("Lecture 4", d)).toMatch(/^mindmap\n  root\(\(Lecture 4\)\)\n    n0\[Gradient descent\]/);
  });

  it("gives materials a digest on import and uses it to build the brainmap and a branch", async () => {
    const c = createCourse({ name: "ML" });
    const base = { course_id: c.id, source_type: "file" as const, filename: "lec4.mp4", mime: "video/mp4", path: null, url: null, status: "ready" as const, note: null };
    const [video] = digestNow([insertMaterial({ ...base, kind: "video", title: "Lecture 4", text: transcript })]);
    expect(getMaterial(video.id)?.digest?.topics.length).toBeGreaterThan(1);

    const topics = heuristicTopics([getMaterial(video.id)!]);
    expect(topics[0]).toMatchObject({ title: "Lecture 4", parent_ref: null });
    expect(topics[0].keywords).toContain("gradient descent");
    expect(topics.slice(1).map((t) => t.title)).toEqual(video.digest!.topics.map((t) => t.title));

    const res = await addToBrainmap(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: video.id }) });
    expect(res.status).toBe(201);
    const tree = buildTree(listTopics(c.id));
    expect(tree[0].title).toBe("Lecture 4");
    expect(tree[0].children[0].summary).toMatch(/^\[00:00\] /);
    expect(listTopics(c.id).every((t) => !t.manual && t.material_ids.includes(video.id))).toBe(true);
    const again = await addToBrainmap(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: video.id }) });
    expect(again.status).toBe(400);
  });
});
