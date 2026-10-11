"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Busy } from "../Busy";
import { DEPTH_LEVELS } from "@/lib/types";

export function LessonModal({
  topicId,
  title,
  depth: initialDepth,
  onClose,
  onCompleted,
}: {
  topicId: string;
  title: string;
  depth: number;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const [completed, setCompleted] = useState<number | null>(null);
  const [depth, setDepth] = useState(initialDepth);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<"tex" | "pdf" | null>(null);
  // Ignore responses that arrive after the user switched level or regenerated again.
  const reqRef = useRef(0);

  async function load(regenerate = false) {
    const req = ++reqRef.current;
    setBusy(true);
    setError(null);
    if (regenerate) setContent(null);
    try {
      const r = await api<{ content: string }>(`/api/topics/${topicId}/lesson?depth=${depth}`, { method: regenerate ? "POST" : "GET" });
      if (req === reqRef.current) setContent(r.content);
    } catch (e) {
      if (req === reqRef.current) setError((e as Error).message);
    } finally {
      if (req === reqRef.current) setBusy(false);
    }
  }

  /** Download the printable version made with the Z class: the LaTeX source, or a PDF compiled here. */
  async function download(format: "tex" | "pdf") {
    setPrinting(format);
    setError(null);
    try {
      const r = await fetch(`/api/topics/${topicId}/lesson/print?depth=${depth}&format=${format}`);
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Couldn't make the ${format.toUpperCase()}.`);
      const name = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `lesson.${format}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob());
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrinting(null);
    }
  }

  useEffect(() => {
    setContent(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, depth]);

  // Dialog keyboard behaviour: Escape closes, Tab stays inside, focus returns to where it was.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, textarea, select, summary, [tabindex="0"]');
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spread">
          <h2 id="lesson-title" style={{ margin: 0 }}>
            {title}
          </h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="row" style={{ margin: "12px 0" }}>
          {DEPTH_LEVELS.map((l) => (
            <button key={l.level} className={`sm ${depth === l.level ? "primary" : ""}`} aria-pressed={depth === l.level} onClick={() => setDepth(l.level)}>
              {l.level} · {l.name}
            </button>
          ))}
          <span className="grow" />
          <button className="sm" disabled={busy} onClick={() => load(true)}>
            Regenerate
          </button>
        </div>
        <p className="small muted">{DEPTH_LEVELS[depth - 1].goal}</p>
        {error && <div className="alert error" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}
        {content && (
          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
            <button className="sm" disabled={!!printing || busy} onClick={() => download("pdf")} title="Compile a printable PDF with your Z LaTeX class (needs XeLaTeX on this computer)">
              {printing === "pdf" ? "Making the PDF…" : "Print (PDF)"}
            </button>
            <button className="sm" disabled={!!printing || busy} onClick={() => download("tex")} title="The lesson as a LaTeX file that uses the Z class">
              LaTeX (.tex)
            </button>
            <span className="grow" />
            {completed === depth ? (
              <span className="badge know">Level {depth} recorded</span>
            ) : (
              <button
                className="sm primary"
                onClick={async () => {
                  try {
                    await api(`/api/topics/${topicId}/progress`, { method: "POST", json: { depth } });
                    setCompleted(depth);
                    onCompleted?.();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                ✓ I&apos;ve finished level {depth}
              </button>
            )}
          </div>
        )}
        {content === null && !error ? (
          <p className="muted">
            <Busy label="Preparing the lesson…" hint="usually under a minute" />
          </p>
        ) : (
          content && <Markdown>{content}</Markdown>
        )}
      </div>
    </div>
  );
}
