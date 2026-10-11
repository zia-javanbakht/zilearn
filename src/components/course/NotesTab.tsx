"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Busy } from "../Busy";
import { ScopePicker, type ScopeValue } from "./ScopePicker";
import type { ReviewNote } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

export function NotesTab({ data }: { data: CourseData }) {
  const id = data.course.id;
  const [notes, setNotes] = useState<ReviewNote[] | null>(null);
  const [open, setOpen] = useState<ReviewNote | null>(null);
  const [scope, setScope] = useState<ScopeValue>({ kind: "course" });
  const [style, setStyle] = useState("concise");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<ReviewNote[]>(`/api/courses/${id}/notes`)
      .then((n) => {
        setNotes(n);
        setOpen((o) => o ?? n[0] ?? null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const n = await api<ReviewNote>(`/api/courses/${id}/notes`, { method: "POST", json: { scope, style } });
      setOpen(n);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function download(n: ReviewNote) {
    const blob = new Blob([n.content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.course.name} - ${n.title}.md`.replace(/[\\/:*?"<>|]+/g, "_");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card stack">
        <h2>Review notes</h2>
        <div className="row">
          <ScopePicker tree={data.tree} value={scope} onChange={setScope} />
          <label className="field">
            Style
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="concise">Concise revision notes</option>
              <option value="detailed">Detailed study notes</option>
              <option value="cheatsheet">Cheat sheet</option>
            </select>
          </label>
          <button className="primary" style={{ alignSelf: "flex-end" }} onClick={create} disabled={busy || !data.tree.length}>
            {busy ? <Busy label="Writing notes…" /> : "Generate notes"}
          </button>
        </div>
        {!data.tree.length && <div className="alert">Build the brainmap first.</div>}
        {error && <div className="alert error">{error}</div>}
      </div>

      {notes && notes.length > 0 && (
        <div className="split side-list">
          <div className="card list">
            {notes.map((n) => (
              <div key={n.id} className={`list-item pick${open?.id === n.id ? " selected" : ""}`} aria-current={open?.id === n.id} onClick={() => setOpen(n)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(n))}>
                <div>
                  <strong className="small">{n.title}</strong>
                  <div className="small muted">{n.created_at.slice(0, 16)}</div>
                </div>
              </div>
            ))}
          </div>
          {open && (
            <div className="card">
              <div className="spread" style={{ marginBottom: 8 }}>
                <span className="small muted">
                  {open.scope}
                  {open.generated_by === "heuristic" && " · offline summary"}
                </span>
                <div className="row">
                  <button className="sm" onClick={() => download(open)}>
                    Download .md
                  </button>
                  <button className="sm" onClick={() => window.print()}>
                    Print / PDF
                  </button>
                  <button
                    className="sm danger"
                    onClick={async () => {
                      await api(`/api/notes/${open.id}`, { method: "DELETE" });
                      setOpen(null);
                      load();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <Markdown>{open.content}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
