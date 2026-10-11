import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { createCourse, getLesson, listTopics, replaceLinks, replaceTopics, saveLesson, type NewTopic } from "@/lib/store";
import { generateLessonDoc, lessonMap, lessonToMarkdown } from "@/lib/lesson";
import { lessonToTex, markdownLessonToTex } from "@/lib/latex";

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

  it("builds an offline lesson with categorised blocks and connections, for the app and for print", async () => {
    const { gd } = setup();
    const doc = await generateLessonDoc(gd.id, 2);
    expect(doc.by).toBe("heuristic");
    expect(doc.blocks[0]).toMatchObject({ kind: "definition", title: "Gradient descent" });
    expect(doc.connections.map((c) => c.topic)).toEqual(["Derivatives", "Stochastic gradient descent", "Momentum", "Newton's method (Numerical Methods)"]);
    expect(doc.where_it_fits).toContain("It follows Derivatives");
    const md = lessonToMarkdown(doc);
    expect(md).toContain("```mermaid");
    expect(md).toContain('<div class="lb lb-definition">');
    const tex = lessonToTex(doc);
    expect(tex).toContain("\\begin{definition}[Gradient descent]");
    expect(tex).toContain("Machine Learning \\textperiodcentered{} Optimisation");
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
