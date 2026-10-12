import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "@/lib/db";
import { buildTree, createCourse, getLesson, listTopics, removeTopic, replaceTopics, saveLesson, setMastery, type NewTopic } from "@/lib/store";
import { applyOutline, copyTopics, lastUndo, markTopics, moveTopics, removeTopics, snapshotTopics, undoTopics } from "@/lib/topicBatch";
import { matchOutline, outlineDiff, outlineText, readOutline } from "@/lib/outlineText";
import { toFlowchart } from "@/lib/mermaid";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

beforeEach(() => setDb(openDb(":memory:")));

const t = (ref: string, parent_ref: string | null, title: string): NewTopic => ({ ref, parent_ref, title, summary: `${title} summary`, keywords: [title.toLowerCase()], material_ids: [], importance: 2 });
const MAP = [
  t("1", null, "Optimisation"),
  t("1.1", "1", "Gradient descent"),
  t("1.2", "1", "Momentum"),
  t("2", null, "Regularisation"),
  t("2.1", "2", "Dropout"),
  t("2.2", "2", "Weight decay"),
  t("3", null, "Misc"),
];

const shape = (courseId: string) => {
  const out: string[] = [];
  const walk = (ns: ReturnType<typeof buildTree>, pre: string) => ns.forEach((n) => (out.push(pre + n.title), walk(n.children, pre + "  ")));
  walk(buildTree(listTopics(courseId)), "");
  return out;
};

function setup() {
  const c = createCourse({ name: "ML" });
  replaceTopics(c.id, MAP);
  const id = (s: string) => listTopics(c.id).find((x) => x.title === s)!.id;
  return { c, id };
}

describe("batch editing the brainmap", () => {
  it("moves several topics under another, in place, and a rebuild keeps them there", () => {
    const { c, id } = setup();
    moveTopics(c.id, [id("Dropout"), id("Momentum")], id("Misc"));
    expect(shape(c.id)).toEqual(["Optimisation", "  Gradient descent", "Regularisation", "  Weight decay", "Misc", "  Momentum", "  Dropout"]);
    moveTopics(c.id, [id("Weight decay")], id("Misc"), id("Dropout"));
    expect(shape(c.id).slice(-4)).toEqual(["Misc", "  Momentum", "  Weight decay", "  Dropout"]);
    replaceTopics(c.id, MAP);
    expect(shape(c.id)).toEqual(["Optimisation", "  Gradient descent", "Regularisation", "Misc", "  Momentum", "  Weight decay", "  Dropout"]);
  });

  it("refuses to move a topic inside its own branch, and moving a parent with its child moves the branch", () => {
    const { c, id } = setup();
    expect(() => moveTopics(c.id, [id("Optimisation")], id("Gradient descent"))).toThrow(/itself/);
    moveTopics(c.id, [id("Regularisation"), id("Dropout")], id("Optimisation"));
    expect(shape(c.id)).toEqual(["Optimisation", "  Gradient descent", "  Momentum", "  Regularisation", "    Dropout", "    Weight decay", "Misc"]);
    moveTopics(c.id, [id("Regularisation")], null, id("Optimisation"));
    expect(shape(c.id)[0]).toBe("Regularisation");
  });

  it("copies branches with their marks, naming copies in the same place", () => {
    const { c, id } = setup();
    setMastery(id("Regularisation"), "familiar");
    const made = copyTopics(c.id, [id("Regularisation")], id("Misc"));
    expect(made).toHaveLength(1);
    expect(shape(c.id).slice(-4)).toEqual(["Misc", "  Regularisation", "    Dropout", "    Weight decay"]);
    expect(listTopics(c.id).find((x) => x.id === made[0])).toMatchObject({ mastery: "familiar", manual: 1, achieved_depth: 0 });
    copyTopics(c.id, [id("Momentum")], id("Optimisation"));
    expect(shape(c.id).slice(0, 4)).toEqual(["Optimisation", "  Gradient descent", "  Momentum", "  Momentum (copy)"]);
  });

  it("deleting a copy doesn't stop the original coming back on a rebuild", () => {
    const { c, id } = setup();
    const [copy] = copyTopics(c.id, [id("Dropout")], id("Misc"));
    removeTopic(copy);
    replaceTopics(c.id, MAP);
    expect(shape(c.id)).toContain("  Dropout");
  });

  it("deletes and marks many topics at once", () => {
    const { c, id } = setup();
    markTopics(c.id, [id("Optimisation"), id("Misc")], "know");
    expect(listTopics(c.id).filter((x) => x.mastery === "know").map((x) => x.title)).toEqual(["Optimisation", "Misc"]);
    expect(removeTopics(c.id, [id("Regularisation"), id("Dropout"), id("Misc")])).toBe(2);
    expect(shape(c.id)).toEqual(["Optimisation", "  Gradient descent", "  Momentum"]);
    removeTopics(c.id, [id("Optimisation")], true);
    expect(shape(c.id)).toEqual(["Gradient descent", "Momentum"]);
  });

  it("undoes a delete with the lessons of the deleted topics", () => {
    const { c, id } = setup();
    const reg = id("Regularisation");
    saveLesson(id("Dropout"), 2, "Dropout lesson", "test");
    snapshotTopics(c.id, "deleting Regularisation", [reg]);
    removeTopics(c.id, [reg]);
    expect(lastUndo(c.id)).toBe("deleting Regularisation");
    expect(undoTopics(c.id)).toBe("deleting Regularisation");
    expect(shape(c.id)).toEqual(MAP.map((m) => (m.parent_ref ? "  " : "") + m.title));
    expect(lastUndo(c.id)).toBeNull();
    expect(getLesson(id("Dropout"), 2)?.content).toBe("Dropout lesson");
  });

  it("undoes a copy and a move", () => {
    const { c, id } = setup();
    const before = shape(c.id);
    snapshotTopics(c.id, "moving");
    moveTopics(c.id, [id("Dropout")], null);
    snapshotTopics(c.id, "copying");
    copyTopics(c.id, [id("Optimisation")], id("Misc"));
    undoTopics(c.id);
    undoTopics(c.id);
    expect(shape(c.id)).toEqual(before);
    expect(undoTopics(c.id)).toBeNull();
  });

  it("applies an edited outline: renames, moves, adds and removes", () => {
    const { c } = setup();
    const start = outlineText(buildTree(listTopics(c.id)));
    expect(start.text.split("\n").slice(0, 2)).toEqual(["Optimisation", "  Gradient descent"]);
    const edited = ["Optimisation", "  Gradient descent", "    Momentum", "  Adam", "Regularisation", "  Dropout (inverted)", "  Weight decay"].join("\n");
    const items = matchOutline(start.lines, edited);
    const diff = outlineDiff(start.lines, items);
    expect(diff.added).toEqual(["Adam"]);
    expect(diff.renamed).toEqual([{ from: "Dropout", to: "Dropout (inverted)" }]);
    expect(diff.removed).toEqual(["Misc"]);
    expect(diff.moved).toBe(1);
    const gdId = start.lines[1].id;
    const changes = applyOutline(c.id, items);
    expect(changes).toEqual({ added: 1, renamed: 1, moved: 1, removed: 1 });
    expect(shape(c.id)).toEqual(edited.split("\n"));
    expect(listTopics(c.id).find((x) => x.title === "Gradient descent")!.id).toBe(gdId);
    replaceTopics(c.id, MAP);
    expect(shape(c.id)).not.toContain("Misc");
    expect(shape(c.id)).not.toContain("  Dropout");
  });
});

