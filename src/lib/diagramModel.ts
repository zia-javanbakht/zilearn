/*
 * Editing any Mermaid flowchart or mindmap as a graph: read the code into nodes and links, change them
 * (rename, add, delete, connect, move under another node; several at once), and write the code back.
 * Pure, so the editor in the browser and the exports on the server share it.
 */

/** A short stable hash of a diagram's code: the key its edits and arrangement are kept under. */
export function codeHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** The key a diagram's edits are kept under: the code as the app drew it. */
export const diagramKey = (code: string) => codeHash(code.trim());

/** The ```mermaid blocks of a Markdown text, with the edited version where the student changed one. */
export function withEditedDiagrams(md: string, edits: Record<string, string>): string {
  return md.replace(/```mermaid\n([\s\S]*?)```/g, (whole, code: string) => {
    const edited = edits[diagramKey(code)];
    return edited ? "```mermaid\n" + edited.trim() + "\n```" : whole;
  });
}

/** Keys of the ```mermaid blocks in a Markdown text. */
export function diagramKeys(md: string): string[] {
  return [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => diagramKey(m[1]));
}

export interface DNode {
  id: string;
  label: string;
  /** The brackets around the label as written ("[", "]"), ("((", "))"), … */
  open: string;
  close: string;
  /** Mindmap only: the node it hangs from. */
  parent?: string | null;
  /** Mindmap only: "::icon(…)" and ":::class" lines that belong to it. */
  decor?: string[];
  /** Flowchart only: the subgraph (box) it sits in. */
  group?: string | null;
}

/** A flowchart's subgraph: a labelled box around some nodes (a lesson section in a concept map). */
export interface DGroup {
  id: string;
  /** What follows the id on the subgraph line, as written ('["② Damping"]'). */
  title: string;
  /** "direction TB" and similar lines inside it. */
  lines: string[];
}

export interface DEdge {
  from: string;
  to: string;
  label: string | null;
  /** The arrow as written ("-->", "---", "-.->", "==>"). */
  arrow: string;
}

export interface DiagramModel {
  kind: "flowchart" | "mindmap";
  /** "flowchart LR", "graph TD", "mindmap". */
  header: string;
  nodes: DNode[];
  /** Flowcharts: the links. Mindmaps: derived from the parents (read-only here; change parents instead). */
  edges: DEdge[];
  /** Lines kept as written: comments ("%% jump …"), classDef, class, style, click. */
  extra: string[];
  groups?: DGroup[];
}

const SHAPES: [string, string][] = [
  ["(((", ")))"],
  ["((", "))"],
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[\\", "\\]"],
  ["[/", "\\]"],
  ["[\\", "/]"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  [">", "]"],
  [")", "("],
];

const ID = "[A-Za-z0-9_][A-Za-z0-9_-]*";

/** "a[\"Label\"]" at the start of `s`: the id, its shape and label, and how much of `s` it took. */
function nodeAt(s: string): { node: DNode; len: number } | null {
  const m = s.match(new RegExp(`^(${ID})`));
  if (!m) return null;
  const id = m[1];
  const rest = s.slice(id.length);
  for (const [open, close] of SHAPES) {
    if (!rest.startsWith(open)) continue;
    const body = rest.slice(open.length);
    // A quoted label may hold the closing brackets.
    const quoted = body.match(/^"((?:[^"\\]|\\.)*)"/);
    const inner = quoted ? quoted[0] : body.slice(0, Math.max(0, body.indexOf(close)));
    if (!body.slice(inner.length).startsWith(close)) continue;
    if (!quoted && body.indexOf(close) < 0) continue;
    return { node: { id, label: unquote(inner), open, close }, len: id.length + open.length + inner.length + close.length };
  }
  return { node: { id, label: id, open: "", close: "" }, len: id.length };
}

function unquote(s: string): string {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1) : t;
}

