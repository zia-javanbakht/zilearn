"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Busy } from "../Busy";
import { Mermaid } from "../Mermaid";
import { LessonModal } from "./LessonModal";
import { toFlowchart, toMindmap } from "@/lib/mermaid";
import { applyMark } from "@/lib/tree";
import { MASTERY_LABELS, MATERIAL_KIND_LABELS, type Mastery, type TopicNode } from "@/lib/types";
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

const MARKS: Mastery[] = ["know", "familiar", "dont_know"];
const SHORT: Record<Mastery, string> = { know: "Know", familiar: "Familiar", dont_know: "Don't know" };

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
  const [lesson, setLesson] = useState<{ id: string; title: string; depth: number } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = () => api<BrainmapView>(`/api/courses/${id}/brainmap`).then(setView).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const flat = useMemo(() => {
    const out = new Map<string, TopicNode>();
    const walk = (ns: TopicNode[]) => ns.forEach((n) => (out.set(n.id, n), walk(n.children)));
    if (view) walk(view.tree);
    return out;
  }, [view]);

  const mindmap = useMemo(() => (view && mode === "mindmap" ? toMindmap(data.course.name, view.tree) : ""), [view, mode, data.course.name]);
  const flow = useMemo(() => (view ? toFlowchart(data.course.name, view.tree, { focusId: focus }) : null), [view, focus, data.course.name]);

  const leavesInOrder = useMemo(() => [...flat.values()].filter((n) => !n.children.length), [flat]);
  function nextUnmarked() {
    const start = Math.max(0, leavesInOrder.findIndex((n) => n.id === selected) + 1);
    const next = [...leavesInOrder.slice(start), ...leavesInOrder.slice(0, start)].find((n) => !n.effective_mastery);
    if (next) {
      setSelected(next.id);
      setFocus(next.parent_id ?? next.id);
    }
  }

  // Keyboard: 1 know, 2 familiar, 3 don't know, 0 clear, n next unmarked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, Mastery | null> = { "1": "know", "2": "familiar", "3": "dont_know", "0": null };
      if (e.key in map && selected) {
        e.preventDefault();
        const node = flat.get(selected);
        mark(selected, map[e.key], true).then(() => {
          if (node && !node.children.length) nextUnmarked();
        });
      } else if (e.key === "n") {
        e.preventDefault();
        nextUnmarked();
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
    if (data.tree.length && !confirm("Rebuild the brainmap from all materials? Marks carry over to topics with the same name.")) return;
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
      if (select) setSelected(select(r));
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
        </div>
        {addForm && <div style={{ textAlign: "left", marginTop: 12 }}>{addForm}</div>}
      </div>
    );
  }

  const sel = selected ? flat.get(selected) : null;
  const leaves = counts.know + counts.familiar + counts.dont_know + counts.none;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {error && <div className="alert error">{error}</div>}
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
            <span className="badge dont_know">{counts.dont_know} don&apos;t know</span> <span className="badge">{counts.none} unmarked</span> of {leaves} study topics
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
      <div className="split">
        <div>
          {mode === "map" && (
            <>
              <div className="spread small muted">
                <span>
                  Click a topic to select and expand it. Keys: <kbd>1</kbd> Know, <kbd>2</kbd> Familiar, <kbd>3</kbd> Don&apos;t know, <kbd>n</kbd> next unmarked.
                </span>
                {flow?.collapsed && focus && (
                  <button className="sm" onClick={() => setFocus(null)}>
                    Collapse all
                  </button>
                )}
              </div>
              {flow && (
                <Mermaid
                  code={flow.code}
                  zoom
                  onNodeClick={(nid) => {
                    const tid = flow.nodeIds[nid];
                    if (!tid) return;
                    setSelected(tid);
                    if (flat.get(tid)?.children.length) setFocus(tid);
                  }}
                />
              )}
            </>
          )}
          {mode === "mindmap" && (
            <>
              <p className="small muted">Overview of the whole course. ✅ Know · 🟡 Familiar · 🔴 Don&apos;t know. Use the coloured map or outline to mark topics.</p>
              <Mermaid code={mindmap} zoom />
            </>
          )}
          {mode === "outline" && (
            <div className="card">
              <Outline nodes={view.tree} selected={selected} onSelect={setSelected} onMark={mark} />
            </div>
          )}
        </div>
        <div className="card" style={{ position: "sticky", top: 70 }}>
          {sel ? (
            <TopicPanel
              key={sel.id}
              node={sel}
              all={[...flat.values()]}
              courseMaterials={data.materials}
              onMark={mark}
              onLesson={(depth) => setLesson({ id: sel.id, title: sel.title, depth })}
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
      {lesson && <LessonModal topicId={lesson.id} title={lesson.title} depth={lesson.depth} onClose={() => setLesson(null)} />}
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

function Outline({
  nodes,
  selected,
  onSelect,
  onMark,
}: {
  nodes: TopicNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  onMark: (id: string, m: Mastery | null, branch?: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <li key={n.id}>
          <div className={`tree-row${selected === n.id ? " selected" : ""}`}>
            <button
              className="caret"
              onClick={() => setCollapsed((s) => (s.has(n.id) ? (s.delete(n.id), new Set(s)) : new Set(s.add(n.id))))}
              style={{ visibility: n.children.length ? "visible" : "hidden" }}
            >
              {collapsed.has(n.id) ? "▸" : "▾"}
            </button>
            <span className={`dot ${n.effective_mastery ?? ""}`} />
            <span
              className="tree-title"
              role="button"
              tabIndex={0}
              aria-current={selected === n.id}
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(n.id))}
            >
              {n.title}
              {n.importance === 3 && <span title="Core topic"> ★</span>}
            </span>
            <MarkButtons node={n} onMark={onMark} />
          </div>
          {n.children.length > 0 && !collapsed.has(n.id) && <Outline nodes={n.children} selected={selected} onSelect={onSelect} onMark={onMark} />}
        </li>
      ))}
    </ul>
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
      <p style={{ margin: 0 }}>{node.summary}</p>
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
            <button key={d} className="sm" onClick={() => onLesson(d)}>
              Level {d}
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
