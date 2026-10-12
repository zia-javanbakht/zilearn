import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { createCourse, getLesson, listTopics, replaceLinks, replaceTopics, saveLesson, type NewTopic } from "@/lib/store";
import { generateLessonDoc, lessonMap, lessonToMarkdown } from "@/lib/lesson";
import { lessonToTex, markdownLessonToTex } from "@/lib/latex";
import { dynamicsCourse } from "./fixtures/dynamics";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

beforeEach(() => setDb(openDb(":memory:")));

const t = (ref: string, parent_ref: string | null, title: string, keywords: string[] = []): NewTopic => ({ ref, parent_ref, title, summary: `${title} summary`, keywords, material_ids: [], importance: 2 });

function setup() {
  const ml = createCourse({ name: "Machine Learning" });
  const nm = createCourse({ name: "Numerical Methods" });
  replaceTopics(ml.id, [
    t("1", null, "Optimisation"),
    t("1.1", "1", "Derivatives"),
    t("1.2", "1", "Gradient descent", ["learning rate"]),
    t("1.2.1", "1.2", "Momentum"),
    t("1.3", "1", "Stochastic gradient descent"),
  ]);
  replaceTopics(nm.id, [t("1", null, "Newton's method")]);
  const gd = listTopics(ml.id).find((x) => x.title === "Gradient descent")!;
  const newton = listTopics(nm.id)[0];
  replaceLinks([{ from_topic: gd.id, to_topic: newton.id, score: 0.8, relation: "second-order cousin" }]);
  return { gd, ml };
}

