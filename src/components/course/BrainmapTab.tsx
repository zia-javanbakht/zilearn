"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Mermaid } from "../Mermaid";
import { LessonModal } from "./LessonModal";
import { MASTERY_LABELS, MATERIAL_KIND_LABELS, type Mastery, type TopicNode } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

interface BrainmapView {
  tree: TopicNode[];
  mindmap: string;
  flowchart: { code: string; nodeIds: Record<string, string> };
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
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lesson, setLesson] = useState<{ id: string; title: string; depth: number } | null>(null);

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

  async function mark(topicId: string, mastery: Mastery | null, branch = true) {
    await api(`/api/topics/${topicId}`, { method: "PATCH", json: { mastery, applyToBranch: branch } });
    await load();
  }

  async function markAll(mastery: Mastery | null) {
    if (!view) return;
    await Promise.all(view.tree.map((r) => api(`/api/topics/${r.id}`, { method: "PATCH", json: { mastery, applyToBranch: true } })));
    await load();
  }

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
        <button className="primary" disabled={busy || !data.materials.length} onClick={build}>
          {busy && <span className="spinner" />} {busy ? "Structuring your materials…" : "Build brainmap"}
        </button>
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
              <button key={m} className={mode === m ? "on familiar" : ""} onClick={() => setMode(m)}>
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
          <button onClick={build} disabled={busy}>
            {busy && <span className="spinner" />} {busy ? "Rebuilding…" : "Rebuild"}
          </button>
          <button className="primary" onClick={onPlan}>
            Create study plan →
          </button>
        </div>
      </div>

      <div className="split">
        <div>
          {mode === "map" && (
            <>
              <p className="small muted">Click a topic to mark it. Marking a branch applies to everything under it.</p>
              <Mermaid code={view.flowchart.code} onNodeClick={(nid) => view.flowchart.nodeIds[nid] && setSelected(view.flowchart.nodeIds[nid])} />
            </>
          )}
          {mode === "mindmap" && <Mermaid code={view.mindmap} />}
          {mode === "outline" && (
            <div className="card">
              <Outline nodes={view.tree} selected={selected} onSelect={setSelected} onMark={mark} />
            </div>
          )}
        </div>
        <div className="card" style={{ position: "sticky", top: 70 }}>
          {sel ? (
            <TopicPanel node={sel} courseMaterials={data.materials} onMark={mark} onLesson={(depth) => setLesson({ id: sel.id, title: sel.title, depth })} onSelect={setSelected} />
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
            <span className="tree-title" onClick={() => onSelect(n.id)}>
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

function TopicPanel({
  node,
  courseMaterials,
  onMark,
  onLesson,
  onSelect,
}: {
  node: TopicNode;
  courseMaterials: CourseData["materials"];
  onMark: (id: string, m: Mastery | null, branch?: boolean) => void;
  onLesson: (depth: number) => void;
  onSelect: (id: string) => void;
}) {
  const [branch, setBranch] = useState(true);
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
      {related.length > 0 && (
        <div className="small">
          <div className="muted">Connected in other courses</div>
          {related.map((r) => (
            <div key={r.topic_id} style={{ marginTop: 4 }}>
              <a href={`/courses/${r.course_id}#brainmap`}>{r.course_name}</a>: <strong>{r.title}</strong>
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
