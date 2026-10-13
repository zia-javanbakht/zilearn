import { db } from "./db";
import { diagramKey, labelText, parseDiagram, withEditedDiagrams } from "./diagramModel";
import { diagramMermaid, type DiagramSpec } from "./figure";
import type { LessonDoc } from "./lesson";

/*
 * Diagrams the student edited anywhere in the app (a lesson's figure or concept map, a note, the
 * knowledge map), kept by the code they were drawn from, so the edit shows wherever that diagram does
 * and goes into exports.
 */

export function diagramEdits(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!keys.length) return out;
  const rows = db()
    .prepare(`SELECT key, code FROM diagram_edits WHERE key IN (${keys.map(() => "?").join(",")})`)
    .all(...keys) as { key: string; code: string }[];
  for (const r of rows) out[r.key] = r.code;
  return out;
}

/** Keep an edited diagram (the code it was drawn from, and the code it is now); null puts the original back. */
export function saveDiagramEdit(original: string, code: string | null) {
  const key = diagramKey(original);
  if (code === null || code.trim() === original.trim()) db().prepare("DELETE FROM diagram_edits WHERE key = ?").run(key);
  else db().prepare("INSERT INTO diagram_edits (key, code) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET code = excluded.code, updated_at = datetime('now')").run(key, code);
}

/** A Markdown text with the student's edits to its diagrams. */
export function applyDiagramEdits(md: string): string {
  const keys = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => diagramKey(m[1]));
  return keys.length ? withEditedDiagrams(md, diagramEdits(keys)) : md;
}

/** A lesson with the student's edits to its figures' diagrams, for exports that draw them (TikZ). */
export function lessonWithDiagramEdits(doc: LessonDoc): LessonDoc {
  const figures = doc.sections.flatMap((s) => s.blocks.map((b) => b.figure?.diagram).filter((d): d is DiagramSpec => !!d));
  if (!figures.length) return doc;
  const edits = diagramEdits(figures.map((d) => diagramKey(diagramMermaid(d))));
  if (!Object.keys(edits).length) return doc;
  const out: LessonDoc = JSON.parse(JSON.stringify(doc));
  for (const s of out.sections)
    for (const b of s.blocks) {
      const d = b.figure?.diagram;
      const edited = d && edits[diagramKey(diagramMermaid(d))];
      const spec = edited ? specOf(edited, d) : null;
      if (spec) b.figure!.diagram = spec;
    }
  return out;
}

/** An edited flowchart as a figure's diagram again (ids without Mermaid's "n_" prefix). */
function specOf(code: string, was: DiagramSpec): DiagramSpec | null {
  const m = parseDiagram(code);
  if (!m || m.kind !== "flowchart" || !m.nodes.length) return null;
  const id = (x: string) => x.replace(/^n_/, "");
  return {
    direction: /\b(TD|TB)\b/.test(m.header) ? "TD" : was.direction,
    nodes: m.nodes.map((n) => ({ id: id(n.id), label: labelText(n.label) })),
    edges: m.edges.map((e) => ({ from: id(e.from), to: id(e.to), label: e.label ? labelText(e.label) : null })),
  };
}

