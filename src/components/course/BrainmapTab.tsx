"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Busy } from "../Busy";
import { Markdown } from "../Markdown";
import { Mermaid, type NodeClick } from "../Mermaid";
import { startDrag, type DropTarget } from "../pointerDrag";
import { LessonModal } from "./LessonModal";
import { toFlowchart, toMindmap } from "@/lib/mermaid";
import { matchOutline, outlineDiff, outlineText, type OutlineLine } from "@/lib/outlineText";
import { applyMark } from "@/lib/tree";
import { DEPTH_LEVELS, MASTERY_LABELS, MATERIAL_KIND_LABELS, type Mastery, type TopicNode } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

interface BrainmapView {
  tree: TopicNode[];
  by?: string;
}

interface Related {
  topic_id: string;
  title: string;
  course_id: string;
  course_name: string;
  relation: string | null;
}

interface BatchResult {
  ids?: string[];
  undo?: string | null;
  undone?: string;
  removed?: number;
  changes?: { added: number; renamed: number; moved: number; removed: number };
}

const MARKS: Mastery[] = ["know", "familiar", "dont_know"];
const SHORT: Record<Mastery, string> = { know: "Know", familiar: "Familiar", dont_know: "Don't know" };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function BrainmapTab({ data, reload, onPlan }: { data: CourseData; reload: () => void; onPlan: () => void }) {
  const id = data.course.id;
  const [view, setView] = useState<BrainmapView | null>(null);
  const [mode, setMode] = useState<"map" | "mindmap" | "outline">("map");
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("topic"),
  );
  const [focus, setFocus] = useState<string | null>(selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lesson, setLesson] = useState<{ id: string; title: string; depth: number; achieved: number } | null>(null);
  const [adding, setAdding] = useState(false);
  // Several topics picked at once (Ctrl/Cmd/Shift-click or the outline's tick boxes), for batch actions.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [clip, setClip] = useState<{ mode: "cut" | "copy"; ids: string[] } | null>(null);
  // Branches opened or closed with the plus and minus signs on the map.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [textEdit, setTextEdit] = useState(false);
  const [batchEdit, setBatchEdit] = useState(false);
  const anchor = useRef<string | null>(null);

  const load = () => api<BrainmapView>(`/api/courses/${id}/brainmap`).then(setView).catch((e) => setError(e.message));
  const refreshUndo = () =>
    api<{ undo: string | null }>(`/api/courses/${id}/topics/batch`)
      .then((r) => setUndoLabel(r.undo))
      .catch(() => {});
  useEffect(() => {
    load();
    refreshUndo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const flat = useMemo(() => {
    const out = new Map<string, TopicNode>();
    const walk = (ns: TopicNode[]) => ns.forEach((n) => (out.set(n.id, n), walk(n.children)));
    if (view) walk(view.tree);
    return out;
  }, [view]);

  // Forget picks of topics that no longer exist.
  useEffect(() => {
    setPicked((p) => (p.size && [...p].some((x) => !flat.has(x)) ? new Set([...p].filter((x) => flat.has(x))) : p));
    setClip((c) => (c && c.ids.some((x) => !flat.has(x)) ? (c.ids.some((x) => flat.has(x)) ? { ...c, ids: c.ids.filter((x) => flat.has(x)) } : null) : c));
  }, [flat]);

  // The coloured map and the mindmap are two drawings of the same tree, edited the same way.
  const flow = useMemo(
    () => (view ? (mode === "mindmap" ? toMindmap : toFlowchart)(data.course.name, view.tree, { focusId: focus, open, closed }) : null),
    [view, mode, focus, open, closed, data.course.name],
  );
  const nidOf = useMemo(() => new Map(Object.entries(flow?.nodeIds ?? {}).map(([nid, tid]) => [tid, nid])), [flow]);

  const targets = useMemo(() => (picked.size ? [...flat.keys()].filter((k) => picked.has(k)) : selected && flat.has(selected) ? [selected] : []), [picked, selected, flat]);

  const marks = useMemo(() => {
    const m: Record<string, string> = {};
    const add = (tid: string, cls: string) => {
      const nid = nidOf.get(tid);
      if (nid) m[nid] = `${m[nid] ?? ""} ${cls}`;
    };
    picked.forEach((t) => add(t, "picked"));
    if (clip?.mode === "cut") clip.ids.forEach((t) => add(t, "cut"));
    if (selected) add(selected, "current");
    return m;
  }, [nidOf, picked, clip, selected]);

  /** Whether `target` is one of `ids` or inside one of their branches. */
  function inBranch(ids: string[], target: string | null) {
    const set = new Set(ids);
    for (let t = target, hops = 0; t && hops < 1000; t = flat.get(t)?.parent_id ?? null, hops++) if (set.has(t)) return true;
    return false;
  }

  const leavesInOrder = useMemo(() => [...flat.values()].filter((n) => !n.children.length), [flat]);
  function nextUnmarked() {
    const start = Math.max(0, leavesInOrder.findIndex((n) => n.id === selected) + 1);
    const next = [...leavesInOrder.slice(start), ...leavesInOrder.slice(0, start)].find((n) => !n.effective_mastery);
    if (next) {
      setSelected(next.id);
      setFocus(next.parent_id ?? next.id);
    }
  }

  function flash(text: string) {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), 6000);
  }

  /** Click on a topic: select it; Ctrl/Cmd adds it to the picked topics, Shift picks the range from the last one. */
  function pick(tid: string, how: NodeClick) {
    if (how.shift && anchor.current && flat.has(anchor.current)) {
      const order = [...flat.keys()];
      const [a, b] = [order.indexOf(anchor.current), order.indexOf(tid)].sort((x, y) => x - y);
      setPicked(new Set([...picked, ...order.slice(a, b + 1)]));
    } else if (how.extend) {
      const s = new Set(picked);
      if (!s.size && selected && selected !== tid && flat.has(selected)) s.add(selected);
      if (s.has(tid)) s.delete(tid);
      else s.add(tid);
      setPicked(s);
      anchor.current = tid;
    } else {
      setPicked(new Set());
      anchor.current = tid;
    }
    setSelected(tid);
    setConfirmDelete(false);
  }

  function togglePicked(tid: string) {
    const s = new Set(picked);
    if (s.has(tid)) s.delete(tid);
    else s.add(tid);
    setPicked(s);
    anchor.current = tid;
  }

  function describe(ids: string[]) {
    const tops = ids.filter((x) => !inBranch(ids.filter((y) => y !== x), x));
    return tops.length === 1 ? `"${flat.get(tops[0])?.title ?? "topic"}"` : plural(tops.length, "topic");
  }

  function showInMap(parent: string | null) {
    if (!parent) return;
    setOpen((o) => new Set(o).add(parent));
    setClosed((c) => {
      const n = new Set(c);
      for (let t: string | null = parent, hops = 0; t && hops < 1000; t = flat.get(t)?.parent_id ?? null, hops++) n.delete(t);
      return n;
    });
    setFocus(parent);
  }

  // Keyboard: 1 know, 2 familiar, 3 don't know, 0 clear, n next unmarked, e edit; Ctrl/Cmd+X, C, V and Z;
  // Delete removes the selection, Escape clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable || lesson || textEdit) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey && undoLabel) (e.preventDefault(), undo());
        else if (k === "x" && targets.length) (e.preventDefault(), cut());
        else if (k === "c" && targets.length && !window.getSelection()?.toString()) (e.preventDefault(), copy());
        else if (k === "v" && clip) (e.preventDefault(), paste());
        return;
      }
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const map: Record<string, Mastery | null> = { "1": "know", "2": "familiar", "3": "dont_know", "0": null };
      if (e.key in map && picked.size) {
        e.preventDefault();
        markMany(map[e.key]);
      } else if (e.key in map && selected) {
        e.preventDefault();
        const node = flat.get(selected);
        mark(selected, map[e.key], true).then(() => {
          if (node && !node.children.length) nextUnmarked();
        });
      } else if (e.key === "e" && targets.length) {
        e.preventDefault();
        setBatchEdit(true);
      } else if (e.key === "n") {
        e.preventDefault();
        nextUnmarked();
      } else if ((e.key === "Delete" || e.key === "Backspace") && targets.length) {
        e.preventDefault();
        setConfirmDelete(true);
      } else if (e.key === "Escape" && (picked.size || clip || confirmDelete)) {
        setPicked(new Set());
        setClip(null);
        setConfirmDelete(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const counts = useMemo(() => {
    const c = { know: 0, familiar: 0, dont_know: 0, none: 0 };
    for (const n of flat.values()) if (!n.children.length) c[n.effective_mastery ?? "none"]++;
    return c;
  }, [flat]);

  async function build() {
    if (data.tree.length && !confirm("Rebuild the brainmap from all materials? Marks carry over to topics with the same name, and topics you added, edited or moved stay where you put them.")) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api<BrainmapView>(`/api/courses/${id}/brainmap`, { method: "POST" });
      setView(v);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Marks show at once; the requests run one after another so the server ends in the same state.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function persist(req: () => Promise<unknown>) {
    const p = queue.current.then(req).catch((e) => {
      setError((e as Error).message);
      return load();
    });
    queue.current = p;
    return p;
  }

  async function mark(topicId: string, mastery: Mastery | null, branch = true): Promise<void> {
    setError(null);
    setView((v) => (v ? { ...v, tree: applyMark(v.tree, topicId, mastery, branch) } : v));
    await persist(() => api(`/api/topics/${topicId}`, { method: "PATCH", json: { mastery, applyToBranch: branch } }));
  }

  async function markAll(mastery: Mastery | null) {
    setError(null);
    setView((v) => (v ? { ...v, tree: applyMark(v.tree, null, mastery) } : v));
    await persist(() => api(`/api/courses/${id}/brainmap`, { method: "PATCH", json: { mastery } }));
  }

  /** Add, edit or delete topics; the map reloads from the server afterwards. */
  async function changeTopics(req: () => Promise<unknown>, select?: (r: unknown) => string | null) {
    setError(null);
    try {
      const r = await persist(req);
      await load();
      reload();
      refreshUndo();
      if (select) setSelected(select(r));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** One batch change; the map reloads afterwards. Returns null when it failed (the error is shown). */
  async function batch(json: object): Promise<BatchResult | null> {
    setError(null);
    setConfirmDelete(false);
    const r = (await persist(() =>
      api<BatchResult>(`/api/courses/${id}/topics/batch`, { method: "POST", json })
        .then((ok) => ({ ok }))
        .catch((e: Error) => ({ err: e.message })),
    )) as { ok?: BatchResult; err?: string };
    if (r.err) {
      setError(r.err);
      return null;
    }
    await load();
    reload();
    setUndoLabel(r.ok?.undo ?? null);
    return r.ok ?? null;
  }

  async function moveTo(parent: string | null, ids = targets, before: string | null = null) {
    if (!ids.length) return;
    if (inBranch(ids, parent)) return setError("A topic can't go inside itself or one of its own subtopics.");
    const what = describe(ids);
    const r = await batch({ action: "move", ids, parent_id: parent, before_id: before });
    if (!r) return;
    flash(`Moved ${what} ${parent ? `under "${flat.get(parent)?.title}"` : "to the top level"}.`);
    if (r.ids?.length) {
      setSelected(r.ids[0]);
      setPicked(r.ids.length > 1 ? new Set(r.ids) : new Set());
    }
    showInMap(parent);
  }

  async function copyTo(parent: string | null, ids = targets) {
    if (!ids.length) return;
    const what = describe(ids);
    const r = await batch({ action: "copy", ids, parent_id: parent });
    if (!r) return;
    flash(`Copied ${what} ${parent ? `into "${flat.get(parent)?.title}"` : "to the top level"}.`);
    if (r.ids?.length) {
      setSelected(r.ids[0]);
      setPicked(r.ids.length > 1 ? new Set(r.ids) : new Set());
    }
    showInMap(parent);
  }

  function cut() {
    if (!targets.length) return;
    setClip({ mode: "cut", ids: targets });
    flash(`Cut ${describe(targets)}. Select the topic to put it under (or nothing, for the top level) and paste.`);
  }

  function copy() {
    if (!targets.length) return;
    setClip({ mode: "copy", ids: targets });
    flash(`Copied ${describe(targets)}. Select where the copy goes and paste.`);
  }

  /** Paste under the selected topic, or at the top level when nothing is selected. */
  async function paste(parent: string | null = selected && flat.has(selected) ? selected : null) {
    if (!clip) return;
    if (clip.mode === "cut") {
      if (inBranch(clip.ids, parent)) return setError("A topic can't go inside itself or one of its own subtopics.");
      const ids = clip.ids;
      setClip(null);
      await moveTo(parent, ids);
    } else await copyTo(parent, clip.ids);
  }

  async function removeMany(keepChildren: boolean) {
    const ids = targets;
    const what = describe(ids);
    const parent = flat.get(ids[0])?.parent_id ?? null;
    const r = await batch({ action: "delete", ids, keep_children: keepChildren });
    if (!r) return;
    setPicked(new Set());
    setSelected(parent && flat.has(parent) && !inBranch(ids, parent) ? parent : null);
    flash(`Deleted ${what}.`);
  }

  async function markMany(m: Mastery | null) {
    if (!targets.length) return;
    const ids = targets;
    setView((v) => (v ? { ...v, tree: ids.reduce((tree, t) => applyMark(tree, t, m, true), v.tree) } : v));
    await batch({ action: "mark", ids, mastery: m });
  }

  async function undo() {
    const r = await batch({ action: "undo" });
    if (!r?.undone) return;
    setPicked(new Set());
    setClip(null);
    flash(`Undid ${r.undone}.`);
  }

  /** Drop dragged topics on a topic (inside it) or between topics (before or after it). */
  function dropOn(ids: string[], t: { id: string | null; zone: DropTarget["zone"] }, asCopy: boolean) {
    let parent = t.id;
    let before: string | null = null;
    if (t.id && t.zone !== "inside") {
      const target = flat.get(t.id)!;
      parent = target.parent_id ?? null;
      const siblings = (parent ? flat.get(parent)?.children ?? [] : view?.tree ?? []).filter((s) => !ids.includes(s.id));
      const at = siblings.findIndex((s) => s.id === t.id);
      before = t.zone === "before" ? t.id : siblings[at + 1]?.id ?? null;
    }
    if (asCopy) copyTo(parent, ids);
    else moveTo(parent, ids, before);
  }

  const dragIds = (tid: string) => (picked.has(tid) && picked.size > 1 ? [...flat.keys()].filter((k) => picked.has(k)) : [tid]);
  const dragLabel = (tid: string) => {
    const ids = dragIds(tid);
    return ids.length > 1 ? `${ids.length} topics` : flat.get(tid)?.title ?? "";
  };
  /** Whether dragged topics can land there: not inside themselves. */
  const canDrop = (ids: string[], t: { id: string | null; zone: DropTarget["zone"] }) => {
    if (!t.id) return true;
    if (ids.includes(t.id)) return false;
    return !inBranch(ids, t.zone === "inside" ? t.id : flat.get(t.id)?.parent_id ?? null);
  };

  const addTopic = (t: TopicDraft) =>
    changeTopics(
      () => api<{ id: string }>(`/api/courses/${id}/topics`, { method: "POST", json: t }),
      (r) => (r as { id?: string })?.id ?? null,
    );

  const addForm = adding && (
    <TopicForm
      heading="Add a topic"
      parents={[...flat.values()]}
      onCancel={() => setAdding(false)}
      onSave={(t) => {
        setAdding(false);
        return addTopic(t);
      }}
    />
  );

  if (!view) return error ? <div className="alert error">{error}</div> : <p className="muted">Loading…</p>;

  if (!view.tree.length) {
    return (
      <div className="card empty">
        <h2>No brainmap yet</h2>
        <p>
          {data.materials.length
            ? `ziLearn will read your ${data.materials.length} item${data.materials.length > 1 ? "s" : ""} and organise them into topics and subtopics.`
            : "Add materials first, then build the brainmap."}
        </p>
        {error && <div className="alert error">{error}</div>}
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="primary" disabled={busy || !data.materials.length} onClick={build}>
            {busy ? <Busy label="Structuring your materials…" /> : "Build brainmap"}
          </button>
          <button onClick={() => setAdding(true)} disabled={busy}>
            Add topics yourself
          </button>
          {undoLabel && <button onClick={undo}>Undo {undoLabel}</button>}
        </div>
        {addForm && <div style={{ textAlign: "left", marginTop: 12 }}>{addForm}</div>}
      </div>
    );
  }

  const sel = selected ? flat.get(selected) : null;
  const leaves = counts.know + counts.familiar + counts.dont_know + counts.none;
  const withChildren = [...flat.values()].filter((n) => n.children.length);
  const pasteInto = sel ? `into "${sel.title}"` : "at the top level";

  const selbar = (targets.length > 0 || clip || undoLabel || note) && (
    <div className="selbar" role="toolbar" aria-label="Edit selected topics">
      {targets.length > 0 && (
        <>
          <strong className="small">{picked.size ? `${plural(targets.length, "topic")} picked` : `"${sel?.title}"`}</strong>
          <button className="sm" onClick={cut} title="Cut, then paste somewhere else to move (Ctrl+X)">
            ✂ Cut
          </button>
          <button className="sm" onClick={copy} title="Copy, then paste to duplicate with subtopics (Ctrl+C)">
            ⧉ Copy
          </button>
          <button className="sm" onClick={() => setBatchEdit(true)} title="Rename these topics, find and replace in their names, or set how important they are (E)">
            ✎ Edit
          </button>
        </>
      )}
      {clip && (
        <button className="sm primary" onClick={() => paste()} title={`Paste ${pasteInto} (Ctrl+V)`}>
          Paste {plural(clip.ids.length, "topic")} {pasteInto}
        </button>
      )}
      {targets.length > 0 && (
        <>
          <select
            className="sm"
            value=""
            aria-label="Move to"
            onChange={(e) => {
              const v = e.target.value;
              if (v) moveTo(v === "__top" ? null : v);
            }}
          >
            <option value="">Move to…</option>
            <option value="__top">Top level</option>
            {[...flat.values()]
              .filter((p) => !inBranch(targets, p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {"  ".repeat(depthOf(flat, p))}
                  {p.title}
                </option>
              ))}
          </select>
          <select className="sm" value="" aria-label="Mark as" onChange={(e) => e.target.value && markMany(e.target.value === "clear" ? null : (e.target.value as Mastery))}>
            <option value="">Mark as…</option>
            {MARKS.map((m) => (
              <option key={m} value={m}>
                {MASTERY_LABELS[m]}
              </option>
            ))}
            <option value="clear">No mark</option>
          </select>
          <button className="sm danger" onClick={() => setConfirmDelete(true)} title="Delete (Del)">
            Delete
          </button>
          {picked.size > 0 && (
            <button className="sm ghost" onClick={() => setPicked(new Set())} title="Clear the selection (Esc)">
              Clear
            </button>
          )}
        </>
      )}
      {clip && (
        <button className="sm ghost" onClick={() => setClip(null)} title="Forget what was cut or copied (Esc)">
          Cancel {clip.mode}
        </button>
      )}
      <span className="grow" />
      {note && (
        <span className="small muted" role="status">
          {note}
        </span>
      )}
      {undoLabel && (
        <button className="sm" onClick={undo} title={`Undo ${undoLabel} (Ctrl+Z)`}>
          ↶ Undo
        </button>
      )}
      {confirmDelete && targets.length > 0 && (
        <div className="selbar-confirm">
          <span className="small">
            Delete {describe(targets)}
            {targets.some((t) => flat.get(t)?.children.length) ? " and everything under them" : ""}? You can undo this.
          </span>
          <button className="sm danger" onClick={() => removeMany(false)} autoFocus>
            Delete
          </button>
          {targets.some((t) => flat.get(t)?.children.length) && (
            <button className="sm" onClick={() => removeMany(true)} title="Remove only these topics; their subtopics move up a level">
              Keep their subtopics
            </button>
          )}
          <button className="sm" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 14 }}>
      {error && (
        <div className="alert error" role="alert">
          {error}{" "}
          <button className="sm ghost" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <div className="spread">
        <div className="row">
          <div className="markseg">
            {(["map", "mindmap", "outline"] as const).map((m) => (
              <button key={m} className={mode === m ? "on familiar" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === "map" ? "Coloured map" : m === "mindmap" ? "Mindmap" : "Outline"}
              </button>
            ))}
          </div>
          <span className="small muted">
            <span className="badge know">{counts.know} know</span> <span className="badge familiar">{counts.familiar} familiar</span>{" "}
            <span className="badge dont_know">{counts.dont_know} don&apos;t know</span> <span className="badge">{counts.none} unmarked</span> of {leaves} topics to mark
          </span>
        </div>
        <div className="row">
          <select defaultValue="" onChange={(e) => e.target.value && markAll(e.target.value === "clear" ? null : (e.target.value as Mastery)).then(() => (e.target.value = ""))}>
            <option value="">Mark everything as…</option>
            {MARKS.map((m) => (
              <option key={m} value={m}>
                {MASTERY_LABELS[m]}
              </option>
            ))}
            <option value="clear">Clear all marks</option>
          </select>
          <button onClick={() => setAdding(true)} title="Add a topic the map missed">
            + Add topic
          </button>
          <button onClick={() => setTextEdit(true)} title="Rename, reorder, add and remove many topics at once by editing the map as an indented list">
            Edit as text
          </button>
          <button onClick={nextUnmarked} disabled={counts.none === 0} title="Jump to the next unmarked topic (n)">
            Next unmarked
          </button>
          <button onClick={build} disabled={busy}>
            {busy ? <Busy label="Rebuilding…" /> : "Rebuild"}
          </button>
          <button className="primary" onClick={onPlan}>
            Create study plan →
          </button>
        </div>
      </div>

      {addForm}
      {textEdit ? (
        <OutlineEditor
          tree={view.tree}
          onCancel={() => setTextEdit(false)}
          onApply={async (items) => {
            const r = await batch({ action: "outline", items });
            if (!r) return;
            setTextEdit(false);
            const c = r.changes;
            if (c) flash(`Map updated: ${[c.added && `${c.added} added`, c.renamed && `${c.renamed} renamed`, c.moved && `${c.moved} moved`, c.removed && `${c.removed} removed`].filter(Boolean).join(", ") || "no changes"}.`);
          }}
        />
      ) : (
        <div className="split">
          <div>
            {selbar}
            {(mode === "map" || mode === "mindmap") && (
              <>
                {mode === "mindmap" && <p className="small muted" style={{ margin: "0 0 4px" }}>✅ Know · 🟡 Familiar · 🔴 Don&apos;t know</p>}
                <div className="spread small muted">
                  <span>
                    Click a topic to select it; <kbd>Ctrl</kbd>/<kbd>⌘</kbd> or <kbd>Shift</kbd>-click picks several. <strong>+</strong> and <strong>−</strong> open and close a
                    branch. Drag a topic onto another to move it there (hold <kbd>Alt</kbd> to copy; on a touch screen, press and hold first). Keys: <kbd>1</kbd> Know,{" "}
                    <kbd>2</kbd> Familiar, <kbd>3</kbd> Don&apos;t know, <kbd>n</kbd> next unmarked.
                  </span>
                  <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <button
                      className="sm"
                      onClick={() => {
                        setOpen(new Set(withChildren.map((n) => n.id)));
                        setClosed(new Set());
                      }}
                      title="Show every subtopic"
                    >
                      Expand all
                    </button>
                    <button
                      className="sm"
                      onClick={() => {
                        setOpen(new Set());
                        setClosed(new Set(view.tree.filter((n) => n.children.length).map((n) => n.id)));
                        setFocus(null);
                      }}
                      title="Show only the main topics"
                    >
                      Collapse all
                    </button>
                  </span>
                </div>
                {flow && (
                  <Mermaid
                    key={mode}
                    code={flow.code}
                    zoom
                    toggles={flow.toggles}
                    marks={marks}
                    onToggle={(nid) => {
                      const tid = flow.nodeIds[nid];
                      if (!tid) return;
                      const opening = flow.toggles[nid] !== "open";
                      setOpen((o) => {
                        const n = new Set(o);
                        if (opening) n.add(tid);
                        else n.delete(tid);
                        return n;
                      });
                      setClosed((c) => {
                        const n = new Set(c);
                        if (opening) n.delete(tid);
                        else n.add(tid);
                        return n;
                      });
                    }}
                    onNodeClick={(nid, how) => {
                      if (nid === "root") {
                        setSelected(null);
                        setPicked(new Set());
                        return;
                      }
                      const tid = flow.nodeIds[nid];
                      if (tid) pick(tid, how);
                    }}
                    dragLabel={(nid) => dragLabel(flow.nodeIds[nid] ?? "")}
                    onNodeDrop={{
                      canDrop: (from, to) => {
                        const f = flow.nodeIds[from];
                        return !!f && (to === "root" || (!!flow.nodeIds[to] && canDrop(dragIds(f), { id: flow.nodeIds[to], zone: "inside" })));
                      },
                      drop: (from, to, asCopy) => {
                        const f = flow.nodeIds[from];
                        if (f) dropOn(dragIds(f), { id: to === "root" ? null : flow.nodeIds[to], zone: "inside" }, asCopy);
                      },
                    }}
                  />
                )}
              </>
            )}
            {mode === "outline" && (
              <div className="card">
                <p className="small muted" style={{ marginTop: 0 }}>
                  Tick topics to work on several at once. Drag a row onto another to put it inside, or onto its top or bottom edge to place it before or after (hold{" "}
                  <kbd>Alt</kbd> to copy).
                </p>
                <Outline
                  nodes={view.tree}
                  selected={selected}
                  picked={picked}
                  cut={clip?.mode === "cut" ? new Set(clip.ids) : null}
                  onSelect={pick}
                  onTick={togglePicked}
                  onMark={mark}
                  drag={{ ids: dragIds, label: dragLabel, canDrop, drop: dropOn }}
                />
              </div>
            )}
          </div>
          <div className="card" style={{ position: "sticky", top: 70 }}>
            {batchEdit && targets.length ? (
              <BatchEditor
                key={targets.join(",")}
                nodes={targets.map((t) => flat.get(t)!).filter(Boolean)}
                onCancel={() => setBatchEdit(false)}
                onSave={async (edits, importance) => {
                  const r = await batch({ action: "edit", ids: targets, edits, importance });
                  if (!r) return;
                  setBatchEdit(false);
                  flash(`Edited ${plural(targets.length, "topic")}.`);
                }}
              />
            ) : picked.size > 1 ? (
              <PickedPanel nodes={targets.map((t) => flat.get(t)!).filter(Boolean)} onSelect={(t) => pick(t, { extend: false, shift: false })} />
            ) : sel ? (
              <TopicPanel
                key={sel.id}
                node={sel}
                all={[...flat.values()]}
                courseMaterials={data.materials}
                onMark={mark}
                onLesson={(depth) => setLesson({ id: sel.id, title: sel.title, depth, achieved: sel.achieved_depth })}
                onSelect={setSelected}
                onAddChild={(t) => addTopic({ ...t, parent_id: sel.id })}
                onEdit={(t) => changeTopics(() => api(`/api/topics/${sel.id}`, { method: "PATCH", json: t }), () => sel.id)}
                onDelete={(keepChildren) =>
                  changeTopics(
                    () => api(`/api/topics/${sel.id}${keepChildren ? "?keepChildren=1" : ""}`, { method: "DELETE" }),
                    () => sel.parent_id,
                  )
                }
              />
            ) : (
              <div className="muted">
                <h3>Mark what you know</h3>
                <p>Select a topic in the map or outline, then mark it:</p>
                <p>
                  <span className="badge know">Know</span> I can explain and apply it.
                  <br />
                  <span className="badge familiar">Familiar</span> I&apos;ve seen it but couldn&apos;t answer exam questions.
                  <br />
                  <span className="badge dont_know">Don&apos;t know</span> New to me.
                </p>
                <p>The study plan starts each topic at the right depth and deepens it on every pass.</p>
              </div>
            )}
          </div>
        </div>
      )}
      {lesson && <LessonModal topicId={lesson.id} title={lesson.title} depth={lesson.depth} achieved={lesson.achieved} onClose={() => setLesson(null)} onCompleted={reload} />}
    </div>
  );
}

function depthOf(flat: Map<string, TopicNode>, n: TopicNode) {
  let d = 0;
  for (let p = n.parent_id; p && d < 20; p = flat.get(p)?.parent_id ?? null) d++;
  return d;
}

/** The side panel when several topics are picked: what they are, and a pointer to the toolbar. */
function PickedPanel({ nodes, onSelect }: { nodes: TopicNode[]; onSelect: (id: string) => void }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>{plural(nodes.length, "topic")} picked</h3>
      <p className="small muted" style={{ margin: 0 }}>
        Use the bar above the map to cut, copy, move, mark or delete them together, or drag one of them to move them all. <kbd>Esc</kbd> clears the selection.
      </p>
      <div className="small stack" style={{ gap: 2 }}>
        {nodes.slice(0, 30).map((n) => (
          <div key={n.id}>
            <span className={`dot ${n.effective_mastery ?? ""}`} style={{ display: "inline-block", marginRight: 6 }} />
            <a href="#" onClick={(e) => (e.preventDefault(), onSelect(n.id))}>
              {n.title}
            </a>
            {n.children.length > 0 && <span className="muted"> (+{countAll(n)})</span>}
          </div>
        ))}
        {nodes.length > 30 && <div className="muted">and {nodes.length - 30} more</div>}
      </div>
    </div>
  );
}

/** Rename several topics at once (with find and replace) and set their importance together. */
function BatchEditor({
  nodes,
  onSave,
  onCancel,
}: {
  nodes: TopicNode[];
  onSave: (edits: { id: string; title: string }[], importance: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [titles, setTitles] = useState<Record<string, string>>(() => Object.fromEntries(nodes.map((n) => [n.id, n.title])));
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [importance, setImportance] = useState("");
  const [saving, setSaving] = useState(false);
  const matches = find ? nodes.filter((n) => titles[n.id].toLowerCase().includes(find.toLowerCase())).length : 0;
  const replaceAll = () => {
    if (!find) return;
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    setTitles((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.replace(re, repl)])));
  };
  const edits = nodes.filter((n) => titles[n.id].trim() !== n.title).map((n) => ({ id: n.id, title: titles[n.id].trim() }));
  const empty = nodes.some((n) => !titles[n.id].trim());
  return (
    <form
      className="stack"
      style={{ gap: 8 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSave(edits, importance ? Number(importance) : null);
        setSaving(false);
      }}
    >
      <h3 style={{ margin: 0 }}>Edit {plural(nodes.length, "topic")}</h3>
      <div className="row" style={{ gap: 4 }}>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" aria-label="Find in names" style={{ flex: 1, minWidth: 80 }} />
        <input value={repl} onChange={(e) => setRepl(e.target.value)} placeholder="Replace with" aria-label="Replace with" style={{ flex: 1, minWidth: 80 }} />
        <button type="button" className="sm" disabled={!matches} onClick={replaceAll} title="Replace in every name below (not saved until you press Save)">
          Replace{matches ? ` in ${matches}` : ""}
        </button>
      </div>
      <div className="stack" style={{ gap: 4, maxHeight: 360, overflow: "auto" }}>
        {nodes.map((n) => (
          <input
            key={n.id}
            value={titles[n.id]}
            aria-label={`Name of ${n.title}`}
            onChange={(e) => setTitles((t) => ({ ...t, [n.id]: e.target.value }))}
            className={titles[n.id].trim() !== n.title ? "changed" : ""}
          />
        ))}
      </div>
      <label className="small">
        Importance{" "}
        <select value={importance} onChange={(e) => setImportance(e.target.value)}>
          <option value="">Keep as it is</option>
          <option value="3">Core (heavily examined)</option>
          <option value="2">Normal</option>
          <option value="1">Minor</option>
        </select>
      </label>
      <div className="row">
        <button className="primary sm" type="submit" disabled={saving || empty || (!edits.length && !importance)}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        {empty && <span className="small" style={{ color: "var(--dont)" }}>Every topic needs a name.</span>}
      </div>
    </form>
  );
}

/** The whole map as an indented list, to rename, reorder, add and remove many topics in one go. */
function OutlineEditor({ tree, onApply, onCancel }: { tree: TopicNode[]; onApply: (items: OutlineLine[]) => Promise<void>; onCancel: () => void }) {
  const start = useMemo(() => outlineText(tree), [tree]);
  const [text, setText] = useState(start.text);
  const [saving, setSaving] = useState(false);
  const matched = useMemo(() => matchOutline(start.lines, text), [start, text]);
  const diff = useMemo(() => outlineDiff(start.lines, matched), [start, matched]);
  const area = useRef<HTMLTextAreaElement>(null);

  /** Tab and Shift+Tab indent or outdent the selected lines. */
  function indent(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const lineStart = value.lastIndexOf("\n", a - 1) + 1;
    const lineEnd = value.indexOf("\n", Math.max(a, b - 1));
    const end = lineEnd < 0 ? value.length : lineEnd;
    const block = value.slice(lineStart, end);
    const changed = block
      .split("\n")
      .map((l) => (e.shiftKey ? l.replace(/^ {1,2}|^\t/, "") : `  ${l}`))
      .join("\n");
    const next = value.slice(0, lineStart) + changed + value.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      const shift = e.shiftKey ? Math.max(-2, -(block.length - block.trimStart().length)) : 2;
      el.selectionStart = a === b ? Math.max(lineStart, a + shift) : lineStart;
      el.selectionEnd = a === b ? Math.max(lineStart, a + shift) : lineStart + changed.length;
    });
  }

  const summary = [
    diff.added.length && `${diff.added.length} new`,
    diff.renamed.length && `${diff.renamed.length} renamed`,
    diff.moved && `${diff.moved} moved`,
    diff.removed.length && `${diff.removed.length} removed`,
  ].filter(Boolean);

  return (
    <div className="card stack outline-edit" style={{ gap: 8 }}>
      <div className="spread">
        <strong>Edit the map as text</strong>
        <span className="small muted">One topic per line. Indent a line (Tab, or two spaces) to put it under the line above; Shift+Tab moves it back out.</span>
      </div>
      <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={indent} spellCheck={false} aria-label="Brainmap outline" autoFocus />
      <div className="small">
        {summary.length ? <strong>{summary.join(" · ")}</strong> : <span className="muted">No changes yet.</span>}
        {diff.renamed.length > 0 && (
          <div className="muted">Renamed: {diff.renamed.slice(0, 6).map((r) => `${r.from} → ${r.to}`).join("; ")}{diff.renamed.length > 6 ? "; …" : ""}</div>
        )}
        {diff.removed.length > 0 && (
          <div style={{ color: "var(--dont)" }}>
            Removed (with their lessons): {diff.removed.slice(0, 8).join(", ")}
            {diff.removed.length > 8 ? `, and ${diff.removed.length - 8} more` : ""}
          </div>
        )}
      </div>
      <div className="row">
        <button
          className="primary sm"
          disabled={saving || !summary.length || !matched.length}
          onClick={async () => {
            if (diff.removed.length && !confirm(`This removes ${plural(diff.removed.length, "topic")}: ${diff.removed.slice(0, 8).join(", ")}${diff.removed.length > 8 ? "…" : ""}. You can undo it afterwards. Continue?`)) return;
            setSaving(true);
            try {
              await onApply(matched);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Applying…" : "Apply changes"}
        </button>
        <button className="sm" onClick={() => setText(start.text)} disabled={text === start.text}>
          Start over
        </button>
        <button className="sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MarkButtons({ node, onMark, branch = true }: { node: TopicNode; onMark: (id: string, m: Mastery | null, branch?: boolean) => void; branch?: boolean }) {
  return (
    <div className="markseg">
      {MARKS.map((m) => (
        <button
          key={m}
          className={`${m} ${node.effective_mastery === m ? "on" : ""}`}
          aria-pressed={node.effective_mastery === m}
          title={node.mastery === null && node.effective_mastery === m ? "Inherited from parent" : MASTERY_LABELS[m]}
          onClick={(e) => {
            e.stopPropagation();
            onMark(node.id, node.mastery === m ? null : m, branch);
          }}
        >
          {SHORT[m]}
        </button>
      ))}
    </div>
  );
}

interface OutlineDrag {
  ids: (id: string) => string[];
  label: (id: string) => string;
  canDrop: (ids: string[], t: { id: string | null; zone: DropTarget["zone"] }) => boolean;
  drop: (ids: string[], t: { id: string | null; zone: DropTarget["zone"] }, copy: boolean) => void;
}

/** The topic tree as a list with tick boxes, plus and minus signs, and drag and drop. */
function Outline({
  nodes,
  selected,
  picked,
  cut,
  onSelect,
  onTick,
  onMark,
  drag,
}: {
  nodes: TopicNode[];
  selected: string | null;
  picked: Set<string>;
  cut: Set<string> | null;
  onSelect: (id: string, how: NodeClick) => void;
  onTick: (id: string) => void;
  onMark: (id: string, m: Mastery | null, branch?: boolean) => void;
  drag: OutlineDrag;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);

  function begin(e: React.PointerEvent, n: TopicNode) {
    if ((e.target as HTMLElement).closest("button, input, select, a")) return;
    const ids = drag.ids(n.id);
    startDrag(e.nativeEvent, {
      label: drag.label(n.id),
      target: (x, y) => {
        const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-id]");
        if (!el || !box.current?.contains(el)) return null;
        const id = el.dataset.dropId || null;
        let zone: DropTarget["zone"] = "inside";
        if (id) {
          const r = el.getBoundingClientRect();
          zone = y < r.top + r.height * 0.28 ? "before" : y > r.bottom - r.height * 0.28 ? "after" : "inside";
        }
        return drag.canDrop(ids, { id, zone }) ? { el, id, zone } : null;
      },
      drop: (t, copy) => drag.drop(ids, t, copy),
    });
  }

  const render = (ns: TopicNode[]) => (
    <ul className="tree">
      {ns.map((n) => {
        const shut = collapsed.has(n.id);
        return (
          <li key={n.id}>
            <div
              className={`tree-row${selected === n.id ? " selected" : ""}${picked.has(n.id) ? " picked" : ""}${cut?.has(n.id) ? " cut" : ""}`}
              data-drop-id={n.id}
              onPointerDown={(e) => begin(e, n)}
            >
              <input type="checkbox" className="pick-box" checked={picked.has(n.id)} onChange={() => onTick(n.id)} aria-label={`Pick ${n.title}`} />
              <button
                className="caret"
                onClick={() => setCollapsed((s) => (s.has(n.id) ? (s.delete(n.id), new Set(s)) : new Set(s.add(n.id))))}
                style={{ visibility: n.children.length ? "visible" : "hidden" }}
                aria-label={shut ? `Show the ${countAll(n)} subtopics` : "Hide subtopics"}
                aria-expanded={!shut}
                title={shut ? `Show ${countAll(n)} subtopics` : "Hide subtopics"}
              >
                {shut ? "+" : "−"}
              </button>
              <span className={`dot ${n.effective_mastery ?? ""}`} />
              <span
                className="tree-title"
                role="button"
                tabIndex={0}
                aria-current={selected === n.id}
                onClick={(e) => onSelect(n.id, { extend: e.ctrlKey || e.metaKey || e.shiftKey, shift: e.shiftKey })}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(n.id, { extend: e.ctrlKey || e.metaKey, shift: e.shiftKey }))}
              >
                {n.title}
                {n.importance === 3 && <span title="Core topic"> ★</span>}
                {shut && <span className="muted small"> (+{countAll(n)})</span>}
              </span>
              <MarkButtons node={n} onMark={onMark} />
            </div>
            {n.children.length > 0 && !shut && render(n.children)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div ref={box}>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <button className="sm" onClick={() => setCollapsed(new Set())}>
          Expand all
        </button>
        <button
          className="sm"
          onClick={() => {
            const all = new Set<string>();
            const walk = (ns: TopicNode[]) => ns.forEach((n) => n.children.length && (all.add(n.id), walk(n.children)));
            walk(nodes);
            setCollapsed(all);
          }}
        >
          Collapse all
        </button>
      </div>
      {render(nodes)}
      <div className="drop-top" data-drop-id="">
        Drop here to move to the top level
      </div>
    </div>
  );
}

interface TopicDraft {
  title: string;
  summary: string;
  parent_id: string | null;
}

/** Name, description and place of a topic, for adding one or fixing a detected one. */
function TopicForm({
  heading,
  initial,
  parents,
  exclude,
  onSave,
  onCancel,
}: {
  heading: string;
  initial?: Partial<TopicDraft>;
  parents: TopicNode[];
  exclude?: Set<string>;
  onSave: (t: TopicDraft) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [parent, setParent] = useState(initial?.parent_id ?? "");
  const [saving, setSaving] = useState(false);
  const depth = useMemo(() => {
    const byId = new Map(parents.map((p) => [p.id, p]));
    return (n: TopicNode) => {
      let d = 0;
      for (let p = n.parent_id; p && d < 20; p = byId.get(p)?.parent_id ?? null) d++;
      return d;
    };
  }, [parents]);
  return (
    <form
      className="card stack"
      style={{ gap: 8 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setSaving(true);
        try {
          await onSave({ title: title.trim(), summary: summary.trim(), parent_id: parent || null });
        } finally {
          setSaving(false);
        }
      }}
    >
      <strong>{heading}</strong>
      <label className="stack" style={{ gap: 2 }}>
        <span className="small muted">Name</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={200} placeholder="e.g. Regularisation" />
      </label>
      <label className="stack" style={{ gap: 2 }}>
        <span className="small muted">What it covers (optional, helps lessons and exams)</span>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} style={{ minHeight: 60 }} />
      </label>
      {initial?.parent_id !== undefined || !initial ? (
        <label className="stack" style={{ gap: 2 }}>
          <span className="small muted">Under</span>
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Top level</option>
            {parents
              .filter((p) => !exclude?.has(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {"\u00a0\u00a0".repeat(depth(p))}
                  {p.title}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <div className="row">
        <button className="primary sm" type="submit" disabled={saving || !title.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="sm" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TopicPanel({
  node,
  all,
  courseMaterials,
  onMark,
  onLesson,
  onSelect,
  onAddChild,
  onEdit,
  onDelete,
}: {
  node: TopicNode;
  all: TopicNode[];
  courseMaterials: CourseData["materials"];
  onMark: (id: string, m: Mastery | null, branch?: boolean) => void;
  onLesson: (depth: number) => void;
  onSelect: (id: string) => void;
  onAddChild: (t: TopicDraft) => Promise<void>;
  onEdit: (t: TopicDraft) => Promise<void>;
  onDelete: (keepChildren: boolean) => Promise<void>;
}) {
  const [branch, setBranch] = useState(true);
  const [editing, setEditing] = useState<"add" | "edit" | "delete" | null>(null);
  const branchIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (n: TopicNode) => (ids.add(n.id), n.children.forEach(walk));
    walk(node);
    return ids;
  }, [node]);
  const [related, setRelated] = useState<Related[]>([]);
  useEffect(() => {
    api<{ related: Related[] }>(`/api/topics/${node.id}`)
      .then((r) => setRelated(r.related))
      .catch(() => setRelated([]));
  }, [node.id]);
  const sources = courseMaterials.filter((m) => node.material_ids.includes(m.id));

  return (
    <div className="stack">
      <div>
        <h3 style={{ marginBottom: 4 }}>{node.title}</h3>
        <div className="row small">
          {node.importance === 3 && <span className="badge accent">Core topic</span>}
          {node.achieved_depth > 0 && <span className="badge">Studied to level {node.achieved_depth}</span>}
          {node.effective_mastery && <span className={`badge ${node.effective_mastery}`}>{MASTERY_LABELS[node.effective_mastery]}</span>}
          {node.mastery === null && node.effective_mastery && <span className="small muted">(inherited)</span>}
        </div>
      </div>
      {node.summary && <Markdown>{node.summary}</Markdown>}
      {node.keywords.length > 0 && <div className="small muted">Key terms: {node.keywords.join(", ")}</div>}
      <div className="stack" style={{ gap: 6 }}>
        <MarkButtons node={node} onMark={onMark} branch={branch} />
        {node.children.length > 0 && (
          <label className="small muted row" style={{ gap: 6 }}>
            <input type="checkbox" checked={branch} onChange={(e) => setBranch(e.target.checked)} /> Apply to all {countAll(node)} subtopics
          </label>
        )}
      </div>
      <div>
        <div className="small muted" style={{ marginBottom: 4 }}>
          Study this topic
        </div>
        <div className="row">
          {[1, 2, 3, 4].map((d) => (
            <button key={d} className={`sm ${d === node.achieved_depth + 1 ? "primary" : ""}`} onClick={() => onLesson(d)} title={`${DEPTH_LEVELS[d - 1].name}: ${DEPTH_LEVELS[d - 1].goal}`}>
              {d <= node.achieved_depth ? "✓ " : ""}
              {d} · {DEPTH_LEVELS[d - 1].name}
            </button>
          ))}
        </div>
      </div>
      {sources.length > 0 && (
        <div className="small">
          <div className="muted">Sources</div>
          {sources.map((s) => (
            <div key={s.id}>
              <span className="badge">{MATERIAL_KIND_LABELS[s.kind]}</span> {s.title}
            </div>
          ))}
        </div>
      )}
      {node.children.length > 0 && (
        <div className="small">
          <div className="muted">Subtopics</div>
          {node.children.map((c) => (
            <div key={c.id}>
              <span className={`dot ${c.effective_mastery ?? ""}`} style={{ display: "inline-block", marginRight: 6 }} />
              <a href="#" onClick={(e) => (e.preventDefault(), onSelect(c.id))}>
                {c.title}
              </a>
            </div>
          ))}
        </div>
      )}
      <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <div className="row">
          <button className="sm" onClick={() => setEditing(editing === "add" ? null : "add")}>
            + Subtopic
          </button>
          <button className="sm" onClick={() => setEditing(editing === "edit" ? null : "edit")}>
            Edit
          </button>
          <button className="sm danger" onClick={() => setEditing(editing === "delete" ? null : "delete")}>
            Delete
          </button>
        </div>
        {editing === "add" && <TopicForm heading={`New subtopic of "${node.title}"`} initial={{}} parents={[]} onCancel={() => setEditing(null)} onSave={(t) => onAddChild(t).then(() => setEditing(null))} />}
        {editing === "edit" && (
          <TopicForm
            heading="Edit topic"
            initial={{ title: node.title, summary: node.summary, parent_id: node.parent_id ?? "" }}
            parents={all}
            exclude={branchIds}
            onCancel={() => setEditing(null)}
            onSave={(t) => onEdit(t).then(() => setEditing(null))}
          />
        )}
        {editing === "delete" && (
          <div className="card stack" style={{ gap: 6 }}>
            <span>
              {node.children.length
                ? `Delete "${node.title}" and its ${countAll(node)} subtopics? Rebuilding the map won't bring them back.`
                : `Delete "${node.title}"? Rebuilding the map won't bring it back.`}
            </span>
            <div className="row">
              <button className="sm danger" onClick={() => onDelete(false)}>
                {node.children.length ? "Delete the whole branch" : "Delete"}
              </button>
              {node.children.length > 0 && (
                <button className="sm" onClick={() => onDelete(true)} title="Remove only this level; its subtopics move up">
                  Delete only this topic
                </button>
              )}
              <button className="sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {related.length > 0 && (
        <div className="small">
          <div className="muted">Connected in other courses</div>
          {related.map((r) => (
            <div key={r.topic_id} style={{ marginTop: 4 }}>
              <a href={`/courses/${r.course_id}?topic=${r.topic_id}#brainmap`}>{r.course_name}</a>: <strong>{r.title}</strong>
              {r.relation && <div className="muted">{r.relation}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function countAll(n: TopicNode): number {
  return n.children.reduce((s, c) => s + 1 + countAll(c), 0);
}
