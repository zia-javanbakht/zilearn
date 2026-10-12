import type { Digest, DigestTopic } from "./types";

/*
 * Editing a material's topic map (its digest): two levels, topics and their subtopics. Items are
 * addressed by the node names of digestMindmap ("n0", "n1"…, in map order; "root" is the material).
 */

export type DigestPath = [number] | [number, number];

/** Node name -> where the item sits, in the order digestMindmap names them. */
export function digestPaths(d: Digest): Record<string, DigestPath> {
  const out: Record<string, DigestPath> = {};
  let i = 0;
  d.topics.forEach((t, ti) => {
    out[`n${i++}`] = [ti];
    (t.subtopics ?? []).forEach((_, si) => (out[`n${i++}`] = [ti, si]));
  });
  return out;
}

const clone = (d: Digest): Digest => JSON.parse(JSON.stringify(d));
const at = (d: Digest, p: DigestPath): DigestTopic | undefined => (p.length === 1 ? d.topics[p[0]] : d.topics[p[0]]?.subtopics?.[p[1]]);

/** Whether `to` is one of `from` or inside one of them (a topic can't go into its own subtopic). */
export function insideAny(d: Digest, from: string[], to: string): boolean {
  const paths = digestPaths(d);
  const t = paths[to];
  if (!t) return false;
  return from.some((f) => {
    const p = paths[f];
    return !!p && p[0] === t[0] && (p.length === 1 || (t.length === 2 && p[1] === t[1]));
  });
}

/**
 * Move (or copy) items onto a target: onto the material ("root") they become topics; onto a topic,
 * its subtopics (a topic brings its own subtopics along, after it); onto a subtopic, they go right
 * after it. Topics keep their order in the map.
 */
export function moveDigestItems(d: Digest, names: string[], target: string, copy = false): Digest {
  const out = clone(d);
  const paths = digestPaths(out);
  const items = names
    .map((n) => paths[n])
    .filter((p): p is DigestPath => !!p)
    .sort((a, b) => a[0] - b[0] || (a[1] ?? -1) - (b[1] ?? -1));
  // A subtopic whose topic is moving too goes with its topic.
  const chosen = items.filter((p) => p.length === 1 || !items.some((q) => q.length === 1 && q[0] === p[0]));
  if (!chosen.length || (target !== "root" && insideAny(d, names, target) && !copy)) return d;
  const objs = chosen.map((p) => at(out, p)!);
  const targetObj = target === "root" ? null : at(out, paths[target]);
  if (target !== "root" && !targetObj) return d;
  const targetIsSub = target !== "root" && paths[target].length === 2;
  const targetParent = targetIsSub ? out.topics[paths[target][0]] : null;

  const moved = copy ? objs.map((o) => JSON.parse(JSON.stringify(o)) as DigestTopic) : objs;
  if (!copy) {
    const drop = new Set(objs);
    out.topics = out.topics.filter((t) => !drop.has(t));
    for (const t of out.topics) if (t.subtopics) t.subtopics = t.subtopics.filter((s) => !drop.has(s));
  }
  // Two levels only: a topic that becomes a subtopic brings its own subtopics along as siblings.
  const flat = (list: DigestTopic[]) => list.flatMap((o) => [{ ...o, subtopics: undefined }, ...(o.subtopics ?? []).map((s) => ({ ...s, subtopics: undefined }))]).map(tidy);
  if (target === "root") {
    out.topics.push(...moved.map((o) => ({ ...o, subtopics: o.subtopics ?? [] })));
  } else if (targetIsSub) {
    const subs = targetParent!.subtopics ?? [];
    const i = subs.indexOf(targetObj!);
    subs.splice(i < 0 ? subs.length : i + 1, 0, ...flat(moved));
    targetParent!.subtopics = subs;
  } else {
    targetObj!.subtopics = [...(targetObj!.subtopics ?? []), ...flat(moved)];
  }
  return out;
}

function tidy(t: DigestTopic): DigestTopic {
  const { subtopics: _drop, ...rest } = t;
  void _drop;
  return rest;
}

export function removeDigestItems(d: Digest, names: string[]): Digest {
  const out = clone(d);
  const paths = digestPaths(out);
  const drop = new Set(names.map((n) => paths[n] && at(out, paths[n])).filter(Boolean));
  out.topics = out.topics.filter((t) => !drop.has(t));
  for (const t of out.topics) if (t.subtopics) t.subtopics = t.subtopics.filter((s) => !drop.has(s));
  return out;
}

export function renameDigestItem(d: Digest, name: string, title: string): Digest {
  const out = clone(d);
  const p = digestPaths(out)[name];
  const item = p && at(out, p);
  if (item && title.trim()) item.title = title.trim().slice(0, 120);
  return out;
}

/** The title of an item, for labels. */
export function digestTitle(d: Digest, name: string): string {
  const p = digestPaths(d)[name];
  return (p && at(d, p)?.title) || "";
}
