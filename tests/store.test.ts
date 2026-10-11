import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { buildTree, createCourse, insertMaterial, listTopics, replaceTopics, setMastery, savePlan, getPlan, setPlanItemDone, getTopic } from "@/lib/store";
import { computeLinks, search } from "@/lib/kb";
import { generateExam, generateNotes, generatePodcast, gradeExam } from "@/lib/generate";
import { buildPlan } from "@/lib/plan";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

beforeEach(() => setDb(openDb(":memory:")));

function seed() {
  const c = createCourse({ name: "Machine Learning" });
  const mat = insertMaterial({
    course_id: c.id, kind: "lecture_notes", title: "Week 1 notes", source_type: "text", filename: null, mime: null, path: null, url: null,
    text: "# Gradient descent\nGradient descent minimises the loss by stepping against the gradient.\n# Regularisation\nPenalise large weights to avoid overfitting.",
    status: "ready", note: null,
  });
  replaceTopics(c.id, [
    { ref: "1", parent_ref: null, title: "Optimisation", summary: "How models are trained.", keywords: ["loss"], material_ids: [mat.id], importance: 3 },
    { ref: "1.1", parent_ref: "1", title: "Gradient descent", summary: "Step against the gradient of the loss.", keywords: ["gradient", "learning rate"], material_ids: [mat.id], importance: 3 },
    { ref: "1.2", parent_ref: "1", title: "Regularisation", summary: "Penalise large weights to reduce overfitting.", keywords: ["overfitting", "weights"], material_ids: [mat.id], importance: 2 },
  ]);
  return c;
}

describe("store", () => {
  it("marks a whole branch and carries marks over a rebuild", () => {
    const c = seed();
    const parent = listTopics(c.id).find((t) => t.title === "Optimisation")!;
    const child = listTopics(c.id).find((t) => t.title === "Gradient descent")!;
    setMastery(child.id, "know");
    setMastery(parent.id, "familiar");
    const tree = buildTree(listTopics(c.id));
    expect(tree[0].children.map((x) => x.effective_mastery)).toEqual(["familiar", "familiar"]);
    expect(getTopic(child.id)!.mastery).toBeNull();

    setMastery(child.id, "know", false);
    replaceTopics(c.id, [{ ref: "x", parent_ref: null, title: "Gradient Descent", summary: "", keywords: [], material_ids: [], importance: 2 }]);
    expect(listTopics(c.id)[0].mastery).toBe("know");
  });

  it("records achieved depth when plan items are done", () => {
    const c = seed();
    const draft = buildPlan({ roots: buildTree(listTopics(c.id)), targetLevel: 2, startDate: "2026-01-01", examDate: "2026-01-10", hoursPerDay: 2, materialKinds: new Map() });
    const plan = savePlan({ course_id: c.id, ...draft });
    const first = plan.items.find((i) => i.kind === "study")!;
    setPlanItemDone(first.id, true);
    expect(getTopic(first.topic_id!)!.achieved_depth).toBe(1);
    expect(getPlan(c.id)!.items.find((i) => i.id === first.id)!.done).toBe(true);
  });

  it("searches topics and material text", () => {
    const c = seed();
    const hits = search("overfit");
    expect(hits.some((h) => h.type === "topic" && h.title === "Regularisation")).toBe(true);
    expect(hits.some((h) => h.type === "material" && h.course_id === c.id)).toBe(true);
    expect(search("   ")).toEqual([]);
    expect(search('weird "quotes" AND (stuff')).toBeInstanceOf(Array);
  });

  it("links similar topics across courses only", () => {
    seed();
    const other = createCourse({ name: "Deep Learning" });
    replaceTopics(other.id, [
      { ref: "a", parent_ref: null, title: "Gradient descent variants", summary: "SGD, momentum and Adam step against the gradient of the loss.", keywords: ["gradient", "learning rate"], material_ids: [], importance: 2 },
      { ref: "b", parent_ref: null, title: "Convolutions", summary: "Kernels slide over images.", keywords: ["kernel"], material_ids: [], importance: 2 },
    ]);
    const all = [...listTopics(other.id), ...listTopics(seed().id)];
    const links = computeLinks(all);
    expect(links.length).toBeGreaterThan(0);
    const titles = links.map((l) => [all.find((t) => t.id === l.from_topic)!.title, all.find((t) => t.id === l.to_topic)!.title].sort().join(" | "));
    expect(titles).toContain("Gradient descent | Gradient descent variants");
    for (const l of links) expect(all.find((t) => t.id === l.from_topic)!.course_id).not.toBe(all.find((t) => t.id === l.to_topic)!.course_id);
  });
});

describe("offline generators", () => {
  it("creates and grades a mock exam", async () => {
    const c = seed();
    const exam = await generateExam(c.id, { scope: { kind: "course" }, questionCount: 6, mix: { mcq: 2, short: 1, long: 1 }, durationMinutes: 30 });
    expect(exam.questions).toHaveLength(6);
    const mcq = exam.questions.find((q) => q.type === "mcq")!;
    const answers = { [mcq.id]: String(mcq.answer_index) };
    const grades = await gradeExam(exam.questions, answers);
    expect(grades.find((g) => g.question_id === mcq.id)!.score).toBe(mcq.marks);
  });

  it("writes notes and a podcast for a branch", async () => {
    const c = seed();
    const topic = listTopics(c.id).find((t) => t.title === "Optimisation")!;
    const notes = await generateNotes(c.id, { kind: "topic", topicId: topic.id }, "concise");
    expect(notes.content).toContain("Gradient descent");
    const pod = await generatePodcast(c.id, { kind: "weak" }, 5);
    expect(pod.segments.length).toBeGreaterThan(3);
  });
});
