import type { TopicNode } from "./types";

/* The brainmap as an indented list, for editing many topics at once as text. Pure, used by the client. */

export interface OutlineLine {
  /** The topic the line was made from, or null for a new topic. */
  id: string | null;
  title: string;
  depth: number;
}

const INDENT = "  ";

/** One line per topic, two spaces per level, in map order. */
export function outlineText(roots: TopicNode[]): { text: string; lines: OutlineLine[] } {
  const lines: OutlineLine[] = [];
  const walk = (ns: TopicNode[], depth: number) => ns.forEach((n) => (lines.push({ id: n.id, title: n.title, depth }), walk(n.children, depth + 1)));
  walk(roots, 0);
  return { text: lines.map((l) => `${INDENT.repeat(l.depth)}${l.title}`).join("\n"), lines };
}

/** Lines of an edited outline with their depth; bullets ("-", "*", "•", "1.") are dropped. */
export function readOutline(text: string): { title: string; depth: number }[] {
  const out: { title: string; depth: number }[] = [];
  const indents: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, INDENT);
    const title = line.trim().replace(/^(?:[-*•+]|\d+[.)])\s+/, "").trim();
    if (!title) continue;
    const indent = line.length - line.trimStart().length;
    // Depth is the number of open indents shallower than this line.
    while (indents.length && indents[indents.length - 1] >= indent) indents.pop();
    out.push({ title, depth: indents.length });
    indents.push(indent);
  }
  return out;
}

/**
 * Match the lines of an edited outline to the topics they came from. Lines keep their topic when the
 * name is unchanged (wherever they moved to); an edited name between two kept lines is taken as a
 * rename of the topic that sat there. Anything else is a new topic.
 */
export function matchOutline(before: OutlineLine[], text: string): OutlineLine[] {
  const after = readOutline(text);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const used = new Set<number>();
  const match: (number | null)[] = after.map(() => null);
  // 1. Same name; prefer the topic at the same line, else the first unused one with that name.
  const byName = new Map<string, number[]>();
  before.forEach((l, i) => byName.set(norm(l.title), [...(byName.get(norm(l.title)) ?? []), i]));
  after.forEach((l, i) => {
    const options = (byName.get(norm(l.title)) ?? []).filter((j) => !used.has(j));
    const j = options.includes(i) ? i : options[0];
    if (j !== undefined) (used.add(j), (match[i] = j));
  });
  // 2. Renames: between two matched lines, pair the unmatched old and new lines in order.
  let lastOld = -1;
  for (let i = 0; i < after.length; ) {
    if (match[i] !== null) {
      lastOld = match[i]!;
      i++;
      continue;
    }
    let end = i;
    while (end < after.length && match[end] === null) end++;
    const nextOld = end < after.length ? match[end]! : before.length;
    const free = [];
    for (let j = lastOld + 1; j < nextOld; j++) if (!used.has(j)) free.push(j);
    for (let k = i; k < end && free.length; k++) {
      const j = free.shift()!;
      used.add(j);
      match[k] = j;
    }
    i = end;
  }
  return after.map((l, i) => ({ ...l, id: match[i] === null ? null : before[match[i]!].id }));
}

/** What applying an edited outline would change, for showing before it is applied. */
export function outlineDiff(before: OutlineLine[], after: OutlineLine[]) {
  const was = new Map(before.map((l, i) => [l.id, { ...l, i }]));
  const kept = new Set(after.map((l) => l.id).filter(Boolean));
  const parentOf = (ls: OutlineLine[]) => {
    const out = new Map<string | null, string | null>();
    const stack: (string | null)[] = [];
    for (const l of ls) {
      stack.length = l.depth;
      out.set(l.id, l.depth ? stack[l.depth - 1] ?? null : null);
      stack[l.depth] = l.id ?? `new:${out.size}`;
    }
    return out;
  };
  const p0 = parentOf(before);
  const p1 = parentOf(after);
  return {
    added: after.filter((l) => !l.id).map((l) => l.title),
    renamed: after.filter((l) => l.id && was.get(l.id)!.title !== l.title).map((l) => ({ from: was.get(l.id)!.title, to: l.title })),
    moved: after.filter((l) => l.id && p0.get(l.id) !== p1.get(l.id)).length,
    removed: before.filter((l) => !kept.has(l.id)).map((l) => l.title),
  };
}
