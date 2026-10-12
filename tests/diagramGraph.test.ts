import { describe, expect, it } from "vitest";
import { boundaryPoint, codeHash, curveBetween, hangingFrom, mindmapNames, parseTranslate, splitEdgeKey } from "@/components/diagramGraph";

describe("diagram graph helpers", () => {
  it("names mindmap nodes in Mermaid's order", () => {
    expect(mindmapNames("mindmap\n  root((Course))\n    n0[A]\n      n1[B]\n    plain text\n    ::icon(fa fa-book)\n    n2(C)")).toEqual(["root", "n0", "n1", "plain text", "n2"]);
  });

  it("splits edge ids on known node names", () => {
    const names = new Set(["n0", "n12", "a_b", "c"]);
    expect(splitEdgeKey("n0_n12_0", names)).toEqual(["n0", "n12"]);
    expect(splitEdgeKey("a_b_c_3", names)).toEqual(["a_b", "c"]);
    expect(splitEdgeKey("x_y_0", names)).toBeNull();
  });

  it("folds only what hangs from a node alone", () => {
    // root -> a -> b, a -> c, root -> d -> c: folding a hides b but not c (d still reaches it).
    const h = hangingFrom(["root", "a", "b", "c", "d"], [
      { from: "root", to: "a" },
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "root", to: "d" },
      { from: "d", to: "c" },
    ]);
    expect([...h.get("a")!]).toEqual(["b"]);
    expect(h.has("d")).toBe(false);
    expect(h.get("root")!.size).toBe(4);
    // A cycle still works.
    expect(hangingFrom(["x", "y"], [{ from: "x", to: "y" }, { from: "y", to: "x" }]).get("x")).toEqual(new Set(["y"]));
  });

  it("routes edges between box edges", () => {
    const a = { cx: 0, cy: 0, w: 20, h: 10 };
    expect(boundaryPoint(a, 100, 0)).toEqual([10, 0]);
    expect(boundaryPoint(a, 0, -100)).toEqual([0, -5]);
    expect(curveBetween(a, { cx: 100, cy: 0, w: 20, h: 10 })).toBe("M10,0 C50,0 50,0 90,0");
    expect(parseTranslate("translate(12.5, -3)")).toEqual([12.5, -3]);
    expect(codeHash("abc")).toBe(codeHash("abc"));
    expect(codeHash("abc")).not.toBe(codeHash("abd"));
  });
});
