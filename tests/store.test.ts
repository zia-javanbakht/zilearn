import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { buildTree, createCourse, insertMaterial, listTopics, replaceTopics, setMastery, savePlan, getPlan, setPlanItemDone, getTopic, saveLesson, getLesson } from "@/lib/store";
import { check, CourseInput } from "@/lib/validate";
import { computeLinks, search } from "@/lib/kb";
import { generateExam, generateNotes, generatePodcast, gradeExam } from "@/lib/generate";
import { buildPlan } from "@/lib/plan";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

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
    const r = createCourse({ name: "Stats" });
    insertMaterial({ course_id: r.id, kind: "lecture_notes", title: "Using R", source_type: "text", filename: null, mime: null, path: null, url: null, text: "We analyse data in R and C.", status: "ready", note: null });
    expect(search("R").some((h) => h.course_id === r.id)).toBe(true);
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

describe("rebuilding the brainmap", () => {
  it("keeps ids, lessons and plan items for topics that survive", () => {
    const c = seed();
    const gd = listTopics(c.id).find((t) => t.title === "Gradient descent")!;
    saveLesson(gd.id, 2, "lesson", "claude");
    const draft = buildPlan({ roots: buildTree(listTopics(c.id)), targetLevel: 1, startDate: "2026-01-01", examDate: "2026-01-10", hoursPerDay: 2, materialKinds: new Map() });
    savePlan({ course_id: c.id, ...draft });
    replaceTopics(c.id, [
      { ref: "a", parent_ref: null, title: "Training", summary: "", keywords: [], material_ids: [], importance: 2 },
      { ref: "b", parent_ref: "a", title: "Gradient Descent", summary: "new", keywords: [], material_ids: [], importance: 3 },
    ]);
    const after = listTopics(c.id);
    expect(after.find((t) => t.title === "Gradient Descent")!.id).toBe(gd.id);
    expect(after.find((t) => t.title === "Gradient Descent")!.parent_id).toBe(after.find((t) => t.title === "Training")!.id);
    expect(getLesson(gd.id, 2)).not.toBeNull();
    const items = getPlan(c.id)!.items.filter((i) => i.kind === "study");
    expect(items.find((i) => i.topic_title === "Gradient descent")!.topic_id).toBe(gd.id);
    expect(items.find((i) => i.topic_title === "Regularisation")!.topic_id).toBeNull();
  });

  it("does not leak marks between non-Latin titles", () => {
    const c = createCourse({ name: "OS" });
    replaceTopics(c.id, [{ ref: "a", parent_ref: null, title: "网络", summary: "", keywords: [], material_ids: [], importance: 2 }]);
    setMastery(listTopics(c.id)[0].id, "know");
    replaceTopics(c.id, [{ ref: "b", parent_ref: null, title: "操作系统", summary: "", keywords: [], material_ids: [], importance: 2 }]);
    expect(listTopics(c.id)[0].mastery).toBeNull();
  });

  it("survives parent cycles from the model", () => {
    const c = createCourse({ name: "X" });
    replaceTopics(c.id, [
      { ref: "a", parent_ref: "b", title: "A", summary: "", keywords: [], material_ids: [], importance: 2 },
      { ref: "b", parent_ref: "a", title: "B", summary: "", keywords: [], material_ids: [], importance: 2 },
    ]);
    expect(buildTree(listTopics(c.id)).length).toBeGreaterThan(0);
  });
});

describe("input validation", () => {
  it("rejects bad course input with a readable message", () => {
    expect(check(CourseInput, { name: "" }).ok).toBe(false);
    expect(check(CourseInput, { name: "A", hours_per_day: "abc" }).ok).toBe(false);
    expect(check(CourseInput, { name: "A", exam_date: "next week" }).ok).toBe(false);
    const good = check(CourseInput, { name: " A ", exam_date: "", hours_per_day: "2" });
    expect(good.ok && good.data).toMatchObject({ name: "A", exam_date: null, hours_per_day: 2 });
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
    // Self-marking a written answer later keeps the other grades as they were.
    const written = exam.questions.find((q) => q.type !== "mcq")!;
    const again = await gradeExam(exam.questions, { ...answers, [written.id]: "x" }, { [written.id]: 1 }, grades);
    expect(again.find((g) => g.question_id === mcq.id)).toEqual(grades.find((g) => g.question_id === mcq.id));
    expect(again.find((g) => g.question_id === written.id)!.score).toBe(1);
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

describe("knowledge base refresh", () => {
  it("keeps Claude-written links and relations across a brainmap rebuild", async () => {
    const { refreshLinks } = await import("@/lib/kb");
    const { replaceLinks, listLinks } = await import("@/lib/store");
    const c = seed();
    const d = createCourse({ name: "Deep Learning" });
    replaceTopics(d.id, [
      { ref: "1", parent_ref: null, title: "Training neural nets", summary: "Gradient descent with backpropagation and a learning rate.", keywords: ["gradient", "learning rate", "loss"], material_ids: [], importance: 3 },
    ]);
    refreshLinks();
    const keyword = listLinks();
    expect(keyword.length).toBeGreaterThan(0);
    const [a] = keyword;
    const reg = listTopics(c.id).find((t) => t.title === "Regularisation")!;
    const nets = listTopics(d.id)[0];
    replaceLinks([
      { ...a, relation: "Backprop computes the gradient that descent follows" },
      { from_topic: reg.id, to_topic: nets.id, score: 0.5, relation: "Weight decay is regularisation for nets" },
    ]);
    refreshLinks();
    const after = listLinks();
    expect(after.find((l) => l.from_topic === a.from_topic && l.to_topic === a.to_topic)?.relation).toMatch(/Backprop/);
    expect(after.some((l) => l.relation?.startsWith("Weight decay"))).toBe(true);
  });
});
