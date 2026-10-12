/*
 * The nodes and edges of a diagram Mermaid has drawn, read back from its SVG, so any diagram in the
 * app can be rearranged by dragging and folded with plus and minus signs. Works for flowcharts and
 * mindmaps; pure helpers (no DOM) are exported for tests.
 */

export interface GraphNode {
  id: string;
  el: SVGGElement;
  /** Where Mermaid put it (its translate). */
  x: number;
  y: number;
}

export interface GraphEdge {
  el: SVGPathElement;
  label: SVGGElement | null;
  from: string;
  to: string;
  /** Mermaid's own path and label position, to restore. */
  d0: string;
  label0: string | null;
}

export interface Graph {
  kind: "flowchart" | "mindmap";
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/** Mindmap node names in the order Mermaid numbers them (node_0 is the root). */
export function mindmapNames(code: string): string[] {
  const lines = code.split("\n");
  const start = lines.findIndex((l) => l.trim() === "mindmap");
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const t = l.trim();
    if (!t || t.startsWith("::") || t.startsWith(":::") || t.startsWith("%%")) continue;
    out.push(t.match(/^([A-Za-z0-9_-]+)(?=[[({)])/)?.[1] ?? t);
  }
  return out;
}

/** "n0_n12_0" -> ["n0", "n12"], trying each split against the known node names (they may hold "_"). */
export function splitEdgeKey(rest: string, names: ReadonlySet<string>): [string, string] | null {
  const body = rest.replace(/_\d+$/, "");
  for (let i = body.indexOf("_"); i > 0; i = body.indexOf("_", i + 1)) {
    const a = body.slice(0, i);
    const b = body.slice(i + 1);
    if (names.has(a) && names.has(b)) return [a, b];
  }
  return null;
}

/**
 * For each node, the nodes that hang only from it: reachable from it, but not from the diagram's
 * roots without passing through it. Folding the node hides exactly these.
 */
export function hangingFrom(nodes: string[], edges: { from: string; to: string }[]): Map<string, Set<string>> {
  const out = new Map<string, string[]>();
  const hasIn = new Set<string>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    hasIn.add(e.to);
  }
  const roots = nodes.filter((n) => !hasIn.has(n));
  if (!roots.length && nodes.length) roots.push(nodes[0]);
  const reach = (from: string[], avoid: string | null) => {
    const seen = new Set<string>();
    const stack = from.filter((n) => n !== avoid);
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of out.get(n) ?? []) if (m !== avoid && !seen.has(m)) stack.push(m);
    }
    return seen;
  };
  const result = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (!out.get(n)?.length) continue;
    const mine = reach([n], null);
    const others = reach(roots, n);
    const only = new Set([...mine].filter((m) => m !== n && !others.has(m)));
    if (only.size) result.set(n, only);
  }
  return result;
}

export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Where the line from a box's centre towards (tx, ty) leaves the box. */
export function boundaryPoint(b: Box, tx: number, ty: number): [number, number] {
  const dx = tx - b.cx;
  const dy = ty - b.cy;
  if (!dx && !dy) return [b.cx, b.cy];
  const sx = dx ? b.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? b.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return [b.cx + dx * s, b.cy + dy * s];
}

/** A smooth path from box a to box b, leaving and arriving along the main direction between them. */
export function curveBetween(a: Box, b: Box): string {
  const [sx, sy] = boundaryPoint(a, b.cx, b.cy);
  const [tx, ty] = boundaryPoint(b, a.cx, a.cy);
  const dx = tx - sx;
  const dy = ty - sy;
  const r = (v: number) => Math.round(v * 10) / 10;
  if (Math.abs(dx) >= Math.abs(dy)) return `M${r(sx)},${r(sy)} C${r(sx + dx / 2)},${r(sy)} ${r(tx - dx / 2)},${r(ty)} ${r(tx)},${r(ty)}`;
  return `M${r(sx)},${r(sy)} C${r(sx)},${r(sy + dy / 2)} ${r(tx)},${r(ty - dy / 2)} ${r(tx)},${r(ty)}`;
}

export function parseTranslate(t: string | null): [number, number] {
  const m = t?.match(/translate\(\s*(-?[\d.e+-]+)[\s,]+(-?[\d.e+-]+)\s*\)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** A short stable hash of a diagram's code, to remember how it was arranged. */
export function codeHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Read the drawn diagram. Node ids are the names in the code ("n3", "root"); data-nid is set on each node. */
export function readGraph(box: HTMLElement, code: string): Graph | null {
  const svg = box.querySelector("svg");
  if (!svg) return null;
  const kind: Graph["kind"] = /^\s*mindmap\b/m.test(code) && !/^\s*(flowchart|graph)\b/m.test(code) ? "mindmap" : "flowchart";
  const nodes = new Map<string, GraphNode>();
  const names = kind === "mindmap" ? mindmapNames(code) : [];
  svg.querySelectorAll<SVGGElement>("g.node").forEach((g) => {
    let id: string | undefined;
    if (kind === "mindmap") {
      const k = g.id.match(/-node_(\d+)$/)?.[1];
      if (k !== undefined) id = names[Number(k)] ?? `node_${k}`;
    } else id = g.id.match(/flowchart-([A-Za-z0-9_-]+)-\d+$/)?.[1];
    if (!id || nodes.has(id)) return;
    g.dataset.nid = id;
    const [x, y] = parseTranslate(g.getAttribute("transform"));
    nodes.set(id, { id, el: g, x, y });
  });
  const known = new Set(nodes.keys());
  const edges: GraphEdge[] = [];
  svg.querySelectorAll<SVGPathElement>("path[id]").forEach((p) => {
    let key: string | null = null;
    let ends: [string, string] | null = null;
    const fl = p.id.match(/-(L_(.+))$/);
    const mm = p.id.match(/-(edge_(\d+)_(\d+))$/);
    if (kind === "flowchart" && fl) {
      key = fl[1];
      ends = splitEdgeKey(fl[2], known);
    } else if (kind === "mindmap" && mm) {
      key = mm[1];
      const a = names[Number(mm[2])];
      const b = names[Number(mm[3])];
      if (a && b) ends = [a, b];
    }
    if (!key || !ends) return;
    const label = svg.querySelector<SVGGElement>(`g.label[data-id="${CSS.escape(key)}"]`)?.closest<SVGGElement>("g.edgeLabel") ?? null;
    edges.push({ el: p, label, from: ends[0], to: ends[1], d0: p.getAttribute("d") ?? "", label0: label?.getAttribute("transform") ?? null });
  });
  return { kind, nodes, edges };
}