/** A label as Mermaid needs it: quoted, with what would end the quote written as entity codes. */
export function quoteLabel(label: string): string {
  return `"${label.replace(/"/g, "#quot;").replace(/[\r\n]+/g, " ")}"`;
}

/** Plain text of a label as written in the code, for editing ("zeta #lt; 1" reads "zeta < 1"). */
export function labelText(label: string): string {
  return label
    .replace(/#quot;/g, '"')
    .replace(/#lt;/g, "<")
    .replace(/#gt;/g, ">")
    .replace(/#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/<\/?(sub|sup|b|i|em|strong)>/gi, "")
    .replace(/<br\s*\/?>/gi, " ");
}

/** Text typed by the student, as a label: what Mermaid would read as syntax is written as codes. */
function encodeLabel(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;").trim();
}

const ARROW = /^\s*(<?(?:-{2,3}|-\.+-|={2,3})(?:>|x|o)?|<?-\.+->|<?={2,}>)\s*/;

/** Reads a flowchart or mindmap; null for any other kind of diagram, or one this editor can't safely change. */
export function parseDiagram(code: string): DiagramModel | null {
  const lines = code.replace(/\r/g, "").split("\n");
  const first = lines.findIndex((l) => l.trim() && !l.trim().startsWith("%%"));
  if (first < 0) return null;
  const header = lines[first].trim();
  if (/^mindmap\b/.test(header)) return parseMindmap(lines.slice(first + 1), lines.slice(0, first));
  if (!/^(flowchart|graph)\b/.test(header)) return null;
  const nodes = new Map<string, DNode>();
  const edges: DEdge[] = [];
  const groups: DGroup[] = [];
  let group: DGroup | null = null;
  const extra = lines.slice(0, first).filter((l) => l.trim());
  const define = (n: DNode) => {
    const had = nodes.get(n.id);
    // A bare mention ("a --> b") doesn't overwrite a node's label; a node belongs to the box it is defined in.
    if (!had || n.open) nodes.set(n.id, { ...n, group: n.open || !had ? (group?.id ?? null) : had.group });
  };
  for (const raw of lines.slice(first + 1)) {
    const line = raw.trim().replace(/;$/, "");
    if (!line) continue;
    if (/^(%%|classDef\b|class\b|style\b|click\b|linkStyle\b)/.test(line)) {
      extra.push(raw);
      continue;
    }
    const sub = line.match(new RegExp(`^subgraph\\s+(${ID})(.*)$`));
    if (sub) {
      // One level of boxes; a box inside a box is beyond this editor.
      if (group) return null;
      group = { id: sub[1], title: sub[2], lines: [] };
      groups.push(group);
      continue;
    }
    if (line === "end" && group) {
      group = null;
      continue;
    }
    if (/^direction\b/.test(line) && group) {
      group.lines.push(line);
      continue;
    }
    // Unnamed boxes, a stray "end" or "direction", and "&" chains are beyond this editor.
    if (/^(subgraph|end|direction)\b/.test(line) || /\s&\s/.test(line)) return null;
    let rest = line;
    const head = nodeAt(rest);
    if (!head) return null;
    define(head.node);
    rest = rest.slice(head.len);
    let from = head.node.id;
    // "a --> b", "a -->|text| b", "a -- text --> b", chains "a --> b --> c".
    while (rest.trim()) {
      let label: string | null = null;
      let arrow: string;
      const textArrow = rest.match(/^\s*(--|==|-\.)\s+(.+?)\s+(-->|---|==>|-\.->)\s*/);
      if (textArrow) {
        label = unquote(textArrow[2]);
        arrow = textArrow[3];
        rest = rest.slice(textArrow[0].length);
      } else {
        const a = rest.match(ARROW);
        if (!a) return null;
        arrow = a[1];
        rest = rest.slice(a[0].length);
        const pipe = rest.match(/^\|([^|]*)\|\s*/);
        if (pipe) {
          label = unquote(pipe[1]);
          rest = rest.slice(pipe[0].length);
        }
      }
      const to = nodeAt(rest.trim());
      if (!to) return null;
      rest = rest.trim().slice(to.len);
      define(to.node);
      edges.push({ from, to: to.node.id, label, arrow });
      from = to.node.id;
    }
  }
  if (group) return null;
  return { kind: "flowchart", header, nodes: [...nodes.values()], edges, extra, groups };
}

function parseMindmap(lines: string[], before: string[]): DiagramModel | null {
  const nodes: DNode[] = [];
  const stack: { indent: number; id: string }[] = [];
  const extra = before.filter((l) => l.trim());
  let auto = 0;
  const used = new Set<string>();
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const t = raw.trim();
    if (t.startsWith("%%")) {
      extra.push(raw);
      continue;
    }
    if (t.startsWith("::")) {
      const last = nodes[nodes.length - 1];
      if (last) (last.decor ??= []).push(t);
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    let n: DNode;
    const withId = t.match(new RegExp(`^(${ID})(?=[[({)])`)) ? nodeAt(t) : null;
    if (withId && withId.len === t.length) n = withId.node;
    else {
      // A bare label ("Topic") is a node too; give it a name to address it by.
      let id = `m${auto++}`;
      while (used.has(id)) id = `m${auto++}`;
      n = { id, label: t, open: "", close: "" };
    }
    if (used.has(n.id)) return null;
    used.add(n.id);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    n.parent = stack.length ? stack[stack.length - 1].id : null;
    stack.push({ indent, id: n.id });
    nodes.push(n);
  }
  if (!nodes.length) return null;
  return { kind: "mindmap", header: "mindmap", nodes, edges: mindmapEdges(nodes), extra };
}

function mindmapEdges(nodes: DNode[]): DEdge[] {
  return nodes.filter((n) => n.parent).map((n) => ({ from: n.parent!, to: n.id, label: null, arrow: "" }));
}

/** Writes the model back as Mermaid code. */
export function writeDiagram(d: DiagramModel): string {
  if (d.kind === "mindmap") {
    const out = [...d.extra.filter((l) => !/^\s*%%\s*jump\b/.test(l)), "mindmap"];
    const kids = new Map<string | null, DNode[]>();
    for (const n of d.nodes) (kids.get(n.parent ?? null) ?? kids.set(n.parent ?? null, []).get(n.parent ?? null)!).push(n);
    const walk = (parent: string | null, depth: number) => {
      for (const n of kids.get(parent) ?? []) {
        const pad = "  ".repeat(depth + 1);
        // Bare labels keep the generated name out of the drawing.
        out.push(pad + (n.open ? `${n.id}${n.open}${mindmapLabel(n.label)}${n.close}` : /^m\d+$/.test(n.id) ? mindmapLabel(n.label) : `${n.id}[${mindmapLabel(n.label)}]`));
        for (const dline of n.decor ?? []) out.push(pad + "  " + dline);
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out.join("\n");
  }
  const ids = new Set(d.nodes.map((n) => n.id));
  const out = [d.header];
  // Labels are kept as written (entity codes and all), so a node's text survives a round trip unchanged.
  const def = (n: DNode, pad: string) => (n.open ? `${pad}${n.id}${n.open}${quoteLabel(n.label)}${n.close}` : `${pad}${n.id}`);
  const live = new Set<string>();
  for (const g of d.groups ?? []) {
    const members = d.nodes.filter((n) => n.group === g.id);
    // An emptied box would be drawn as an empty frame.
    if (!members.length) continue;
    live.add(g.id);
    out.push(`  subgraph ${g.id}${g.title}`, ...g.lines.map((l) => `    ${l}`), ...members.map((n) => def(n, "    ")), "  end");
  }
  for (const n of d.nodes) if (!n.group || !live.has(n.group)) out.push(def(n, "  "));
  for (const e of d.edges) if (ids.has(e.from) && ids.has(e.to)) out.push(`  ${e.from} ${e.arrow || "-->"}${e.label ? `|${quoteLabel(e.label)}|` : ""} ${e.to}`);
  for (const l of d.extra) {
    // Classes and styles of nodes that are gone would stop the diagram drawing.
    const cls = l.trim().match(/^class\s+([^\s]+)\s+(\S+)/);
    if (cls) {
      const keep = cls[1].split(",").filter((x) => ids.has(x));
      if (keep.length) out.push(`  class ${keep.join(",")} ${cls[2]}`);
      continue;
    }
    const st = l.trim().match(/^(style|click)\s+(\S+)/);
    if (st && !ids.has(st[2]) && !live.has(st[2])) continue;
    // Link styles count links by position, which edits change; the app's jump lines go with their node.
    if (/^\s*linkStyle\b/.test(l)) continue;
    const jump = l.trim().match(/^%%\s*jump\s+(\S+)/);
    if (jump && !ids.has(jump[1])) continue;
    out.push(l);
  }
  return out.join("\n");
}

function mindmapLabel(s: string): string {
  // Brackets are shape syntax in a mindmap: "Finite element (FE)" reads "Finite element · FE".
  return s.replace(/\s*\(([^()]+)\)/g, " · $1").replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim() || "untitled";
}

/* ---------------- Edits ---------------- */

const copy = (d: DiagramModel): DiagramModel => JSON.parse(JSON.stringify(d));

function finish(d: DiagramModel): DiagramModel {
  if (d.kind === "mindmap") d.edges = mindmapEdges(d.nodes);
  return d;
}

/** Nodes below `id` (in a mindmap, its subtree; in a flowchart, what its links lead to). */
export function below(d: DiagramModel, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    for (const e of d.edges) if (e.from === n && !out.has(e.to) && e.to !== id) (out.add(e.to), stack.push(e.to));
  }
  return out;
}

export function renameNode(d: DiagramModel, id: string, text: string): DiagramModel {
  const label = encodeLabel(text);
  if (!label) return d;
  const out = copy(d);
  const n = out.nodes.find((x) => x.id === id);
  if (n) {
    n.label = label;
    if (out.kind === "flowchart" && !n.open) [n.open, n.close] = ["[", "]"];
  }
  return out;
}

/** Delete nodes. In a mindmap what hung from a deleted node moves up to its parent, so nothing else is lost. */
export function removeNodes(d: DiagramModel, ids: string[]): DiagramModel {
  const out = copy(d);
  const drop = new Set(ids);
  if (out.kind === "mindmap") {
    // The root holds the map together: it can be renamed, not deleted.
    const root = out.nodes.find((n) => !n.parent);
    if (root) drop.delete(root.id);
    const parentOf = (id: string | null | undefined): string | null => {
      let p = id ?? null;
      while (p && drop.has(p)) p = out.nodes.find((n) => n.id === p)?.parent ?? null;
      return p;
    };
    for (const n of out.nodes) if (!drop.has(n.id)) n.parent = parentOf(n.parent);
  }
  out.nodes = out.nodes.filter((n) => !drop.has(n.id));
  out.edges = out.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to));
  return finish(out);
}

function freshId(d: DiagramModel): string {
  const ids = new Set(d.nodes.map((n) => n.id));
  let i = d.nodes.length;
  while (ids.has(`x${i}`)) i++;
  return `x${i}`;
}

/** Add a node: under (linked from) each of `parents`, or on its own (a mindmap's goes under the root). Returns its id too. */
export function addNode(d: DiagramModel, parents: string[], text: string): { model: DiagramModel; id: string } {
  const out = copy(d);
  const id = freshId(out);
  const label = encodeLabel(text) || "New";
  if (out.kind === "mindmap") {
    const root = out.nodes.find((n) => !n.parent);
    const parent = parents.find((p) => out.nodes.some((n) => n.id === p)) ?? root?.id ?? null;
    out.nodes.push({ id, label, open: "[", close: "]", parent });
  } else {
    // A new node joins the box of the node it hangs from (a new term in that section).
    const group = out.nodes.find((n) => n.id === parents[0])?.group ?? null;
    out.nodes.push({ id, label, open: "[", close: "]", group });
    for (const p of parents) if (out.nodes.some((n) => n.id === p)) out.edges.push({ from: p, to: id, label: null, arrow: "-->" });
  }
  return { model: finish(out), id };
}

/** Link the first picked node to each of the others (flowcharts), with an optional label on the links. */
export function connectNodes(d: DiagramModel, from: string, to: string[], label: string | null = null): DiagramModel {
  if (d.kind !== "flowchart") return moveUnder(d, to, from);
  const out = copy(d);
  for (const t of to)
    if (t !== from && !out.edges.some((e) => e.from === from && e.to === t)) out.edges.push({ from, to: t, label: label?.trim() ? encodeLabel(label) : null, arrow: "-->" });
  return out;
}

/** Remove the links between any two of the picked nodes. */
export function disconnectNodes(d: DiagramModel, ids: string[]): DiagramModel {
  if (d.kind !== "flowchart") return d;
  const set = new Set(ids);
  const out = copy(d);
  out.edges = out.edges.filter((e) => !(set.has(e.from) && set.has(e.to)));
  return out;
}

/** Whether `ids` can go under `target` (not under themselves or something below them in a mindmap). */
export function canMoveUnder(d: DiagramModel, ids: string[], target: string): boolean {
  if (ids.includes(target) || !d.nodes.some((n) => n.id === target)) return false;
  if (d.kind === "mindmap") return !ids.some((id) => below(d, id).has(target));
  return true;
}

/**
 * Put nodes under another: in a mindmap they (with what hangs from them) become its children; in a
 * flowchart their incoming links are replaced by one from the target.
 */
export function moveUnder(d: DiagramModel, ids: string[], target: string): DiagramModel {
  if (!canMoveUnder(d, ids, target)) return d;
  const out = copy(d);
  const set = new Set(ids);
  if (out.kind === "mindmap") {
    // A picked node inside another picked one keeps its place in that one.
    for (const n of out.nodes) if (set.has(n.id) && !ids.some((o) => o !== n.id && below(d, o).has(n.id))) n.parent = target;
  } else {
    const kept = out.edges.filter((e) => !set.has(e.to));
    const moved = ids.map((id) => ({ from: target, to: id, label: out.edges.find((e) => e.to === id)?.label ?? null, arrow: out.edges.find((e) => e.to === id)?.arrow ?? "-->" }));
    out.edges = [...kept, ...moved];
  }
  return finish(out);
}

/** Copy nodes (with what hangs from them in a mindmap) under a target. */
export function copyUnder(d: DiagramModel, ids: string[], target: string): DiagramModel {
  if (!d.nodes.some((n) => n.id === target)) return d;
  let out = copy(d);
  if (out.kind === "flowchart") {
    for (const id of ids) {
      const src = out.nodes.find((n) => n.id === id);
      if (!src) continue;
      const r = addNode(out, [target], labelText(src.label));
      out = r.model;
    }
    return out;
  }
  const clone = (id: string, parent: string) => {
    const src = d.nodes.find((n) => n.id === id);
    if (!src) return;
    const r = addNode(out, [parent], labelText(src.label));
    out = r.model;
    for (const c of d.nodes.filter((n) => n.parent === id)) clone(c.id, r.id);
  };
  for (const id of ids) if (!ids.some((o) => o !== id && below(d, o).has(id))) clone(id, target);
  return out;
}

export function nodeLabel(d: DiagramModel, id: string): string {
  const n = d.nodes.find((x) => x.id === id);
  return n ? labelText(n.label) : "";
}
