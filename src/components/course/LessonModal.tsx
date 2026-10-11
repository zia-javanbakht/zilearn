"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { DEPTH_LEVELS } from "@/lib/types";

export function LessonModal({ topicId, title, depth: initialDepth, onClose }: { topicId: string; title: string; depth: number; onClose: () => void }) {
  const [depth, setDepth] = useState(initialDepth);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(regenerate = false) {
    setBusy(true);
    setError(null);
    if (regenerate) setContent(null);
    try {
      const r = await api<{ content: string }>(`/api/topics/${topicId}/lesson?depth=${depth}`, { method: regenerate ? "POST" : "GET" });
      setContent(r.content);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setContent(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, depth]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="row" style={{ margin: "12px 0" }}>
          {DEPTH_LEVELS.map((l) => (
            <button key={l.level} className={`sm ${depth === l.level ? "primary" : ""}`} onClick={() => setDepth(l.level)}>
              {l.level} · {l.name}
            </button>
          ))}
          <span className="grow" />
          <button className="sm" disabled={busy} onClick={() => load(true)}>
            Regenerate
          </button>
        </div>
        <p className="small muted">{DEPTH_LEVELS[depth - 1].goal}</p>
        {error && <div className="alert error">{error}</div>}
        {content === null && !error ? (
          <p className="muted">
            <span className="spinner" /> Preparing the lesson…
          </p>
        ) : (
          content && <Markdown>{content}</Markdown>
        )}
      </div>
    </div>
  );
}
