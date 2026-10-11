"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Mermaid } from "@/components/Mermaid";
import { Snippet } from "@/components/Markdown";

interface Hit {
  type: "topic" | "material";
  id: string;
  course_id: string;
  course_name: string;
  title: string;
  snippet: string;
}

interface LinkRow {
  id: string;
  score: number;
  relation: string | null;
  from: { id: string; title: string; course_id: string; course_name: string };
  to: { id: string; title: string; course_id: string; course_name: string };
}

interface Graph {
  courses: { id: string; name: string; topic_count: number }[];
  links: LinkRow[];
  mermaid: string | null;
  by?: string;
}

export default function KnowledgePage() {
  const [q, setQ] = useState("");
  const [course, setCourse] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Graph>("/api/kb").then(setGraph).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Hit[]>(`/api/kb/search?q=${encodeURIComponent(q)}${course ? `&course=${course}` : ""}`, { signal: ctrl.signal })
        .then(setHits)
        .catch((e) => e.name !== "AbortError" && setError(e.message));
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, course]);

  async function rebuild() {
    setBusy(true);
    setError(null);
    try {
      setGraph(await api<Graph>("/api/kb", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1>Knowledge base</h1>
        <p className="muted">Search everything across your courses, and see how topics in different courses connect.</p>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="card stack">
        <div className="row">
          <input autoFocus className="grow" placeholder="Search topics, notes, transcripts, slides…" value={q} onChange={(e) => setQ(e.target.value)} style={{ fontSize: "1.05rem", padding: "10px 14px" }} />
          <select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">All courses</option>
            {graph?.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {hits && (
          <div className="list">
            {hits.length === 0 && <p className="muted">No matches.</p>}
            {hits.map((h) => (
              <div key={h.id} className="list-item">
                <span className={`badge ${h.type === "topic" ? "accent" : ""}`}>{h.type === "topic" ? "Topic" : "Material"}</span>
                <div className="grow">
                  <div>
                    <Link href={`/courses/${h.course_id}#${h.type === "topic" ? "brainmap" : "materials"}`}>
                      <strong>{h.title}</strong>
                    </Link>{" "}
                    <span className="small muted">· {h.course_name}</span>
                  </div>
                  <div className="small muted">
                    <Snippet text={h.snippet} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Connections between courses</h2>
          <button className="primary" onClick={rebuild} disabled={busy}>
            {busy && <span className="spinner" />} {busy ? "Linking topics…" : graph?.links.length ? "Rebuild links" : "Build links"}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          ziLearn compares every topic across your courses and links the ones that overlap. Rebuild after adding courses or rebuilding a brainmap.
        </p>
        {graph && graph.courses.length < 2 && <div className="alert info">Add at least two courses with brainmaps to see connections.</div>}
        {graph?.mermaid && <Mermaid code={graph.mermaid} />}
        {graph && graph.links.length > 0 && (
          <div className="list">
            {graph.links.map((l) => (
              <div key={l.id} className="list-item">
                <div className="grow">
                  <div>
                    <Link href={`/courses/${l.from.course_id}#brainmap`}>{l.from.title}</Link> <span className="small muted">({l.from.course_name})</span> ↔{" "}
                    <Link href={`/courses/${l.to.course_id}#brainmap`}>{l.to.title}</Link> <span className="small muted">({l.to.course_name})</span>
                  </div>
                  {l.relation && <div className="small muted">{l.relation}</div>}
                </div>
                <span className="badge">{Math.round(l.score * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
