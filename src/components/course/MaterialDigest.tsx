"use client";

import { useMemo, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Mermaid } from "../Mermaid";
import { digestMindmap } from "@/lib/mermaid";
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
        mindmap && <Mermaid code={mindmap} zoom />
      )}
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