describe("outline text", () => {
  it("reads indents, tabs and bullets", () => {
    expect(readOutline("- A\n\t* B\n        C\n  D\nE")).toEqual([
      { title: "A", depth: 0 },
      { title: "B", depth: 1 },
      { title: "C", depth: 2 },
      { title: "D", depth: 1 },
      { title: "E", depth: 0 },
    ]);
  });

  it("keeps topics that moved and pairs renames between kept lines", () => {
    const before = [
      { id: "a", title: "A", depth: 0 },
      { id: "b", title: "B", depth: 1 },
      { id: "c", title: "C", depth: 1 },
      { id: "d", title: "D", depth: 0 },
    ];
    const after = matchOutline(before, "D\n  C\nA\n  B2\n  New");
    expect(after.map((l) => l.id)).toEqual(["d", "c", "a", "b", null]);
  });
});

describe("flowchart plus and minus", () => {
  it("opens and closes branches on request", () => {
    const { c, id } = setup();
    const tree = buildTree(listTopics(c.id));
    const f = toFlowchart("ML", tree, { collapseAbove: 3 });
    const nid = (tid: string, fc = f) => Object.entries(fc.nodeIds).find(([, v]) => v === tid)![0];
    expect(f.toggles[nid(id("Optimisation"))]).toBe("open");
    const shut = toFlowchart("ML", tree, { collapseAbove: 3, closed: new Set([id("Optimisation")]) });
    expect(shut.toggles[nid(id("Optimisation"), shut)]).toBe("closed");
    expect(Object.values(shut.nodeIds)).not.toContain(id("Momentum"));
    expect(shut.code).toContain("(+2)");
    expect(f.toggles[nid(id("Misc"))]).toBeUndefined();
  });
});
