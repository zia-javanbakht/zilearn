import type { Digest, Mastery, TopicNode } from "./types";

/* Pure Mermaid generators, safe to use on both server and client. */

const MARK_ICON: Record<Mastery, string> = { know: "✅", familiar: "🟡", dont_know: "🔴" };

function short(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function mindmapText(s: string) {
  return s.replace(/\s*\(([^()]+)\)/g, " · $1").replace(/[()[\]{}"`<>]/g, " ").replace(/\s+/g, " ").trim() || "untitled";
}

/**
 * Mermaid mindmap overview, folded and unfolded like the flowchart (same options, same node names
 * and toggles). Marks are shown as emoji so they survive any theme.
 */
export function toMindmap(courseName: string, roots: TopicNode[], opts: FlowchartOptions = {}): Flowchart {
  const lines = ["mindmap", `  root((${mindmapText(courseName)}))`];
  const shape = visibleTree(roots, opts);
  const walk = (ns: TopicNode[], depth: number) => {
    for (const n of ns) {
      const v = shape.byTopic.get(n.id)!;
      const icon = n.effective_mastery ? MARK_ICON[n.effective_mastery] + " " : "";
      lines.push(`${"  ".repeat(depth + 1)}${v.nid}[${icon}${mindmapText(short(n.title, 48))}${v.hidden ? ` +${v.hidden}` : ""}]`);
      if (v.open) walk(n.children, depth + 1);
    }
  };
  walk(roots, 1);
  return { code: lines.join("\n"), nodeIds: shape.nodeIds, collapsed: shape.collapsed, toggles: shape.toggles };
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
  /** Topics the student opened or closed with the plus and minus signs; these win over the defaults. */
  open?: ReadonlySet<string>;
  closed?: ReadonlySet<string>;
}

export interface Flowchart {
  code: string;
  /** Mermaid node name (n0, n1…) to topic id. */
  nodeIds: Record<string, string>;
  /** Whether some branches start closed because the map is large. */
  collapsed: boolean;
  /** For each node with subtopics, whether they are shown ("open") or hidden ("closed"). */
  toggles: Record<string, "open" | "closed">;
}

/**
 * Mermaid flowchart of the topic tree, coloured by mastery. Nodes are named n0, n1…
 * and `nodeIds` maps them back to topic ids so the UI can attach click handlers.
 * Large trees are collapsed to the top two levels ("+N" marks hidden subtopics);
 * focusing a topic expands its path and subtree, and `open`/`closed` override both.
 */
export function toFlowchart(courseName: string, roots: TopicNode[], opts: FlowchartOptions = {}): Flowchart {
  const shape = visibleTree(roots, opts);
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
  const walk = (ns: TopicNode[], parent: string) => {
    for (const n of ns) {
      const v = shape.byTopic.get(n.id)!;
      const label = flowLabel(short(n.title, 60)) + (v.hidden ? ` (+${v.hidden})` : "");
      lines.push(`  ${v.nid}["${label}"]:::${n.effective_mastery ?? "unmarked"}`);
      if (n.id === opts.focusId) lines.push(`  class ${v.nid} focus`);
      lines.push(`  ${parent} --- ${v.nid}`);
      if (v.open) walk(n.children, v.nid);
    }
  };
  walk(roots, "root");
  return { code: lines.join("\n"), nodeIds: shape.nodeIds, collapsed: shape.collapsed, toggles: shape.toggles };
}

/**
 * Which branches show: large trees fold below the top level, the focused topic's path and subtree
 * open, and the student's own opening and closing wins. Node names n0, n1… follow map order over
 * the whole tree, so a topic keeps its name whether or not its parent is open.
 */
function visibleTree(roots: TopicNode[], opts: FlowchartOptions) {
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
    (find(roots, []) ?? []).forEach((n) => expanded.add(n.id));
  }
  const nodeIds: Record<string, string> = {};
  const toggles: Record<string, "open" | "closed"> = {};
  const byTopic = new Map<string, { nid: string; open: boolean; hidden: number }>();
  let i = 0;
  const walk = (ns: TopicNode[], depth: number, insideFocus: number, shown: boolean) => {
    for (const n of ns) {
      const nid = `n${i++}`;
      const inFocus = insideFocus >= 0 ? insideFocus : n.id === opts.focusId ? 0 : -1;
      const open = opts.closed?.has(n.id) ? false : opts.open?.has(n.id) || !collapse || depth < 1 || expanded.has(n.id) || (inFocus >= 0 && inFocus < 3);
      if (shown) {
        nodeIds[nid] = n.id;
        if (n.children.length) toggles[nid] = open ? "open" : "closed";
      }
      byTopic.set(n.id, { nid, open, hidden: open ? 0 : count(n) });
      walk(n.children, depth + 1, inFocus >= 0 ? inFocus + 1 : -1, shown && open);
    }
  };
  walk(roots, 0, -1, true);
  return { nodeIds, toggles, byTopic, collapsed: collapse };
}

/** Mermaid mindmap of one material's digest. */
export function digestMindmap(title: string, d: Digest): string {
  const label = (s: string) => s.replace(/\s*\(([^()]+)\)/g, " · $1").replace(/[()[\]{}"`<>$\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "untitled";
  const lines = ["mindmap", `  root((${label(title)}))`];
  let i = 0;
  for (const t of d.topics) {
    lines.push(`    n${i++}[${label(t.title)}]`);
    for (const s of t.subtopics ?? []) lines.push(`      n${i++}[${label(s.title)}]`);
  }
  return lines.join("\n");
}
