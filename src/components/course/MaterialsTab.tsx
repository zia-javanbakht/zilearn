"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  describeProgress,
  isRecording,
  loadSettings,
  saveSettings,
  transcribeMaterial,
  WHISPER_MODELS,
  DEFAULT_SETTINGS,
  type TranscribeSettings,
} from "../transcribe";
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

  // Transcription runs one recording at a time, in the browser.
  const [settings, setSettings] = useState<TranscribeSettings>(DEFAULT_SETTINGS);
  useEffect(() => setSettings(loadSettings()), []);
  const [jobs, setJobs] = useState<Record<string, { label: string; error?: boolean }>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const transcribe = useCallback(
    (m: Material) => {
      setJobs((j) => ({ ...j, [m.id]: { label: "Waiting for the previous recording…" } }));
      const s = loadSettings();
      queue.current = queue.current.then(async () => {
        try {
          await transcribeMaterial(m, s, (p) => setJobs((j) => ({ ...j, [m.id]: { label: describeProgress(p) } })));
          setJobs(({ [m.id]: _, ...rest }) => rest);
          reload();
        } catch (e) {
          setJobs((j) => ({ ...j, [m.id]: { label: (e as Error).message, error: true } }));
        }
      });
    },
    [reload],
  );

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      const r = await fn();
      if (Array.isArray(r)) {
        setAdded((n) => n + r.length);
        if (loadSettings().auto) for (const m of r as Material[]) if (isRecording(m) && m.status !== "ready") transcribe(m);
      }
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function update(p: Partial<TranscribeSettings>) {
    const next = { ...settings, ...p };
    setSettings(next);
    saveSettings(next);
  }

  function upload(files: FileList | File[], forceKind?: MaterialKind) {
    const list = Array.from(files);
    if (!list.length) return;
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    if (forceKind || kind) fd.append("kind", forceKind || kind);
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

      <div className="row">
        <Recorder onRecorded={(f) => upload([f], "audio_memo")} disabled={!!busy} />
        <details className="grow">
          <summary style={{ cursor: "pointer" }} className="small">
            Transcription settings
          </summary>
          <div className="row small" style={{ marginTop: 8 }}>
            <label className="field">
              Speech model
              <select value={settings.model} onChange={(e) => update({ model: e.target.value as TranscribeSettings["model"] })}>
                {Object.entries(WHISPER_MODELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Language
              <select value={settings.language} onChange={(e) => update({ language: e.target.value })}>
                <option value="">Detect automatically</option>
                {["english", "spanish", "french", "german", "italian", "portuguese", "dutch", "persian", "arabic", "chinese", "japanese", "korean", "hindi", "turkish", "russian"].map((l) => (
                  <option key={l} value={l}>
                    {l[0].toUpperCase() + l.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <input type="checkbox" checked={settings.tidy} onChange={(e) => update({ tidy: e.target.checked })} /> Organise transcripts into notes with AI (Claude or Gemini)
            </label>
            <label className="row">
              <input type="checkbox" checked={settings.auto} onChange={(e) => update({ auto: e.target.checked })} /> Transcribe new recordings automatically
            </label>
          </div>
          <p className="small muted">
            Speech recognition runs in your browser with OpenAI&apos;s open Whisper model; your recordings are not uploaded anywhere. The model downloads once and
            is cached.
          </p>
        </details>
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
              <MaterialRow key={m.id} m={m} reload={reload} job={jobs[m.id]} onTranscribe={() => transcribe(m)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MaterialRow({
  m,
  reload,
  job,
  onTranscribe,
}: {
  m: Material;
  reload: () => void;
  job?: { label: string; error?: boolean };
  onTranscribe: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<Material | null>(null);
  const [text, setText] = useState("");
  const isAudio = isRecording(m);
  const running = job && !job.error;
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
          {isAudio && m.path && (
            <button className={`sm${m.status === "ready" ? "" : " primary"}`} disabled={!!running} onClick={onTranscribe}>
              {m.status === "ready" ? "Re-transcribe" : "Transcribe"}
            </button>
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
      {job ? (
        <div className={`small ${job.error ? "" : "muted"}`} role="status" style={job.error ? { color: "var(--dont)" } : undefined}>
          {!job.error && <span className="spinner" aria-hidden />} {job.label}
        </div>
      ) : (
        m.note && <div className="small muted">{m.note}</div>
      )}
      {isAudio && m.path && (m.mime ?? "").startsWith("audio/") && (
        <audio controls preload="none" src={`/api/materials/${m.id}/file`} style={{ width: "100%", marginTop: 6 }} />
      )}
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

/** Record a voice memo with the microphone; it is added as an audio memo (and transcribed if enabled). */
function Recorder({ onRecorded, disabled }: { onRecorded: (f: File) => void; disabled: boolean }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [rec]);
  useEffect(() => () => rec?.stream.getTracks().forEach((t) => t.stop()), [rec]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = r.mimeType.split(";")[0] || "audio/webm";
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        const d = new Date();
        const name = `Voice memo ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.${ext}`.replace(/[/\\:]/g, "-");
        onRecorded(new File(parts, name, { type: mime }));
        setRec(null);
      };
      r.start(1000);
      setSecs(0);
      setRec(r);
    } catch {
      setError("Microphone access was blocked. Allow it in the browser's address bar to record.");
    }
  }

  return (
    <div className="row">
      {rec ? (
        <button className="danger" onClick={() => rec.stop()} aria-label="Stop recording">
          ⏹ Stop recording ({Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")})
        </button>
      ) : (
        <button onClick={start} disabled={disabled}>
          🎙 Record a voice memo
        </button>
      )}
      {error && <span className="small" style={{ color: "var(--dont)" }}>{error}</span>}
    </div>
  );
}
