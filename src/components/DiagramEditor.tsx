"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Mermaid, type NodeClick } from "./Mermaid";
import {
  addNode,
  canMoveUnder,
  connectNodes,
  copyUnder,
  diagramKey,
  disconnectNodes,
  moveUnder,
  nodeLabel,
  parseDiagram,
  removeNodes,
  renameNode,
  writeDiagram,
  type DiagramModel,
} from "@/lib/diagramModel";

/* The student's edits to diagrams, fetched once per diagram and shared by every copy of it on the page. */
const known = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function loadEdit(key: string): Promise<string | null> {
  if (known.has(key)) return Promise.resolve(known.get(key)!);
  let p = pending.get(key);
  if (!p) {
    p = api<{ edits: Record<string, string> }>(`/api/diagrams?keys=${key}`)
      .then((r) => r.edits[key] ?? null)
      .catch(() => null)
      .then((code) => {
        known.set(key, code);
        pending.delete(key);
        return code;
      });
    pending.set(key, p);
  }
  return p;
}

/** A Markdown text with the student's diagram edits, for copying or saving as a file. */
export async function withDiagramEdits(md: string): Promise<string> {
  const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)];
  if (!blocks.length) return md;
  const edits = await Promise.all(blocks.map((b) => loadEdit(diagramKey(b[1]))));
  let i = 0;
  return md.replace(/```mermaid\n([\s\S]*?)```/g, (whole) => {
    const e = edits[i++];
    return e ? "```mermaid\n" + e.trim() + "\n```" : whole;
  });
}

type Form = { mode: "rename" | "add" | "link"; value: string } | null;

/**
 * Any flowchart or mindmap in the app, editable: ✎ Edit, then click nodes to pick them (Ctrl/Shift-click
 * for several) and rename, add, link, unlink, delete or drag them onto another node (Alt to copy) — on all
 * the picked ones at once. Plus and minus signs fold branches; Collapse all and Expand all fold the whole
 * diagram. Edits are kept for this diagram wherever it shows, and Original puts it back.
 */
