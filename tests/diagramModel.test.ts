import { describe, expect, it } from "vitest";
import { addNode, canMoveUnder, connectNodes, copyUnder, disconnectNodes, moveUnder, nodeLabel, parseDiagram, removeNodes, renameNode, writeDiagram } from "@/lib/diagramModel";
import { diagramMermaid, type DiagramSpec } from "@/lib/figure";
import { digestMindmap } from "@/lib/mermaid";

const spec: DiagramSpec = {
  direction: "LR",
  nodes: [
    { id: "a", label: "Release" },
    { id: "b", label: "Oscillate" },
    { id: "c", label: "Rest" },
  ],
  edges: [
    { from: "a", to: "b", label: "zeta < 1" },
    { from: "b", to: "c", label: null },
  ],
};

// A lesson's concept map: sections as boxes, jump lines for the app, classes and styles.
const concept = `flowchart LR
  subgraph s0["① Mass"]
    direction TB
    k0["Inertia"]
    k1["Mass matrix"]
  end
  subgraph s1["② Stiffness"]
    direction TB
    k2["Stiffness matrix"]
  end
  k0 -->|"is stored in"| k1
  k1 --> k2
  classDef main fill:#c9d6ff
  style s0 fill:transparent
  style s1 fill:transparent
  class k0,k2 main
  %% jump k0 ①
  %% jump k2 ②`;

const edges = (code: string) => parseDiagram(code)!.edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`);

describe("editing diagrams", () => {
  it("reads and writes back a lesson figure, a concept map and a mindmap unchanged in meaning", () => {
    for (const code of [diagramMermaid(spec), concept, digestMindmap("Paper", { summary: "", keywords: [], by: "offline", topics: [{ title: "A", start: null, summary: "", subtopics: [{ title: "a1", start: null, summary: "" }] }, { title: "B", start: null, summary: "" }] })]) {
      const d = parseDiagram(code)!;
      expect(d).not.toBeNull();
      const again = parseDiagram(writeDiagram(d))!;
      expect(again.nodes.map((n) => [n.id, n.label, n.parent ?? null, n.group ?? null])).toEqual(d.nodes.map((n) => [n.id, n.label, n.parent ?? null, n.group ?? null]));
      expect(again.edges).toEqual(d.edges);
    }
    expect(edges(diagramMermaid(spec))).toEqual(["n_a>n_b:zeta #lt; 1", "n_b>n_c"]);
    expect(nodeLabel(parseDiagram(diagramMermaid(spec))!, "n_a")).toBe("Release");
    // Comments the app relies on ("%% jump") and classes stay.
    expect(writeDiagram(parseDiagram(concept)!)).toMatch(/subgraph s0\["① Mass"\]\n {4}direction TB\n {4}k0\["Inertia"\][\s\S]*class k0,k2 main[\s\S]*%% jump k0 ①/);
  });

  it("refuses diagrams it can't change safely", () => {
    expect(parseDiagram("sequenceDiagram\n  A->>B: hi")).toBeNull();
    expect(parseDiagram("flowchart LR\n  a --> b & c")).toBeNull();
  });

  it("renames, adds, connects and deletes in a flowchart, tidying classes and styles", () => {
    let d = parseDiagram(concept)!;
    d = renameNode(d, "k1", 'Mass "M" <matrix>');
    expect(nodeLabel(d, "k1")).toBe('Mass "M" <matrix>');
    const added = addNode(d, ["k1"], "Lumped mass");
    d = added.model;
    // A new term joins the section of the term it hangs from.
    expect(d.nodes.find((n) => n.id === added.id)?.group).toBe("s0");
    expect(edges(writeDiagram(d))).toContain(`k1>${added.id}`);
    d = connectNodes(d, "k0", ["k2", added.id], "drives");
    expect(edges(writeDiagram(d))).toEqual(expect.arrayContaining(["k0>k2:drives", `k0>${added.id}:drives`]));
    d = disconnectNodes(d, ["k0", "k2"]);
    expect(edges(writeDiagram(d))).not.toContain("k0>k2:drives");
    // Deleting the only node of a section removes its box and its style; class lists lose it.
    const out = writeDiagram(removeNodes(d, ["k2"]));
    expect(out).not.toMatch(/subgraph s1|style s1|k2/);
    expect(out).toMatch(/class k0 main/);
    expect(parseDiagram(out)).not.toBeNull();
  });

  it("moves and copies under another node", () => {
    const d = parseDiagram(diagramMermaid(spec))!;
    // A flowchart node moved under another is linked from it instead.
    expect(edges(writeDiagram(moveUnder(d, ["n_c"], "n_a")))).toEqual(["n_a>n_b:zeta #lt; 1", "n_a>n_c"]);
    const mm = parseDiagram("mindmap\n  root((Paper))\n    n0[A]\n      n1[a1]\n    n2[B]")!;
    expect(canMoveUnder(mm, ["n0"], "n1")).toBe(false);
    const moved = moveUnder(mm, ["n0"], "n2");
    expect(writeDiagram(moved)).toBe("mindmap\n  root((Paper))\n    n2[B]\n      n0[A]\n        n1[a1]");
    const copied = copyUnder(mm, ["n0"], "n2");
    expect(writeDiagram(copied)).toMatch(/n2\[B\]\n {6}x\d+\[A\]\n {8}x\d+\[a1\]/);
    // Deleting a mindmap node keeps what hung from it, one level up; the root stays.
    expect(writeDiagram(removeNodes(mm, ["n0", "root"]))).toBe("mindmap\n  root((Paper))\n    n1[a1]\n    n2[B]");
  });
});
