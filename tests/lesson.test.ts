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
    expect(l1.glossary.find((g) => g.term === "damping ratio")?.meaning).toBe("$\\zeta = c/c_{cr}$");
    expect(l1.connections.map((c) => c.topic)).toContain("Second-order systems (Control Systems)");

    const l3 = await generateLessonDoc(topic.id, 3);
    expect(blocks(l3).find((b) => b.kind === "formula")?.body).toContain("$$\\ddot{u} + 2\\zeta\\omega_n\\dot{u} + \\omega_n^2 u = 0.$$");
    expect(blocks(l3).find((b) => b.kind === "pitfall")).toMatchObject({ source: "Lecture 3 recording [07:40]" });
    expect(blocks(l3).find((b) => b.kind === "example")?.body).toMatch(/^A one-storey frame/);
    expect(l3.read.find((r) => r.title === "Lecture 3 recording")?.focus).toMatch(/^around \[/);

    const md = lessonToMarkdown(l3);
    expect(md).toContain('<div class="lb lb-definition">');
    expect(md).toContain("📎 Lecture 3 recording [07:40]");
    const tex = lessonToTex(l3);
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
