"use client";

import { useRef, useState } from "react";
import { api } from "../api";
import { MATERIAL_KINDS, MATERIAL_KIND_LABELS, type Material, type MaterialKind } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

export function MaterialsTab({ data, reload, onBrainmap }: { data: CourseData; reload: () => void; onBrainmap: () => void }) {
  const id = data.course.id;
  const [over, setOver] = useState(false);
  const [kind, setKind] = useState<"" | MaterialKind>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [paste, setPaste] = useState({ title: "", text: "" });
  const [added, setAdded] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      const r = await fn();
      if (Array.isArray(r)) setAdded((n) => n + r.length);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    if (kind) fd.append("kind", kind);
    return run(`Reading ${list.length} file${list.length > 1 ? "s" : ""}…`, () => api(`/api/courses/${id}/materials`, { method: "POST", body: fd }));
  }

  function addUrl(url: string) {
    return run("Fetching link…", () => api(`/api/courses/${id}/materials`, { method: "POST", json: { url, kind: kind || undefined } }));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) return upload(e.dataTransfer.files);
    const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    const urls = uri.split(/\s+/).filter((u) => /^https?:\/\//.test(u));
    if (urls.length) urls.forEach((u) => addUrl(u));
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      {error && <div className="alert error">{error}</div>}

      <div
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <strong>{busy ?? "Drop files or links here"}</strong>
        <span className="muted small">
          PDF, slides (PPTX), Word, text/Markdown, images of notes, audio memos, sample exams, workshop and tutorial sheets. You can also drag a
          YouTube link from your browser.
        </span>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>

      <div className="row">
        <label className="field">
          Treat dropped items as
          <select value={kind} onChange={(e) => setKind(e.target.value as MaterialKind | "")}>
            <option value="">Auto-detect</option>
            {MATERIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {MATERIAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <form
          className="row grow"
          style={{ alignItems: "flex-end" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) addUrl(link.trim()).then(() => setLink(""));
          }}
        >
          <label className="field grow">
            Add a link (YouTube or web page)
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          </label>
          <button disabled={!!busy || !link.trim()}>Add link</button>
        </form>
      </div>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Paste notes or a transcript</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <input placeholder="Title" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} />
          <textarea placeholder="Paste text…" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
          <div>
            <button
              disabled={!!busy || !paste.text.trim()}
              onClick={() =>
                run("Saving…", () => api(`/api/courses/${id}/materials`, { method: "POST", json: { ...paste, kind: kind || undefined } })).then(() =>
                  setPaste({ title: "", text: "" }),
                )
              }
            >
              Add notes
            </button>
          </div>
        </div>
      </details>

      {added > 0 && (
        <div className="alert info spread">
          <span>
            {added} item{added > 1 ? "s" : ""} added. {data.tree.length ? "Rebuild the brainmap to include them." : "Build the brainmap when you've added everything."}
          </span>
          <button className="primary" onClick={onBrainmap}>
            Go to brainmap
          </button>
        </div>
      )}

      <div className="card">
        <h2>Course items ({data.materials.length})</h2>
        {data.materials.length === 0 ? (
          <p className="muted">Nothing here yet.</p>
        ) : (
          <div className="list">
            {data.materials.map((m) => (
              <MaterialRow key={m.id} m={m} reload={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MaterialRow({ m, reload }: { m: Material; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<Material | null>(null);
  const [text, setText] = useState("");
  const isAudio = (m.mime ?? "").startsWith("audio/") || /\.(mp3|m4a|wav|ogg|webm|aac|flac|opus)$/i.test(m.filename ?? "");
  const yt = m.url?.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{6,})/)?.[1];

  async function toggle() {
    if (!open && !full) {
      const f = await api<Material>(`/api/materials/${m.id}`);
      setFull(f);
      setText(f.text ?? "");
    }
    setOpen(!open);
  }

  async function patch(p: Partial<Material>) {
    await api(`/api/materials/${m.id}`, { method: "PATCH", json: p });
    reload();
  }

  return (
    <div className="list-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="spread">
        <div className="row grow" style={{ minWidth: 0 }}>
          <select value={m.kind} onChange={(e) => patch({ kind: e.target.value as MaterialKind })} style={{ padding: "2px 6px", fontSize: "0.82rem" }}>
            {MATERIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {MATERIAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <strong style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</strong>
          {m.status !== "ready" && <span className={`badge ${m.status === "error" ? "dont_know" : "familiar"}`}>{m.status === "error" ? "error" : "needs text"}</span>}
        </div>
        <div className="row">
          {m.path && (
            <a className="btn sm" href={`/api/materials/${m.id}/file`} target="_blank" rel="noreferrer">
              Open
            </a>
          )}
          {m.url && (
            <a className="btn sm" href={m.url} target="_blank" rel="noreferrer">
              Link
            </a>
          )}
          <button className="sm" onClick={toggle}>
            {open ? "Close" : m.status === "ready" ? "View text" : "Add text"}
          </button>
          <button
            className="sm danger"
            onClick={async () => {
              if (!confirm(`Delete "${m.title}"?`)) return;
              await api(`/api/materials/${m.id}`, { method: "DELETE" });
              reload();
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {m.note && <div className="small muted">{m.note}</div>}
      {isAudio && m.path && <audio controls preload="none" src={`/api/materials/${m.id}/file`} style={{ width: "100%", marginTop: 6 }} />}
      {yt && open && (
        <iframe
          style={{ width: "100%", maxWidth: 560, aspectRatio: "16/9", border: 0, borderRadius: 8, marginTop: 6 }}
          src={`https://www.youtube-nocookie.com/embed/${yt}`}
          allowFullScreen
          title={m.title}
        />
      )}
      {open && full && (
        <div className="stack" style={{ marginTop: 8 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 220, fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }} />
          <div className="row">
            <button className="primary sm" onClick={() => patch({ text })} disabled={text === (full.text ?? "")}>
              Save text
            </button>
            <span className="small muted">{text.length.toLocaleString()} characters. Edits are searchable and used for the brainmap.</span>
          </div>
        </div>
      )}
    </div>
  );
}
