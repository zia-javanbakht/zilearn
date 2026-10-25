import { describe, expect, it } from "vitest";
import { buildPlan, startDepth } from "@/lib/plan";
import type { Mastery, TopicNode } from "@/lib/types";

let n = 0;
function node(title: string, mastery: Mastery | null, children: TopicNode[] = [], achieved = 0): TopicNode {
  return {
    id: `t${n++}`, course_id: "c", parent_id: null, title, summary: "", keywords: [], material_ids: [],
    importance: 2, position: n, mastery, achieved_depth: achieved, children, effective_mastery: mastery,
  };
}

const base = { startDate: "2026-01-01", examDate: "2026-01-21", hoursPerDay: 3, materialKinds: new Map() };

describe("startDepth", () => {
  it("starts unknown topics at the surface and known ones at the target", () => {
    expect(startDepth("dont_know", 3, 0)).toBe(1);
    expect(startDepth(null, 3, 0)).toBe(1);
    expect(startDepth("familiar", 3, 0)).toBe(2);
    expect(startDepth("know", 3, 0)).toBe(3);
    expect(startDepth("familiar", 3, 2)).toBe(3);
    // Marked "don't know" after studying: repeat the current depth.
    expect(startDepth("dont_know", 3, 2)).toBe(2);
  });
});

describe("buildPlan", () => {
  it("revisits each topic once per pass with increasing depth", () => {
    const roots = [node("A", "dont_know"), node("B", "familiar"), node("C", "know")];
    const plan = buildPlan({ ...base, roots, targetLevel: 3 });
    const study = plan.items.filter((i) => i.kind === "study");
    const depths = (t: string) => study.filter((i) => i.topic_title === t).map((i) => i.depth);
    expect(depths("A")).toEqual([1, 2, 3]);
    expect(depths("B")).toEqual([2, 3]);
    expect(depths("C")).toEqual([3]);
    expect(plan.iterations).toBe(3);
    // A checkpoint closes every pass.
    expect(plan.items.filter((i) => i.kind === "checkpoint").map((i) => i.iteration)).toEqual([1, 2, 3]);
  });

  it("plans a top-level branch through its subtopics, which inherit its marks", () => {
    const leaf = node("Leaf", null);
    leaf.effective_mastery = "familiar";
    const roots = [node("Parent", "familiar", [leaf])];
    const plan = buildPlan({ ...base, roots, targetLevel: 2 });
    expect(plan.items.filter((i) => i.kind === "study").map((i) => [i.topic_title, i.depth])).toEqual([["Leaf", 2]]);
  });

  it("studies a parent concept below the top level before its subtopics", () => {
    const roots = [node("FEM", null, [node("Shape functions", null), node("Jacobian", null, [node("Inverted elements", null), node("Shear locking", null)])])];
    const plan = buildPlan({ ...base, roots, targetLevel: 1 });
    const study = plan.items.filter((i) => i.kind === "study");
    expect(study.map((i) => i.topic_title)).toEqual(["Shape functions", "Jacobian", "Inverted elements", "Shear locking"]);
    const jac = study.find((i) => i.topic_title === "Jacobian")!;
    expect(jac.minutes).toBeLessThan(study[0].minutes);
    expect(jac.activities[0]).toMatch(/Inverted elements, Shear locking/);
  });

  it("keeps passes in order and dates within the exam window", () => {
    const roots = Array.from({ length: 12 }, (_, i) => node(`T${i}`, "dont_know"));
    const plan = buildPlan({ ...base, roots, targetLevel: 4 });
    const iters = plan.items.map((i) => i.iteration);
    expect([...iters].sort((a, b) => a - b)).toEqual(iters);
    for (const it of plan.items) expect(it.date < "2026-01-21").toBe(true);
    expect(plan.items.map((i) => i.day)).toEqual([...plan.items.map((i) => i.day)].sort((a, b) => a - b));
  });

  it("warns and compresses when time is short", () => {
    const roots = Array.from({ length: 30 }, (_, i) => node(`T${i}`, "dont_know"));
    const plan = buildPlan({ ...base, examDate: "2026-01-03", hoursPerDay: 1, roots, targetLevel: 4 });
    expect(plan.warnings.join(" ")).toMatch(/left out/);
    for (const it of plan.items) expect(it.date <= "2026-01-02").toBe(true);
    // The final pass survives; intermediate passes are dropped first.
    expect(plan.items.some((i) => i.iteration === 4)).toBe(true);
  });

  it("shortens sessions when time is tight but enough for every session", () => {
    const roots = Array.from({ length: 6 }, (_, i) => node(`T${i}`, "dont_know"));
    const plan = buildPlan({ ...base, examDate: "2026-01-04", hoursPerDay: 2, roots, targetLevel: 3 });
    expect(plan.warnings.join(" ")).toMatch(/shortened/);
    expect(plan.items.filter((i) => i.kind === "study")).toHaveLength(18);
  });

  it("never overloads a day, even with hundreds of topics", () => {
    const roots = Array.from({ length: 300 }, (_, i) => node(`T${i}`, "dont_know"));
    const plan = buildPlan({ ...base, examDate: "2026-01-03", hoursPerDay: 2, roots, targetLevel: 4 });
    const perDay = new Map<number, number>();
    for (const it of plan.items) perDay.set(it.day, (perDay.get(it.day) ?? 0) + it.minutes);
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(120 + 45);
  });

  it("handles an exam today or in the past", () => {
    const roots = [node("A", "dont_know")];
    const past = buildPlan({ ...base, examDate: "2025-12-20", roots, targetLevel: 2 });
    expect(past.warnings.join(" ")).toMatch(/passed/);
    expect(past.end_date > past.start_date).toBe(true);
    const today = buildPlan({ ...base, examDate: "2026-01-01", roots, targetLevel: 2 });
    expect(today.warnings.join(" ")).toMatch(/today/);
    for (const it of today.items) expect(it.date).toBe("2026-01-01");
  });

  it("skips depth already achieved", () => {
    const roots = [node("Done", "familiar", [], 3)];
    const plan = buildPlan({ ...base, roots, targetLevel: 3 });
    expect(plan.items).toHaveLength(0);
    expect(plan.warnings[0]).toMatch(/target level/);
  });
});

