"use client";

import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Mermaid } from "../Mermaid";
import { ExportMenu } from "../ExportMenu";
import { digestMindmap } from "@/lib/mermaid";
import { digestPaths, digestTitle, insideAny, moveDigestItems, removeDigestItems, renameDigestItem } from "@/lib/digestEdit";
import type { Digest, DigestTopic, Material } from "@/lib/types";

/** Seconds from "mm:ss" or "h:mm:ss". */
function seconds(stamp: string): number {
  return stamp.split(":").reduce((s, part) => s * 60 + Number(part), 0);
}

/**
 * A material's summary, key terms and topics, with its own mindmap. Timestamps jump the player
 * (the file's, or the YouTube video's) to where that topic starts.
 */
export function MaterialDigest({
  m,
  ai,
  onChanged,
  onSeek,
}: {
  m: Material;
  ai: boolean;
  onChanged: (m?: Material) => void;
  onSeek?: (sec: number) => void;
}) {
  const [view, setView] = useState<"topics" | "mindmap">("topics");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const d = m.digest;
  const shown = useRef<HTMLDivElement>(null);
  const mindmap = useMemo(() => (d && view === "mindmap" ? digestMindmap(m.title, d) : ""), [d, view, m.title]);

  async function act(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      if (done) setMsg({ text: done });
      onChanged(r && typeof r === "object" && "digest" in r ? (r as Material) : undefined);
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  const summarise = () => act("Summarising…", () => api<Material>(`/api/materials/${m.id}/digest`, { method: "POST", json: { ai } }));
  const toBrainmap = () =>
    act("Adding…", () => api(`/api/materials/${m.id}/brainmap`, { method: "POST" }), "Added as a new branch of the brainmap. Rebuild the brainmap later to merge it with the rest of the course.");

  if (!d)
    return (
      <div className="row small">
        <button className="sm" disabled={!!busy || !m.text} onClick={summarise}>
          {busy ?? "Summarise"}
        </button>
        {msg && <span style={msg.error ? { color: "var(--dont)" } : undefined}>{msg.text}</span>}
      </div>
    );

  const stamp = (t: DigestTopic) =>
    t.start ? (
      onSeek ? (
        <button className="link small" onClick={() => onSeek(seconds(t.start!))} title="Play from here">
          [{t.start}]
        </button>
      ) : (
        <span className="small muted">[{t.start}]</span>
      )
    ) : null;

  return (
    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      <div className="spread">
        <strong>Summary{d.by === "offline" ? <span className="small muted"> (extracted without AI)</span> : null}</strong>
        <div className="row">
          <div className="markseg">
            {(["topics", "mindmap"] as const).map((v) => (
              <button key={v} className={view === v ? "on familiar" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "topics" ? "Topics" : "Mindmap"}
              </button>
            ))}
          </div>
          <ExportMenu url={`/api/materials/${m.id}/digest/print`} title={`${m.title} - summary`} printTarget={() => shown.current} disabled={!!busy} />
          <button className="sm" disabled={!!busy || !d.topics.length} onClick={toBrainmap} title="Add this item's topics to the course brainmap as a new branch">
            {busy === "Adding…" ? busy : "Add to brainmap"}
          </button>
          <button className="sm" disabled={!!busy} onClick={summarise} title={ai ? "Summarise again with the AI" : "Extract again"}>
            {busy === "Summarising…" ? busy : ai && d.by === "offline" ? "Summarise with AI" : "Summarise again"}
          </button>
        </div>
      </div>
      {msg && (
        <div className="small" role="status" style={msg.error ? { color: "var(--dont)" } : undefined}>
          {msg.text}
        </div>
      )}
      <div ref={shown} className="stack" style={{ gap: 8 }}>
        <Markdown>{d.summary}</Markdown>
        {d.keywords.length > 0 && (
          <div className="row small" style={{ gap: 4, flexWrap: "wrap" }}>
            {d.keywords.map((k) => (
              <span key={k} className="badge">
                {k}
              </span>
            ))}
          </div>
        )}
        {view === "topics" ? (
          <ol className="digest-topics">
            {d.topics.map((t, i) => (
              <li key={i}>
                {stamp(t)} <strong>{t.title}</strong>
                {t.summary && <Markdown>{t.summary}</Markdown>}
                {!!t.subtopics?.length && (
                  <ul>
                    {t.subtopics.map((s, j) => (
                      <li key={j}>
                        {stamp(s)} {s.title}
                        {s.summary && (
                          <div className="muted">
                            <Markdown>{s.summary}</Markdown>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        ) : (
          mindmap && <DigestMap m={m} d={d} code={mindmap} onSaved={onChanged} />
        )}
      </div>
    </div>
  );
}

/**
 * The material's topics as an editable mindmap: click to pick (Ctrl/Shift-click for several), drag a
 * topic onto another to move it there (Alt to copy), and cut, copy, paste, rename or delete the picked
 * ones. Plus and minus signs fold branches.
 */
function DigestMap({ m, d, code, onSaved }: { m: Material; d: Digest; code: string; onSaved: (m?: Material) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [clip, setClip] = useState<{ mode: "cut" | "copy"; names: string[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const paths = useMemo(() => digestPaths(d), [d]);
  const marks = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of picked) out[n] = "picked";
    if (clip?.mode === "cut") for (const n of clip.names) out[n] = `${out[n] ?? ""} cut`;
    return out;
  }, [picked, clip]);

  async function save(next: Digest, after?: () => void) {
    if (next === d) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api<Material>(`/api/materials/${m.id}/digest`, { method: "PUT", json: { digest: next } });
      setPicked([]);
      after?.();
      onSaved(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const paste = () => {
    if (!clip) return;
    const into = picked.length === 1 ? picked[0] : "root";
    if (clip.mode === "cut" && insideAny(d, clip.names, into)) return setError("A topic can't go inside itself.");
    save(moveDigestItems(d, clip.names, into, clip.mode === "copy"), () => clip.mode === "cut" && setClip(null));
  };
  const remove = () => picked.length && save(removeDigestItems(d, picked));

  function onKey(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "x" && picked.length) (e.preventDefault(), setClip({ mode: "cut", names: picked }));
    else if ((e.ctrlKey || e.metaKey) && k === "c" && picked.length) (e.preventDefault(), setClip({ mode: "copy", names: picked }));
    else if ((e.ctrlKey || e.metaKey) && k === "v" && clip) (e.preventDefault(), paste());
    else if ((e.key === "Delete" || e.key === "Backspace") && picked.length) (e.preventDefault(), remove());
    else if (e.key === "F2" && picked.length === 1) (e.preventDefault(), setRenaming(picked[0]));
    else if (e.key === "Escape") (setPicked([]), setClip(null));
  }

  const into = picked.length === 1 ? `into "${digestTitle(d, picked[0])}"` : "as main topics";
  return (
    <div className="stack" style={{ gap: 6 }} onKeyDown={onKey}>
      <div className="selbar" role="toolbar" aria-label="Edit this item's topics">
        {picked.length > 0 ? (
          <>
            <strong className="small">{picked.length === 1 ? `"${digestTitle(d, picked[0])}"` : `${picked.length} picked`}</strong>
            <button className="sm" onClick={() => setClip({ mode: "cut", names: picked })} title="Cut, then paste somewhere else to move (Ctrl+X)">
              ✂ Cut
            </button>
            <button className="sm" onClick={() => setClip({ mode: "copy", names: picked })} title="Copy, then paste to duplicate (Ctrl+C)">
              ⧉ Copy
            </button>
            {picked.length === 1 && (
              <button className="sm" onClick={() => setRenaming(picked[0])} title="Rename (F2)">
                ✎ Rename
              </button>
            )}
            <button className="sm danger" onClick={remove} title="Delete (Del)">
              Delete
            </button>
            <button className="sm ghost" onClick={() => setPicked([])}>
              Clear
            </button>
          </>
        ) : (
          <span className="small muted">Click a topic to pick it (Ctrl/Shift-click for more). Drag one onto another to move it there, hold Alt to copy.</span>
        )}
        {clip && (
          <button className="sm primary" onClick={paste} title="Paste (Ctrl+V)">
            Paste {clip.names.length} {into}
          </button>
        )}
        {clip && (
          <button className="sm ghost" onClick={() => setClip(null)}>
            Cancel {clip.mode}
          </button>
        )}
        {saving && <span className="small muted">Saving…</span>}
      </div>
      {renaming && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const v = (new FormData(e.currentTarget).get("title") as string) ?? "";
            save(renameDigestItem(d, renaming, v), () => setRenaming(null));
          }}
        >
          <input name="title" defaultValue={digestTitle(d, renaming)} autoFocus aria-label="New name" style={{ flex: 1 }} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
          <button className="sm primary" type="submit">
            Save
          </button>
          <button className="sm" type="button" onClick={() => setRenaming(null)}>
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
        code={code}
        zoom
        marks={marks}
        onNodeClick={(nid, how) => {
          if (nid === "root") return setPicked([]);
          setPicked((p) => (how.extend ? (p.includes(nid) ? p.filter((x) => x !== nid) : [...p, nid]) : [nid]));
        }}
        dragLabel={(nid) => (picked.includes(nid) && picked.length > 1 ? `${picked.length} topics` : digestTitle(d, nid))}
        onNodeDrop={{
          canDrop: (from, to) => from !== to && !!paths[from] && (to === "root" || !!paths[to]) && !insideAny(d, picked.includes(from) ? picked : [from], to),
          drop: (from, to, copy) => save(moveDigestItems(d, picked.includes(from) ? picked : [from], to, copy)),
        }}
      />
    </div>
  );
}

/** Key terms shown under a material's title. */
export function DigestKeywords({ d }: { d: Digest | null | undefined }) {
  if (!d?.keywords.length) return null;
  return (
    <div className="small muted" style={{ marginTop: 2 }}>
      {d.keywords.slice(0, 6).join(" · ")}
    </div>
  );
}
