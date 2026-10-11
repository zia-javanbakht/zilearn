import type { Mastery, TopicNode } from "./types";

/** Give each node its own mark, or else the nearest marked ancestor's. Mutates and returns `roots`. */
export function inheritMastery(roots: TopicNode[], parent: Mastery | null = null): TopicNode[] {
  for (const n of roots) {
    n.effective_mastery = n.mastery ?? parent;
    inheritMastery(n.children, n.effective_mastery);
  }
  return roots;
}

/**
 * The tree after marking a topic, matching what the server stores (see `setMastery`):
 * marking a branch clears its descendants' own marks so they inherit the new one.
 * Pure, so the brainmap can update before the server answers.
 */
export function applyMark(roots: TopicNode[], topicId: string | null, mastery: Mastery | null, branch = true): TopicNode[] {
  const copy = (ns: TopicNode[], clearing: boolean): TopicNode[] =>
    ns.map((n) => {
      const hit = topicId === null || n.id === topicId;
      const own = hit && topicId !== null ? mastery : clearing ? null : n.mastery;
      return { ...n, mastery: own, children: copy(n.children, clearing || (hit && topicId !== null && branch)) };
    });
  // topicId null marks every top-level branch.
  const next = topicId === null ? roots.map((r) => ({ ...r, mastery, children: copy(r.children, true) })) : copy(roots, false);
  return inheritMastery(next);
}