describe("plan structure", () => {
  const branch = () => node("Branch", null, [node("L1", "dont_know"), node("L2", "dont_know")]);

  it("opens branches with an overview and closes them with a synthesis", () => {
    const roots = [branch(), node("Other", "dont_know", [node("O1", "dont_know")])];
    const plan = buildPlan({ ...base, roots, targetLevel: 2 });
    const kinds = plan.items.map((i) => `${i.kind}:${i.topic_title}`);
    expect(kinds.indexOf("overview:Branch")).toBeLessThan(kinds.indexOf("study:L1"));
    expect(kinds.lastIndexOf("synthesis:Branch")).toBeGreaterThan(kinds.lastIndexOf("study:L2"));
  });

  it("interleaves branches from pass 2 on", () => {
    const roots = [node("A", null, [node("A1", "dont_know"), node("A2", "dont_know")]), node("B", null, [node("B1", "dont_know"), node("B2", "dont_know")])];
    const plan = buildPlan({ ...base, roots, targetLevel: 2 });
    const pass2 = plan.items.filter((i) => i.kind === "study" && i.iteration === 2).map((i) => i.topic_title);
    expect(pass2).toEqual(["A1", "B1", "A2", "B2"]);
  });

  it("checks known topics early with a diagnostic", () => {
    const roots = [node("K", "know"), node("U", "dont_know")];
    const plan = buildPlan({ ...base, roots, targetLevel: 3 });
    const diag = plan.items.find((i) => i.kind === "diagnostic")!;
    expect(diag.topic_title).toBe("K");
    expect(diag.day).toBe(1);
  });

  it("adds spaced recall warm-ups and keeps the last day for a final review", () => {
    const roots = Array.from({ length: 8 }, (_, i) => node(`T${i}`, "dont_know"));
    const plan = buildPlan({ ...base, roots, targetLevel: 3 });
    expect(plan.items.some((i) => i.kind === "recall")).toBe(true);
    const finals = plan.items.filter((i) => i.kind === "final");
    expect(finals.map((f) => f.date)).toEqual(["2026-01-20", "2026-01-20"]);
    expect(plan.items.filter((i) => i.kind !== "final" && i.kind !== "recall").every((i) => i.date < "2026-01-20")).toBe(true);
  });
});

describe("applyMark (client-side marking)", () => {
  it("matches the server: branch marks clear descendants, which then inherit", async () => {
    const { applyMark } = await import("@/lib/tree");
    const leaf = (id: string, mastery: TopicNode["mastery"] = null) => ({ id, mastery, children: [], effective_mastery: null }) as unknown as TopicNode;
    const tree = [{ ...leaf("a"), children: [leaf("a1", "know"), leaf("a2")] }, leaf("b", "familiar")] as TopicNode[];
    const t1 = applyMark(tree, "a", "dont_know");
    expect(t1[0].children.map((c) => [c.mastery, c.effective_mastery])).toEqual([[null, "dont_know"], [null, "dont_know"]]);
    expect(t1[1].effective_mastery).toBe("familiar");
    expect(tree[0].children[0].mastery).toBe("know"); // input untouched
    const t2 = applyMark(t1, "a2", "know", false);
    expect(t2[0].children[1].effective_mastery).toBe("know");
    const t3 = applyMark(t2, null, "familiar");
    expect(t3.every((r) => r.mastery === "familiar")).toBe(true);
    expect(t3[0].children.every((c) => c.mastery === null && c.effective_mastery === "familiar")).toBe(true);
  });
});
