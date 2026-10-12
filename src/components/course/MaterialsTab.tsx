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
import { batches, filterPicked, fromDrop, fromInput, type PickedFile } from "../folderImport";
import { MATERIAL_KINDS, MATERIAL_KIND_LABELS, type Material, type MaterialKind } from "@/lib/types";
import { hasTimestamps } from "@/lib/transcript";
import { Markdown } from "../Markdown";
import { DigestKeywords, MaterialDigest } from "./MaterialDigest";
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
  const [ai, setAi] = useState(false);
  useEffect(() => {
    api<{ ai: boolean }>("/api/status")
      .then((st) => setAi(st.ai))
      .catch(() => {});
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<{ added: number; skipped: { name: string; reason: string }[]; ignored: number } | null>(null);

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
      const r = (await fn()) as { materials?: Material[] } | undefined;
      if (r?.materials) onAdded(r.materials);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Count new materials; recordings without text are transcribed (after the whole import, so captions found later win). */
  function onAdded(list: Material[], defer?: Map<string, Material>) {
    setAdded((n) => n + list.filter((m) => !defer?.has(m.id)).length);
    if (defer) for (const m of list) defer.set(m.id, m);
    else afterImport(list);
  }

  /** Transcribe recordings that came without text, and clean up imported transcripts if the student turned timestamps off. */
  function afterImport(list: Iterable<Material>) {
    const s = loadSettings();
    const cleanups: Promise<unknown>[] = [];
    for (const m of list) {
      if (s.auto && isRecording(m) && m.status !== "ready") transcribe(m);
      else if (!s.stamps && hasTimestamps(m.text)) cleanups.push(api(`/api/materials/${m.id}`, { method: "PATCH", json: { clean: true } }));
    }
    if (cleanups.length) Promise.allSettled(cleanups).then(reload);
  }

  function update(p: Partial<TranscribeSettings>) {
    const next = { ...settings, ...p };
    setSettings(next);
    saveSettings(next);
  }

  /** Upload files (or a whole folder) a few at a time, so big folders show progress and one bad file doesn't stop the rest. */
  async function upload(picked: PickedFile[], forceKind?: MaterialKind) {
    const { keep, ignored } = filterPicked(picked);
    if (!keep.length) {
      if (ignored) setReport({ added: 0, skipped: [], ignored });
      return;
    }
    setBusy(`Importing ${keep.length} file${keep.length > 1 ? "s" : ""}…`);
    setError(null);
    setReport(null);
    const total = { added: 0, skipped: [] as { name: string; reason: string }[], ignored };
    const fresh = new Map<string, Material>();
    let done = 0;
    // Keep each folder's files together, so a video and its captions file usually arrive in the same batch.
    keep.sort((a, b) => (a.path || a.file.name).localeCompare(b.path || b.file.name));
    try {
      for (const group of batches(keep)) {
        const fd = new FormData();
        for (const p of group) {
          fd.append("files", p.file);
          fd.append("paths", p.path);
        }
        if (forceKind || kind) fd.append("kind", forceKind || kind);
        try {
          const r = await api<{ materials: Material[]; skipped: { name: string; reason: string }[] }>(`/api/courses/${id}/materials`, { method: "POST", body: fd });
          onAdded(r.materials, fresh);
          total.skipped.push(...r.skipped);
        } catch (e) {
          total.skipped.push(...group.map((p) => ({ name: p.path || p.file.name, reason: (e as Error).message })));
        }
        done += group.length;
        setBusy(`Importing ${done} of ${keep.length} files…`);
        reload();
      }
      total.added = fresh.size; // a video updated by its captions later counts once
      if (keep.length > 1 || total.skipped.length || ignored) setReport(total);
      afterImport(fresh.values());
    } finally {
      setBusy(null);
    }
  }

  function addUrl(url: string) {
    return run("Fetching link…", () => api(`/api/courses/${id}/materials`, { method: "POST", json: { url, kind: kind || undefined } }));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) {
      fromDrop(e.dataTransfer)
        .then((list) => upload(list))
        .catch(() => upload(Array.from(e.dataTransfer.files).map((file) => ({ file, path: "" }))));
      return;
    }
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
        <strong>{busy ?? "Drop files, a whole folder, or links here"}</strong>
        <span className="muted small">
          PDF, slides (PPTX), Word, text/Markdown, images of notes, audio and video recordings (with .srt/.vtt captions), saved YouTube links, sample exams, workshop and tutorial sheets, or a .zip of them.
          Folders are read with all their subfolders, and folder names like &quot;Tutorials&quot; or &quot;Past exams&quot; set the item type. You can
          also drag a YouTube link from your browser.
        </span>
        <div className="row" style={{ justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
          <button className="sm" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            Choose files
          </button>
          <button className="sm" disabled={!!busy} onClick={() => folderRef.current?.click()}>
            📁 Choose a folder
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) upload(fromInput(e.target.files));
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          hidden
          // @ts-expect-error: non-standard but supported by every current browser
          webkitdirectory=""
          onChange={(e) => {
            if (e.target.files) upload(fromInput(e.target.files));
            e.target.value = "";
          }}
        />
      </div>
      {report && (
        <div className="alert info stack" role="status">
          <div className="spread">
            <span>
              Added {report.added} item{report.added === 1 ? "" : "s"}.
              {report.skipped.length > 0 && ` Skipped ${report.skipped.length}.`}
              {report.ignored > 0 && ` Left out ${report.ignored} system or non-study file${report.ignored === 1 ? "" : "s"}.`}
            </span>
            <button className="sm ghost" onClick={() => setReport(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
          {report.skipped.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer" }} className="small">
                What was skipped
              </summary>
              <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {report.skipped.slice(0, 200).map((s, i) => (
                  <li key={i}>
                    {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

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
        <Recorder onRecorded={(f) => upload([{ file: f, path: "" }], "audio_memo")} disabled={!!busy} />
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
              <input type="checkbox" checked={settings.tidy} onChange={(e) => update({ tidy: e.target.checked })} /> Organise transcripts into notes with AI (set up in Settings)
            </label>
            <label className="row">
              <input type="checkbox" checked={settings.auto} onChange={(e) => update({ auto: e.target.checked })} /> Transcribe new recordings automatically
            </label>
            <label className="row" title="Timestamps help you find a spot in the recording; without them transcripts read like plain notes">
              <input type="checkbox" checked={!settings.stamps} onChange={(e) => update({ stamps: !e.target.checked })} /> Clean up transcripts: remove [mm:ss] timestamps
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
            {added} item{added > 1 ? "s" : ""} added. {data.tree.length
              ? "Videos and recordings join the brainmap as their own branches; rebuild it to merge everything into one map."
              : "Build the brainmap when you've added everything."}
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
              <MaterialRow key={m.id} m={m} ai={ai} reload={reload} job={jobs[m.id]} onTranscribe={() => transcribe(m)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MaterialRow({
  m,
  ai,
  reload,
  job,
  onTranscribe,
}: {
  m: Material;
  ai: boolean;
  reload: () => void;
  job?: { label: string; error?: boolean };
  onTranscribe: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<Material | null>(null);
  const [text, setText] = useState("");
  const isAudio = isRecording(m);
  const running = job && !job.error;
  const yt = m.url?.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{6,})/)?.[1];
  const [refetch, setRefetch] = useState<{ busy?: boolean; error?: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [layer, setLayer] = useState<{ label: string; error?: boolean } | null>(null);
  const media = useRef<HTMLMediaElement | null>(null);
  const canLayer = !!m.path && !!m.scan?.pages.length && !m.scan.layer;

  /** OCR the scanned pages on the server, a batch per request, until the text layer is written. */
  async function addLayer() {
    const n = m.scan?.pages.length ?? 0;
    setLayer({ label: `Reading ${n} scanned page${n === 1 ? "" : "s"} with OCR…` });
    try {
      for (;;) {
        const r = await api<{ done: boolean; read: number; total: number }>(`/api/materials/${m.id}/ocr`, { method: "POST" });
        if (r.done) break;
        setLayer({ label: `Read ${r.read} of ${r.total} scanned pages with OCR…` });
      }
      setLayer(null);
      setFull(null);
      reload();
    } catch (e) {
      setLayer({ label: (e as Error).message, error: true });
    }
  }
  const [ytStart, setYtStart] = useState(0);

  /** Jump the recording (or the YouTube player) to a topic's timestamp. */
  function seek(sec: number) {
    if (yt) setYtStart(sec);
    else if (media.current) {
      media.current.currentTime = sec;
      media.current.play().catch(() => {});
    }
  }

  async function fetchAgain() {
    setRefetch({ busy: true });
    try {
      await api(`/api/materials/${m.id}`, { method: "PATCH", json: { refresh: true } });
      setRefetch(null);
      reload();
    } catch (e) {
      setRefetch({ error: (e as Error).message });
    }
  }

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
          {m.rel_path && (
            <span className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.rel_path}>
              {m.rel_path.split("/").slice(0, -1).join(" / ")}
            </span>
          )}
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
          {yt && m.status !== "ready" && (
            <button className="sm" disabled={refetch?.busy} onClick={fetchAgain} title="Fetch the video's transcript again">
              {refetch?.busy ? "Fetching…" : "Try again"}
            </button>
          )}
          {canLayer && (
            <button
              className={`sm${m.status === "ready" ? "" : " primary"}`}
              disabled={!!layer && !layer.error}
              onClick={addLayer}
              title="Read the pages that are pictures with OCR on this computer, and write the text into the PDF so it can be searched and selected"
            >
              Add text layer
            </button>
          )}
          {isAudio && m.path && (
            <button className={`sm${m.status === "ready" ? "" : " primary"}`} disabled={!!running} onClick={onTranscribe}>
              {m.status === "ready" ? "Re-transcribe" : "Transcribe"}
            </button>
          )}
          {hasTimestamps(m.text) && !running && (
            <button
              className="sm"
              title="Remove the [mm:ss] timestamps so the transcript reads like plain notes"
              onClick={async () => {
                const f = await api<Material>(`/api/materials/${m.id}`, { method: "PATCH", json: { clean: true } });
                if (full) {
                  setFull(f);
                  setText(f.text ?? "");
                }
                reload();
              }}
            >
              Clean up
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
      {job || layer ? (
        <div className={`small ${(job ?? layer)!.error ? "" : "muted"}`} role="status" style={(job ?? layer)!.error ? { color: "var(--dont)" } : undefined}>
          {!(job ?? layer)!.error && <span className="spinner" aria-hidden />} {(job ?? layer)!.label}
        </div>
      ) : (
        m.note && <div className="small muted">{m.note}</div>
      )}
      <DigestKeywords d={m.digest} />
      {refetch?.error && (
        <div className="small" role="status" style={{ color: "var(--dont)" }}>
          {refetch.error}
        </div>
      )}
      {isAudio && m.path && (m.mime ?? "").startsWith("audio/") && (
        <audio ref={(el) => void (media.current = el)} controls preload="none" src={`/api/materials/${m.id}/file`} style={{ width: "100%", marginTop: 6 }} />
      )}
      {isAudio && m.path && (m.mime ?? "").startsWith("video/") && open && (
        <video ref={(el) => void (media.current = el)} controls preload="metadata" src={`/api/materials/${m.id}/file`} style={{ width: "100%", maxWidth: 640, maxHeight: 360, marginTop: 6, borderRadius: 8 }} />
      )}
      {yt && open && (
        <iframe
          style={{ width: "100%", maxWidth: 560, aspectRatio: "16/9", border: 0, borderRadius: 8, marginTop: 6 }}
          src={`https://www.youtube-nocookie.com/embed/${yt}${ytStart ? `?start=${ytStart}&autoplay=1` : ""}`}
          allowFullScreen
          title={m.title}
        />
      )}
      {open && full && (
        <div className="stack" style={{ marginTop: 8 }}>
          {full.text?.trim() && <MaterialDigest m={m} ai={ai} onChanged={reload} onSeek={isAudio || yt ? seek : undefined} />}
          {preview ? (
            <div className="card" style={{ maxHeight: 420, overflow: "auto" }}>
              <Markdown>{text}</Markdown>
            </div>
          ) : (
            <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 220, fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }} />
          )}
          <div className="row">
            <button className="primary sm" onClick={() => patch({ text })} disabled={text === (full.text ?? "")}>
              Save text
            </button>
            <button className="sm" onClick={() => setPreview(!preview)} title="Show the text formatted, with formulas rendered">
              {preview ? "Edit" : "Preview"}
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
