"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Busy } from "../Busy";
import { DEPTH_LEVELS } from "@/lib/types";

interface TocEntry {
  id: string;
  text: string;
}

/**
 * The lesson reader: a full-height dialog with the levels and actions always in view, a contents list for
 * the lesson's sections, a reading-progress bar, and a finish line at the end that leads to the next level.
 * Keys: 1 to 4 switch level, Escape closes.
 */
export function LessonModal({
  topicId,
  title,
  depth: initialDepth,
  achieved = 0,
  onClose,
  onCompleted,
}: {
  topicId: string;
  title: string;
  depth: number;
  /** The highest level already finished, to tick those levels. */
  achieved?: number;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const [done, setDone] = useState(achieved);
  const [depth, setDepth] = useState(initialDepth);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<"tex" | "pdf" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const exportRef = useRef<HTMLDetailsElement>(null);
  // Ignore responses that arrive after the user switched level or regenerated again.
  const reqRef = useRef(0);
  const level = DEPTH_LEVELS[depth - 1];

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

  function flash(text: string) {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), 2500);
  }

  function save(blob: Blob, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  /** Download the printable version made with the Z class: the LaTeX source, or a PDF compiled here. */
  async function download(format: "tex" | "pdf") {
    exportRef.current?.removeAttribute("open");
    setPrinting(format);
    setError(null);
    try {
      const r = await fetch(`/api/topics/${topicId}/lesson/print?depth=${depth}&format=${format}`);
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Couldn't make the ${format.toUpperCase()}.`);
      save(await r.blob(), r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `lesson.${format}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrinting(null);
    }
  }

  function slug() {
    return `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "lesson"}-level-${depth}`;
  }

  async function copyMarkdown() {
    exportRef.current?.removeAttribute("open");
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      flash("Copied the lesson as Markdown");
    } catch {
      save(new Blob([content], { type: "text/markdown" }), `${slug()}.md`);
    }
  }

  async function finish() {
    try {
      await api(`/api/topics/${topicId}/progress`, { method: "POST", json: { depth } });
      setDone((d) => Math.max(d, depth));
      onCompleted?.();
      flash(`Level ${depth} recorded`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    setContent(null);
    setToc([]);
    bodyRef.current?.scrollTo({ top: 0 });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, depth]);

  // Contents: the lesson's section headings, given ids so the list can jump to them.
  useEffect(() => {
    if (!content) return;
    const frame = requestAnimationFrame(() => {
      const hs = [...(articleRef.current?.querySelectorAll<HTMLHeadingElement>(".markdown h3") ?? [])];
      setToc(
        hs.map((h, i) => {
          h.id = `lesson-sec-${i}`;
          return { id: h.id, text: h.textContent?.trim() ?? "" };
        }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [content]);

  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
    const top = el.getBoundingClientRect().top + 80;
    let cur: string | null = null;
    for (const t of toc) {
      const h = document.getElementById(t.id);
      if (h && h.getBoundingClientRect().top <= top) cur = t.id;
    }
    setActive(cur ?? toc[0]?.id ?? null);
  }, [toc]);

  useEffect(onScroll, [onScroll]);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Dialog keyboard behaviour: Escape closes, 1-4 switch level, Tab stays inside, focus returns to where it was.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-4]$/.test(e.key)) return setDepth(Number(e.key));
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
    <div className="modal-backdrop reader-backdrop" onClick={onClose}>
      <div
        className="modal reader"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="reader-head">
          <div className="spread">
            <div style={{ minWidth: 0 }}>
              <h2 id="lesson-title" className="reader-title">
                {title}
              </h2>
              <div className="small muted">
                Level {depth} · {level.name}
                <span className="reader-goal">: {level.goal}</span>
              </div>
            </div>
            <button className="ghost" onClick={onClose} aria-label="Close" title="Close (Esc)">
              ✕
            </button>
          </div>
          <div className="row reader-actions">
            <div className="levelseg" role="group" aria-label="Level">
              {DEPTH_LEVELS.map((l) => (
                <button
                  key={l.level}
                  className={depth === l.level ? "on" : ""}
                  aria-pressed={depth === l.level}
                  onClick={() => setDepth(l.level)}
                  title={`${l.name}: ${l.goal} (key ${l.level})${l.level <= done ? " · finished" : ""}`}
                >
                  {l.level <= done ? "✓" : l.level} <span className="levelseg-name">{l.name}</span>
                </button>
              ))}
            </div>
            <span className="grow" />
            {note && (
              <span className="small reader-note" role="status">
                {note}
              </span>
            )}
            <details className="menu" ref={exportRef}>
              <summary className="btn sm" aria-disabled={!content || busy}>
                {printing === "pdf" ? "Making the PDF…" : printing === "tex" ? "Making the LaTeX…" : "Export ▾"}
              </summary>
              <div className="menu-list">
                <button className="sm" disabled={!content || !!printing || busy} onClick={() => download("pdf")} title="Compile a printable PDF with your Z LaTeX class (needs XeLaTeX on this computer)">
                  Print (PDF)
                </button>
                <button className="sm" disabled={!content || !!printing || busy} onClick={() => download("tex")} title="The lesson as a LaTeX file that uses the Z class">
                  LaTeX (.tex)
                </button>
                <button className="sm" disabled={!content} onClick={copyMarkdown} title="The lesson as Markdown, for your own notes">
                  Copy as Markdown
                </button>
              </div>
            </details>
            <button
              className="sm"
              disabled={busy}
              title="Write a new version of this level's lesson"
              onClick={() => {
                if (!content || window.confirm("Write a new version of this lesson? The current one will be replaced.")) load(true);
              }}
            >
              Regenerate
            </button>
          </div>
          <div className="reader-progress" aria-hidden="true">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        </header>
        <div className="reader-body" ref={bodyRef} onScroll={onScroll}>
          {toc.length > 2 && (
            <nav className="reader-toc" aria-label="Lesson contents">
              <div className="small muted">On this page</div>
              {toc.map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className={active === t.id ? "on" : ""}
                  onClick={(e) => {
                    e.preventDefault();
                    jump(t.id);
                  }}
                >
                  {t.text}
                </a>
              ))}
            </nav>
          )}
          <article className="reader-article" ref={articleRef}>
            {error && (
              <div className="alert error" style={{ whiteSpace: "pre-wrap" }}>
                {error}{" "}
                {!content && (
                  <button className="sm" onClick={() => load()}>
                    Try again
                  </button>
                )}
              </div>
            )}
            {content === null && !error ? (
              <p className="muted">
                <Busy label={`Preparing the level ${depth} lesson…`} hint="usually under a minute" />
              </p>
            ) : (
              content && (
                <>
                  <Markdown>{content}</Markdown>
                  <div className="reader-finish">
                    {done >= depth ? (
                      <span className="badge know">✓ Level {depth} finished</span>
                    ) : (
                      <button className="primary" onClick={finish}>
                        ✓ I&apos;ve finished level {depth}
                      </button>
                    )}
                    {depth < 4 && (
                      <button onClick={() => setDepth(depth + 1)}>
                        Next: level {depth + 1} · {DEPTH_LEVELS[depth].name} →
                      </button>
                    )}
                  </div>
                </>
              )
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
