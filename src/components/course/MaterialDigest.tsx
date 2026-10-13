"use client";

import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Mermaid } from "../Mermaid";
import { ExportMenu } from "../ExportMenu";
import { digestMindmap } from "@/lib/mermaid";
import { addDigestItem, digestNote, digestPaths, digestTitle, insideAny, moveDigestItems, removeDigestItems, renameDigestItem, setDigestNote } from "@/lib/digestEdit";
import type { Digest, DigestEvidence, DigestTopic, Material } from "@/lib/types";

/** Seconds from "mm:ss" or "h:mm:ss". */
function seconds(stamp: string): number {
  return stamp.split(":").reduce((s, part) => s * 60 + Number(part), 0);
}

/**
 * A material's summary, key terms and its map: the key terms with what the material says about each
 * (quoted, with the section or time), as a list or as an editable mindmap. The course brainmap is built
 * from these maps. Timestamps jump the player (the file's, or the YouTube video's) to that moment.
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
  // The map is what the student checks and edits before the course brainmap is built from it.
  const [view, setView] = useState<"topics" | "mindmap">("mindmap");
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

  const summarise = () =>
    (!m.digest?.edited || window.confirm("Read this item again? Its map is made again from its key terms, and your edits to the map are replaced.")) &&
    act("Summarising…", () => api<Material>(`/api/materials/${m.id}/digest`, { method: "POST", json: { ai } }));
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

  const stamp = (t: { start: string | null }) =>
    t.start ? (
      onSeek ? (
        <button className="link small" onClick={() => onSeek(seconds(t.start!))} title="Play from here">
          [{t.start}]
        </button>
      ) : (
        <span className="small muted">[{t.start}]</span>
      )
    ) : null;
  const keywordsFirst = d.basis === "keywords";
  // What the material itself says about a term, past the note: the other places it says it.
  const quotes = (t: DigestTopic) => {
    const more = (t.evidence ?? []).filter((e) => e.text !== t.summary);
    return more.length ? (
      <ul className="digest-quotes small muted">
        {more.map((e: DigestEvidence, k) => (
          <li key={k}>
            “{e.text}” {e.where && <span>— {e.where}</span>} {stamp(e)}
          </li>
        ))}
      </ul>
    ) : null;
  };
  const where = (t: DigestTopic) => {
    const w = t.evidence?.find((e) => e.text === t.summary)?.where;
    return w ? <span className="small muted"> — {w}</span> : null;
  };

  return (
    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      <div className="spread">
        <strong>
          Summary{d.by === "offline" ? <span className="small muted"> (extracted without AI)</span> : null}
          {d.edited ? <span className="small muted"> · map edited by you</span> : null}
        </strong>
        <div className="row">
          <div className="markseg">
            {(["topics", "mindmap"] as const).map((v) => (
              <button key={v} className={view === v ? "on familiar" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "topics" ? (keywordsFirst ? "Key terms" : "Topics") : "Map"}
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
                {where(t)}
                {t.summary && <Markdown>{t.summary}</Markdown>}
                {quotes(t)}
                {!!t.subtopics?.length && (
                  <ul>
                    {t.subtopics.map((s, j) => (
                      <li key={j}>
                        {stamp(s)} {s.title}
                        {where(s)}
                        {s.summary && (
                          <div className="muted">
                            <Markdown>{s.summary}</Markdown>
                          </div>
                        )}
                        {quotes(s)}
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
 * The material's map as an editable mindmap: click to pick (Ctrl/Shift-click for several), drag a term
 * onto another to move it there (Alt to copy), and add, cut, copy, paste, rename, re-note or delete the
 * picked ones. Plus and minus signs fold branches; Collapse all and Expand all fold the whole map.
 */
function DigestMap({ m, d, code, onSaved }: { m: Material; d: Digest; code: string; onSaved: (m?: Material) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [clip, setClip] = useState<{ mode: "cut" | "copy"; names: string[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [noting, setNoting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const item = d.basis === "keywords" ? "term" : "topic";
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
    if (clip.mode === "cut" && insideAny(d, clip.names, into)) return setError(`A ${item} can't go inside itself.`);
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
    else if (e.key === "Insert" || (e.key === "Tab" && picked.length === 1)) (e.preventDefault(), setAdding(true));
    else if (e.key === "Escape") (setPicked([]), setClip(null));
  }

  const into = picked.length === 1 ? `into "${digestTitle(d, picked[0])}"` : `as main ${item}s`;
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
              <>
                <button className="sm" onClick={() => setRenaming(picked[0])} title="Rename (F2)">
                  ✎ Rename
                </button>
                <button className="sm" onClick={() => setNoting(picked[0])} title="Change what the note under it says">
                  Note
                </button>
              </>
            )}
            <button className="sm danger" onClick={remove} title="Delete (Del)">
              Delete
            </button>
            <button className="sm ghost" onClick={() => setPicked([])}>
              Clear
            </button>
          </>
        ) : (
          <span className="small muted">
            Click a {item} to pick it (Ctrl/Shift-click for more). Drag one onto another to move it there, hold Alt to copy. The course brainmap is built from this map.
          </span>
        )}
        <button className="sm" onClick={() => setAdding(true)} title={picked.length === 1 ? `Add a ${item} under the picked one (Tab)` : `Add a main ${item} (Insert)`}>
          + Add {item}
        </button>
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
      {adding && (
        <form
          className="stack"
          style={{ gap: 4 }}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save(addDigestItem(d, picked.length === 1 ? picked[0] : "root", (f.get("title") as string) ?? "", (f.get("note") as string) ?? ""), () => setAdding(false));
          }}
        >
          <div className="row">
            <input name="title" autoFocus placeholder={`New ${item}${picked.length === 1 ? ` under "${digestTitle(d, picked[0])}"` : ""}`} aria-label={`New ${item}`} style={{ flex: 1 }} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
            <button className="sm primary" type="submit">
              Add
            </button>
            <button className="sm" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          <input name="note" placeholder="What the item says about it (optional)" aria-label="Note" />
        </form>
      )}
      {noting && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            save(setDigestNote(d, noting, (new FormData(e.currentTarget).get("note") as string) ?? ""), () => setNoting(null));
          }}
        >
          <textarea name="note" defaultValue={digestNote(d, noting)} autoFocus rows={2} aria-label="Note" style={{ flex: 1 }} onKeyDown={(e) => e.key === "Escape" && setNoting(null)} />
          <button className="sm primary" type="submit">
            Save
          </button>
          <button className="sm" type="button" onClick={() => setNoting(null)}>
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
        dragLabel={(nid) => (picked.includes(nid) && picked.length > 1 ? `${picked.length} ${item}s` : digestTitle(d, nid))}
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
