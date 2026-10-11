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
    expect(startDepth("dont_know", 3, 2)).toBe(3);
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

  it("plans only leaves, and inherits marks from parents", () => {
    const leaf = node("Leaf", null);
    leaf.effective_mastery = "familiar";
    const roots = [node("Parent", "familiar", [leaf])];
    const plan = buildPlan({ ...base, roots, targetLevel: 2 });
    expect(plan.items.filter((i) => i.kind === "study").map((i) => [i.topic_title, i.depth])).toEqual([["Leaf", 2]]);
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
    expect(plan.warnings.join(" ")).toMatch(/shortened/);
    for (const it of plan.items) expect(it.date <= "2026-01-02").toBe(true);
  });

  it("skips depth already achieved", () => {
    const roots = [node("Done", "dont_know", [], 3)];
    const plan = buildPlan({ ...base, roots, targetLevel: 3 });
    expect(plan.items).toHaveLength(0);
    expect(plan.warnings[0]).toMatch(/target level/);
  });
});