export function DiagramEditor({ code, fit, zoom, onNodeClick }: { code: string; fit?: boolean; zoom?: boolean; onNodeClick?: (nid: string, how: NodeClick) => void }) {
  const key = useMemo(() => diagramKey(code), [code]);
  const [edited, setEdited] = useState<string | null>(known.get(key) ?? null);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [form, setForm] = useState<Form>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useRef<(string | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadEdit(key).then((c) => live && setEdited(c));
    return () => {
      live = false;
    };
  }, [key]);

  const shown = edited ?? code;
  const model = useMemo(() => parseDiagram(shown), [shown]);
  const marks = useMemo(() => Object.fromEntries(picked.map((p) => [p, "picked"])), [picked]);

  async function commit(next: DiagramModel | null) {
    const nextCode = next ? writeDiagram(next) : null;
    if ((nextCode ?? code) === shown) return;
    history.current.push(edited);
    const keep = nextCode && nextCode.trim() !== code.trim() ? nextCode : null;
    setEdited(keep);
    known.set(key, keep);
    setError(null);
    try {
      await api("/api/diagrams", { method: "PUT", json: { original: code, code: keep } });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function undo() {
    if (!history.current.length) return;
    const prev = history.current.pop()!;
    setEdited(prev);
    known.set(key, prev);
    setPicked([]);
    await api("/api/diagrams", { method: "PUT", json: { original: code, code: prev } }).catch((e: Error) => setError(e.message));
  }

  if (!model) return <Mermaid code={shown} fit={fit} zoom={zoom} onNodeClick={onNodeClick} />;

  const ids = picked.filter((p) => model.nodes.some((n) => n.id === p));
  const one = ids.length === 1 ? ids[0] : null;
  const flow = model.kind === "flowchart";
  const name = (id: string) => nodeLabel(model, id) || id;

  const act = {
    remove: () => ids.length && (commit(removeNodes(model, ids)), setPicked([])),
    rename: () => one && setForm({ mode: "rename", value: name(one) }),
    add: () => setForm({ mode: "add", value: "" }),
    link: () => ids.length >= 2 && setForm({ mode: "link", value: "" }),
    unlink: () => ids.length >= 2 && commit(disconnectNodes(model, ids)),
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.mode === "rename" && one) commit(renameNode(model!, one, form.value));
    else if (form.mode === "add") {
      const r = addNode(model!, ids, form.value);
      commit(r.model);
      setPicked([r.id]);
    } else if (form.mode === "link") commit(connectNodes(model!, ids[0], ids.slice(1), form.value || null));
    setForm(null);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!editing || form) return;
    const t = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") (e.preventDefault(), undo());
    else if ((e.key === "Delete" || e.key === "Backspace") && ids.length) (e.preventDefault(), act.remove());
    else if (e.key === "F2" && one) (e.preventDefault(), act.rename());
    else if (e.key === "Insert" || (e.key === "Tab" && ids.length)) (e.preventDefault(), act.add());
    else if (e.key === "Escape") setPicked([]);
  }

  return (
    <div ref={box} className="diagram-editor" onKeyDown={onKey}>
      <div className="row small" style={{ justifyContent: "flex-end", gap: 4, marginBottom: 4 }}>
        {edited && !editing && <span className="muted">Edited</span>}
        <button
          className={`sm${editing ? " primary" : ""}`}
          aria-pressed={editing}
          onClick={() => {
            setEditing((v) => !v);
            setPicked([]);
            setForm(null);
          }}
          title={editing ? "Stop editing this diagram" : "Rename, add, link, move or delete its boxes"}
        >
          {editing ? "Done" : "✎ Edit"}
        </button>
      </div>
      {editing && (
        <div className="selbar" role="toolbar" aria-label="Edit this diagram">
          {ids.length ? <strong className="small">{one ? `"${name(one)}"` : `${ids.length} picked`}</strong> : <span className="small muted">Click a box to pick it (Ctrl/Shift-click for more). Drag one onto another to put it there, hold Alt to copy.</span>}
          <button className="sm" onClick={act.add} title={ids.length ? "Add a box linked from the picked ones (Tab)" : "Add a box (Insert)"}>
            + Add
          </button>
          {one && (
            <button className="sm" onClick={act.rename} title="Rename (F2)">
              ✎ Rename
            </button>
          )}
          {flow && ids.length >= 2 && (
            <>
              <button className="sm" onClick={act.link} title="Link the first picked box to each of the others">
                → Link
              </button>
              <button className="sm" onClick={act.unlink} title="Remove the links between the picked boxes">
                Unlink
              </button>
            </>
          )}
          {ids.length > 0 && (
            <button className="sm danger" onClick={act.remove} title={flow ? "Delete (Del)" : "Delete (Del); what hangs from it moves up"}>
              Delete
            </button>
          )}
          {ids.length > 0 && (
            <button className="sm ghost" onClick={() => setPicked([])}>
              Clear
            </button>
          )}
          <button className="sm" onClick={undo} disabled={!history.current.length} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          {edited && (
            <button className="sm" onClick={() => window.confirm("Put this diagram back as it was drawn? Your changes to it are dropped.") && (commit(null), setPicked([]))} title="Put the diagram back as it was drawn">
              Original
            </button>
          )}
        </div>
      )}
      {form && (
        <form className="row" onSubmit={submit} style={{ marginBottom: 6 }}>
          <input
            autoFocus
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setForm(null)}
            placeholder={form.mode === "link" ? "Label on the link (optional)" : "Text in the box"}
            aria-label={form.mode === "rename" ? "New name" : form.mode === "add" ? "New box" : "Link label"}
            style={{ flex: 1 }}
          />
          <button className="sm primary" type="submit" disabled={form.mode !== "link" && !form.value.trim()}>
            {form.mode === "rename" ? "Rename" : form.mode === "add" ? "Add" : "Link"}
          </button>
          <button className="sm" type="button" onClick={() => setForm(null)}>
            Cancel
          </button>
        </form>
      )}
      {error && (
        <div className="small" role="alert" style={{ color: "var(--dont)" }}>
          {error}
        </div>
      )}
      <Mermaid
        code={shown}
        fit={fit}
        zoom={zoom}
        marks={editing ? marks : undefined}
        onNodeClick={
          editing
            ? (nid, how) => {
                if (!model.nodes.some((n) => n.id === nid)) return setPicked([]);
                setPicked((p) => (how.extend ? (p.includes(nid) ? p.filter((x) => x !== nid) : [...p, nid]) : [nid]));
              }
            : onNodeClick
        }
        dragLabel={editing ? (nid) => (ids.includes(nid) && ids.length > 1 ? `${ids.length} boxes` : name(nid)) : undefined}
        onNodeDrop={
          editing
            ? {
                canDrop: (from, to) => canMoveUnder(model, ids.includes(from) ? ids : [from], to),
                drop: (from, to, asCopy) => {
                  const what = ids.includes(from) ? ids : [from];
                  commit(asCopy ? copyUnder(model, what, to) : moveUnder(model, what, to));
                },
              }
            : undefined
        }
      />
    </div>
  );
}