describe("structured lessons", () => {
  it("places the topic in its brainmap and links to other courses", () => {
    const { gd } = setup();
    const m = lessonMap(gd.id);
    expect(m.path).toEqual(["Optimisation"]);
    expect(m.before).toEqual(["Derivatives"]);
    expect(m.after).toEqual(["Stochastic gradient descent"]);
    expect(m.children.map((c) => c.title)).toEqual(["Momentum"]);
    expect(m.related).toEqual([{ course: "Numerical Methods", title: "Newton's method", relation: "second-order cousin" }]);
  });

  it("builds an offline lesson from the brainmap and the student's materials", async () => {
    const { topic } = dynamicsCourse();
    const l1 = await generateLessonDoc(topic.id, 1);
    expect(l1.by).toBe("heuristic");
    const blocks = (doc: typeof l1) => doc.sections.flatMap((x) => x.blocks);
    expect(blocks(l1).find((b) => b.title === "Critical damping")).toMatchObject({ kind: "definition", source: "Lecture 3 recording [05:05]" });
    expect(blocks(l1).some((b) => b.kind === "intuition" && /door closer/.test(b.body))).toBe(true);
    expect(l1.glossary.find((g) => g.term.startsWith("damping ratio"))).toEqual({ term: "damping ratio $\\zeta$", meaning: "$\\zeta = c/c_{cr}$" });
    // Framed around the topic's key terms: a section for each, and links the formulas state.
    expect(l1.sections.map((x) => x.heading)).toEqual(expect.arrayContaining(["Damping ratio", "Critical damping", "Logarithmic decrement"]));
    expect(l1.concept_links).toContainEqual({ from: "damping ratio $\\zeta$", to: "critical damping $c_{cr}$", label: "depends on" });
    expect(lessonToMarkdown(l1)).toMatch(/### Map of this lesson[\s\S]*%% jump k\d ②[\s\S]*### ② Damping ratio/);
    expect(l1.connections.map((c) => c.topic)).toContain("Second-order systems (Control Systems)");

    const l2 = await generateLessonDoc(topic.id, 2);
    expect(blocks(l2).find((b) => b.kind === "pitfall")).toMatchObject({ source: "Lecture 3 recording [07:40]" });
    // Each level teaches its own material, and asks questions with real answers.
    const bodies1 = new Set(blocks(l1).map((b) => b.body));
    expect(blocks(l2).filter((b) => bodies1.has(b.body))).toEqual([]);
    expect(l2.check_yourself.some((q) => q.question.startsWith("Complete from memory"))).toBe(true);

    const l3 = await generateLessonDoc(topic.id, 3);
    expect(blocks(l3).find((b) => b.kind === "formula")?.body).toContain("$$\\ddot{u} + 2\\zeta\\omega_n\\dot{u} + \\omega_n^2 u = 0.$$");
    expect(blocks(l3).find((b) => b.kind === "example")?.body).toMatch(/^A one-storey frame/);
    expect(l3.read.find((r) => r.title === "Lecture 3 recording")?.focus).toMatch(/^around \[/);

    const md = lessonToMarkdown(l2);
    expect(md).toContain('<div class="lb lb-pitfall">');
    expect(md).toContain("📎 Lecture 3 recording [07:40]");
    expect(lessonToMarkdown(l1)).toContain('<div class="lb lb-definition">');
    const tex = lessonToTex(l1);
    expect(tex).toContain("\\begin{definition}[Critical damping]");
    expect(tex).toContain("Structural Dynamics \\textperiodcentered{} SDOF systems");
  });

  it("stores the structured lesson with its Markdown, and still prints older Markdown-only lessons", async () => {
    const { gd } = setup();
    const doc = await generateLessonDoc(gd.id, 1);
    saveLesson(gd.id, 1, lessonToMarkdown(doc), doc.by, doc);
    expect(getLesson(gd.id, 1)!.doc!.title).toBe("Gradient descent");
    saveLesson(gd.id, 2, "## Old\n\nSome **text** with $x^2$.", "claude");
    expect(getLesson(gd.id, 2)!.doc).toBeNull();
    const tex = markdownLessonToTex({ title: "Gradient descent", depth: 2, level: "Understand", goal: "Why.", map: { course: "ML", path: [] } }, "## Old\n\nSome **text** with $x^2$.");
    expect(tex).toContain("\\paragraph{Old}");
    expect(tex).toContain("Some \\textbf{text} with $x^2$.");
  });
});

describe("offline lessons from a question sheet", () => {
  it("teaches from statements, not from the questions or headings", async () => {
    const { offlineLesson, isPrompt } = await import("@/lib/lessonOffline");
    expect(isPrompt("Compare dropout with weight decay.")).toBe(true);
    expect(isPrompt("What is the learning rate?")).toBe(true);
    expect(isPrompt("Weight decay adds the squared norm of the weights to the loss.")).toBe(false);
    const head = { title: "Regularisation", depth: 2, level: "Understand", goal: "", map: { course: "ML", path: [], before: [], after: [], children: [], related: [] } } as never;
    const doc = offlineLesson(head, { summary: "Explain why L2 regularisation reduces overfitting. Compare dropout with weight decay.", keywords: ["compare", "decay", "weight decay"], mastery: null }, [
      { title: "week3 tutorial", kind: "tutorial", text: "Tutorial 3: Regularisation\n\n1. Explain why L2 regularisation reduces overfitting.\n2. Compare dropout with weight decay." },
      { title: "Lecture 7 notes", kind: "notes", text: "# Regularisation\nWeight decay is a penalty that adds the squared norm of the weights to the loss function. Regularisation reduces overfitting by keeping the weights small." },
    ]);
    const bodies = doc.sections.flatMap((s) => s.blocks.map((b) => b.body)).join("\n");
    expect(bodies).not.toMatch(/^(Compare|Explain|Tutorial 3)/m);
    expect(doc.glossary.map((g) => g.term)).toEqual(["weight decay"]);
    expect(doc.takeaways.join(" ")).not.toMatch(/Explain|Compare/);
  });
});

describe("student record", () => {
  it("brings the topic's mock exam slips and forgotten flashcards into the lesson request", async () => {
    const { saveExam, saveExamResult, addCards, listCards } = await import("@/lib/store");
    const { db } = await import("@/lib/db");
    const { lessonRequest } = await import("@/lib/lesson");
    const { gd, ml } = setup();
    const momentum = listTopics(ml.id).find((x) => x.title === "Momentum")!;
    const q = (id: string, topic_id: string, prompt: string) => ({ id, type: "short" as const, topic_id, topic_title: "", prompt, options: [], answer_index: null, model_answer: "", marks: 3 });
    const e = saveExam({ course_id: ml.id, title: "Mock", duration_minutes: 30, generated_by: "heuristic", questions: [q("a", momentum.id, "Why does momentum speed up descent?"), q("b", gd.id, "What is the learning rate?"), q("c", gd.id, "Define a gradient.")] });
    saveExamResult(e.id, { a: "It makes steps smaller", b: "the step size" }, [
      { question_id: "a", score: 1, max: 3, feedback: "Momentum accumulates past gradients." },
      { question_id: "b", score: 3, max: 3, feedback: "Good." },
      { question_id: "c", score: 0, max: 3, feedback: "Needs marking: compare with the model answer." },
    ]);
    addCards(ml.id, [{ front: "What does the learning rate control?", back: "The step size", topic_id: gd.id }], "manual", "heuristic");
    db().prepare("UPDATE cards SET lapses = 2 WHERE id = ?").run(listCards(ml.id)[0].id);

    const r = lessonRequest(gd.id, 2);
    expect(r.record.mistakes).toBe(2);
    expect(r.prompt).toContain("<student_record>");
    expect(r.prompt).toContain("Their answer: It makes steps smaller");
    expect(r.prompt).toContain("forgotten 2 times");
    expect(r.prompt).not.toContain("What is the learning rate?\n"); // full marks, not a slip
    expect(r.prompt).not.toContain("Define a gradient"); // waiting for self-marking
    expect(lessonRequest(listTopics(ml.id).find((x) => x.title === "Derivatives")!.id, 2).prompt).not.toContain("<student_record>");
    expect(r.prompt).toContain('1 question checking "Derivatives"');
    const { updateCourse } = await import("@/lib/store");
    updateCourse(ml.id, { exam_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), target_level: 2 });
    expect(lessonRequest(gd.id, 2).prompt).toMatch(/exam is in \d days: favour exam-style practice/);
    updateCourse(ml.id, { exam_date: null });
    expect(lessonRequest(gd.id, 4).prompt).toContain("The exam only needs level 2");
    const offline = await generateLessonDoc(gd.id, 1);
    expect(offline.sections.flatMap((x) => x.blocks).find((b) => b.title === "From your mock exam")?.body).toContain("Momentum accumulates past gradients.");
  });
});

describe("offline lessons from a paper", () => {
  it("defines only terms a sentence is about, skips generic terms and an empty summary", async () => {
    const { offlineLesson } = await import("@/lib/lessonOffline");
    const head = { title: "Pseudo-ductile composites", depth: 2, level: "Understand", goal: "", map: { course: "Composites", path: [], before: [], after: [], children: [], related: [] } } as never;
    const text =
      "# Pseudo-ductile composites\n" +
      "The properties of the pseudo-ductile composites are given in Table 2. " +
      "Pseudo-ductile composites are laminates that fail gradually instead of suddenly. " +
      "The model of the pseudo-ductile composites is used for every case. The model predicts failure of the model laminates. " +
      "Fragmentation is the cracking of the low-strain layer into many pieces. Fragmentation of the composites gives the pseudo-ductile strain. " +
      "Fragmentation in the composites spreads along the layer.";
    const doc = offlineLesson(head, { summary: "", keywords: ["model", "fragmentation"], mastery: null }, [{ title: "abs2024", kind: "reading", text }]);
    const blocks = doc.sections.flatMap((s) => s.blocks);
    expect(blocks.find((b) => b.kind === "definition")?.body).toMatch(/^Pseudo-ductile composites are laminates/);
    expect(blocks.map((b) => b.title)).not.toContain("What Pseudo-ductile composites is about");
    expect(blocks.every((b) => b.body.trim().length >= 3)).toBe(true);
    expect(doc.glossary.map((g) => g.term)).not.toContain("model");
    expect(doc.glossary.find((g) => g.term === "fragmentation")?.meaning).toMatch(/^Fragmentation is the cracking/);
  });
});

describe("offline lessons skip a paper's layout", () => {
  it("leaves out captions, table rows and fragment words, and links each pair of terms once", async () => {
    const { offlineLesson } = await import("@/lib/lessonOffline");
    const head = { title: "Hybrid laminates", depth: 1, level: "Remember", goal: "", map: { course: "Composites", path: [], before: [], after: [], children: [], related: [] } } as never;
    const text = [
      "# Hybrid laminates",
      "Fragmentation of the low-strain ply spreads before the high-strain ply fails, and the low-strain ply carries",
      "Figure 16. Delamination between low and high-strain plies in a thin-ply hybrid laminate under",
      "tension at room temperature.",
      "Table 2. The fibers and matrix used for the hybrid laminate.",
      "Property T800 K63720 736LT epoxy",
      "Elastic modulus (GPa) 294 620 3.15",
      "",
      "--- Page 9 ---",
      "less load once its fibers break, i.e. Fragmentation of the low-strain ply is what makes the laminate yield gradually.",
      "Delamination between the low-strain ply and the high-strain ply limits the pseudo-ductile strain of the laminate.",
      "Once delamination is complete, the high-strain ply carries the whole load alone.",
      "The low-strain ply and fragmentation together set the yield stress of the laminate in tension.",
      "Fragmentation in the low-strain ply is the cracking of its fibers into many short pieces along the ply.",
      "Delamination is the separation of the low-strain ply from the high-strain ply at their interface.",
    ].join("\n");
    const doc = offlineLesson(head, { summary: "", keywords: ["low", "high", "fragmentation", "delamination", "low-strain ply"], mastery: null }, [{ title: "abs2024", kind: "reading", text }]);
    const blocks = doc.sections.flatMap((s) => s.blocks);
    const all = blocks.map((b) => `${b.title}\n${b.body}`).join("\n");
    expect(all).not.toMatch(/Figure 16|room temperature|T800|294 620|Page 9/);
    expect(blocks.map((b) => b.title)).not.toContain("Low");
    expect(blocks.map((b) => b.title)).not.toContain("High");
    // "Once delamination is complete, ..." says when, not what delamination is.
    expect(doc.glossary.find((g) => g.term === "delamination")?.meaning).toMatch(/^Delamination is the separation/);
    // The sentence broken by the figure and the page break is whole again.
    expect(all).not.toMatch(/^less load/m);
    const pairs = blocks.filter((b) => / and .* connect$/.test(b.title)).map((b) => b.title.replace(/^How (.*) and (.*) connect$/, "$1|$2"));
    for (const p of pairs) expect(pairs).not.toContain(p.split("|").reverse().join("|"));
  });
});

describe("offline key terms keep names", () => {
  it("spells names as the materials do and drops 'per unit' phrases", async () => {
    const { offlineLesson } = await import("@/lib/lessonOffline");
    const head = { title: "Stress measures", depth: 1, level: "Remember", goal: "", map: { course: "Mechanics", path: [], before: [], after: [], children: [], related: [] } } as never;
    const text =
      "# Stress measures\nThe Cauchy stress is the force per unit deformed area acting on a surface. " +
      "The first Piola–Kirchhoff stress is the force per unit reference area. " +
      "The Cauchy stress and the first Piola–Kirchhoff stress differ when the body deforms. " +
      "Energy per unit volume is stored when the Cauchy stress does work. The Piola–Kirchhoff stress is not symmetric in general.";
    const doc = offlineLesson(head, { summary: "", keywords: ["cauchy", "piola kirchhoff"], mastery: null }, [{ title: "notes", kind: "notes", text }]);
    const titles = doc.sections.flatMap((s) => s.blocks.map((b) => b.title)).join(" | ");
    expect(titles).toMatch(/Cauchy/);
    expect(titles).not.toMatch(/cauchy|piola kirchhoff/);
    expect(titles).not.toMatch(/per unit/i);
  });
});
