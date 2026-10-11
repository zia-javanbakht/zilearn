import type { Mastery, TopicNode } from "./types";

/* Pure Mermaid generators, safe to use on both server and client. */

const MARK_ICON: Record<Mastery, string> = { know: "✅", familiar: "🟡", dont_know: "🔴" };

function short(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function mindmapText(s: string) {
  return s.replace(/[()[\]{}"`<>]/g, " ").replace(/\s+/g, " ").trim() || "untitled";
}

/** Mermaid mindmap overview. Marks are shown as emoji so they survive any theme. */
export function toMindmap(courseName: string, roots: TopicNode[], maxDepth = 4): string {
  const lines = ["mindmap", `  root((${mindmapText(courseName)}))`];
  let i = 0;
  const walk = (ns: TopicNode[], depth: number) => {
    for (const n of ns) {
      const icon = n.effective_mastery ? MARK_ICON[n.effective_mastery] + " " : "";
      lines.push(`${"  ".repeat(depth + 1)}n${i++}[${icon}${mindmapText(short(n.title, 48))}]`);
      if (depth < maxDepth) walk(n.children, depth + 1);
    }
  };
  walk(roots, 1);
  return lines.join("\n");
}

function flowLabel(s: string) {
  // Entity-encode everything Mermaid treats as syntax inside a quoted label.
  return s.replace(/[\"#;`<>]/g, (c) => `#${c.charCodeAt(0)};`).replace(/[\r\n]+/g, " ");
}

function count(n: TopicNode): number {
  return n.children.reduce((s, c) => s + 1 + count(c), 0);
}

export interface FlowchartOptions {
  /** Show this topic's subtree in full and keep the rest collapsed. */
  focusId?: string | null;
  /** Collapse below the top two levels when the tree is larger than this. */
  collapseAbove?: number;
}

/**
 * Mermaid flowchart of the topic tree, coloured by mastery. Nodes are named n0, n1…
 * and `nodeIds` maps them back to topic ids so the UI can attach click handlers.
 * Large trees are collapsed to the top two levels ("+N" marks hidden subtopics);
 * focusing a topic expands its path and subtree.
 */
export function toFlowchart(courseName: string, roots: TopicNode[], opts: FlowchartOptions = {}): { code: string; nodeIds: Record<string, string>; collapsed: boolean } {
  const total = roots.reduce((s, r) => s + 1 + count(r), 0);
  const collapse = total > (opts.collapseAbove ?? 40);
  const expanded = new Set<string>();
  if (opts.focusId) {
    const find = (ns: TopicNode[], trail: TopicNode[]): TopicNode[] | null => {
      for (const n of ns) {
        if (n.id === opts.focusId) return [...trail, n];
        const r = find(n.children, [...trail, n]);
        if (r) return r;
      }
      return null;
    };
    const path = find(roots, []) ?? [];
    path.forEach((n) => expanded.add(n.id));
  }

  const lines = [
    "flowchart LR",
    "  classDef know fill:#d1fadf,stroke:#12b76a,color:#054f31",
    "  classDef familiar fill:#fef0c7,stroke:#f79009,color:#7a2e0e",
    "  classDef dont_know fill:#fee4e2,stroke:#f04438,color:#7a271a",
    "  classDef unmarked fill:#f2f4f7,stroke:#98a2b3,color:#101828",
    "  classDef course fill:#3b5bdb,stroke:#3b5bdb,color:#ffffff",
    "  classDef focus stroke-width:3px",
    `  root(["${flowLabel(courseName)}"]):::course`,
  ];
  const nodeIds: Record<string, string> = {};
  let i = 0;
  const walk = (ns: TopicNode[], parent: string, depth: number, insideFocus: number) => {
    for (const n of ns) {
      const id = `n${i++}`;
      nodeIds[id] = n.id;
      const inFocus = insideFocus >= 0 ? insideFocus : n.id === opts.focusId ? 0 : -1;
      const showChildren = !collapse || depth < 1 || expanded.has(n.id) || (inFocus >= 0 && inFocus < 3);
      const hidden = showChildren ? 0 : count(n);
      const label = flowLabel(short(n.title, 60)) + (hidden ? ` (+${hidden})` : "");
      const cls = n.effective_mastery ?? "unmarked";
      lines.push(`  ${id}["${label}"]:::${cls}`);
      if (n.id === opts.focusId) lines.push(`  class ${id} focus`);
      lines.push(`  ${parent} --- ${id}`);
      if (showChildren) walk(n.children, id, depth + 1, inFocus >= 0 ? inFocus + 1 : -1);
    }
  };
  walk(roots, "root", 0, -1);
  return { code: lines.join("\n"), nodeIds, collapsed: collapse };
}
