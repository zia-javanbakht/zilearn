import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { addTopic, buildTree, createCourse, editTopic, listTopics, removeTopic, replaceTopics, setMastery, type NewTopic } from "@/lib/store";
import { search } from "@/lib/kb";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

beforeEach(() => setDb(openDb(":memory:")));

const t = (ref: string, parent_ref: string | null, title: string): NewTopic => ({ ref, parent_ref, title, summary: `${title} summary`, keywords: [], material_ids: [], importance: 2 });
// What the AI keeps detecting, including a wrong branch ("Course admin") and a wrong middle level ("Misc").
const DETECTED = [
  t("1", null, "Optimisation"),
  t("1.1", "1", "Gradient descent"),
  t("2", null, "Course admin"),
  t("2.1", "2", "Assessment dates"),
  t("3", null, "Misc"),
  t("3.1", "3", "Regularisation"),
];

const shape = (courseId: string) => {
  const out: string[] = [];
  const walk = (ns: ReturnType<typeof buildTree>, pre: string) => ns.forEach((n) => (out.push(pre + n.title), walk(n.children, pre + "  ")));
  walk(buildTree(listTopics(courseId)), "");
  return out;
};

describe("editing the brainmap", () => {
  it("deletes wrong branches and adds topics, and a rebuild keeps those changes", () => {
    const c = createCourse({ name: "ML" });
    replaceTopics(c.id, DETECTED);
    const byTitle = (s: string) => listTopics(c.id).find((x) => x.title === s)!;

    removeTopic(byTitle("Course admin").id); // whole branch
    removeTopic(byTitle("Misc").id, true); // just the level; Regularisation moves up
    const opt = byTitle("Optimisation");
    const adam = addTopic(c.id, { title: "Adam optimiser", summary: "Adaptive learning rates.", parent_id: opt.id });
    addTopic(c.id, { title: "Ethics", parent_id: null });
    setMastery(adam.id, "familiar");
    const after = ["Optimisation", "  Gradient descent", "  Adam optimiser", "Regularisation", "Ethics"];
    expect(shape(c.id)).toEqual(after);
    expect(search("adaptive").map((x) => x.title)).toEqual(["Adam optimiser"]);

    replaceTopics(c.id, DETECTED); // rebuild
    expect(shape(c.id)).toEqual(after);
    expect(byTitle("Adam optimiser")).toMatchObject({ id: adam.id, mastery: "familiar", manual: 1 });
    expect(search("adaptive")).toHaveLength(1);
  });

  it("renames and moves topics without the old name coming back", () => {
    const c = createCourse({ name: "ML" });
    replaceTopics(c.id, DETECTED.slice(0, 2));
    const gd = listTopics(c.id).find((x) => x.title === "Gradient descent")!;
    editTopic(gd.id, { title: "Stochastic gradient descent", parent_id: null });
    expect(shape(c.id)).toEqual(["Optimisation", "Stochastic gradient descent"]);
    replaceTopics(c.id, DETECTED.slice(0, 2));
    expect(shape(c.id)).toEqual(["Optimisation", "Stochastic gradient descent"]);

    const opt = listTopics(c.id).find((x) => x.title === "Optimisation")!;
    const sgd = listTopics(c.id).find((x) => x.title.startsWith("Stochastic"))!;
    editTopic(opt.id, { parent_id: sgd.id });
    expect(() => editTopic(sgd.id, { parent_id: opt.id })).toThrow(/under itself/);
    // Adding back a deleted name by hand is allowed and sticks.
    removeTopic(opt.id);
    addTopic(c.id, { title: "optimisation" });
    replaceTopics(c.id, DETECTED.slice(0, 2));
    expect(shape(c.id).filter((s) => /optimisation/i.test(s))).toHaveLength(1);
  });
});
