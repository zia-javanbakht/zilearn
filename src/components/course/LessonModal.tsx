"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Busy } from "../Busy";
import { downloadExport, printElement, saveBlob } from "../texExport";
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
  const deepenRef = useRef<HTMLDetailsElement>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const [ask, setAsk] = useState("");
  const [deepening, setDeepening] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
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

  function flash(text: string, ms = 2500) {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), ms);
  }

  /** Download the printable version made with the Z class: the LaTeX source, or a PDF compiled here. */
  async function download(format: "tex" | "pdf") {
    exportRef.current?.removeAttribute("open");
    setPrinting(format);
    setError(null);
    try {
      const note = await downloadExport(`/api/topics/${topicId}/lesson/print?depth=${depth}`, format);
      if (note) flash(note, 9000);
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
      saveBlob(new Blob([content], { type: "text/markdown" }), `${slug()}.md`);
    }
  }

  useEffect(() => {
    api<{ ai: boolean }>("/api/status")
      .then((r) => setAi(r.ai))
      .catch(() => setAi(false));
  }, []);

  /** The AI tutor's final enrichment, on request: deepens what the lesson states without explaining. */
  async function deepen() {
    deepenRef.current?.removeAttribute("open");
    const req = reqRef.current;
    setDeepening(true);
    setError(null);
    try {
      const r = await api<{ content: string; changes: string[] }>(`/api/topics/${topicId}/lesson/enrich`, { method: "POST", json: { depth, request: ask } });
      if (req !== reqRef.current) return;
      setContent(r.content);
      setAdded(r.changes);
      setAsk("");
      flash(r.changes.length ? `Deepened in ${r.changes.length} place${r.changes.length === 1 ? "" : "s"}` : "Nothing to deepen at this level");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeepening(false);
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
    setAdded([]);
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
            <details className="menu" ref={deepenRef}>
              <summary
                className="btn sm"
                aria-disabled={!content || busy || deepening || ai === false}
                title={ai === false ? "Needs an AI provider: choose one in Settings" : "Ask the AI tutor to deepen this lesson at its level"}
              >
                {deepening ? <Busy label="Deepening…" /> : "✨ Deepen"}
              </summary>
              <div className="menu-list deepen-menu">
                {ai === false ? (
                  <p className="small muted" style={{ margin: 0 }}>
                    Deepening needs an AI provider. <a href="/settings">Choose one in Settings</a>.
                  </p>
                ) : (
                  <form
                    className="stack"
                    style={{ gap: 6 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      deepen();
                    }}
                  >
                    <label className="small muted" htmlFor="deepen-ask">
                      What should go deeper? Leave empty and the tutor picks the places that explain least.
                    </label>
                    <textarea id="deepen-ask" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. why the decay is exponential" rows={3} maxLength={500} />
                    <button className="sm primary" type="submit" disabled={!content || busy || deepening}>
                      Deepen this lesson
                    </button>
                  </form>
                )}
              </div>
            </details>
            <details className="menu" ref={exportRef}>
              <summary className="btn sm" aria-disabled={!content || busy}>
                {printing === "pdf" ? "Making the PDF…" : printing === "tex" ? "Making the LaTeX…" : "Export ▾"}
              </summary>
              <div className="menu-list">
                <button className="sm" disabled={!content || !!printing || busy} onClick={() => download("pdf")} title="Compile a printable PDF with LaTeX on this computer, using your Z class when ziLearn finds it">
                  Print (PDF)
                </button>
                <button className="sm" disabled={!content || !!printing || busy} onClick={() => download("tex")} title="The lesson as a LaTeX file that uses the Z class">
                  LaTeX (.tex)
                </button>
                <button className="sm" disabled={!content} onClick={copyMarkdown} title="The lesson as Markdown, for your own notes">
                  Copy as Markdown
                </button>
                <button
                  className="sm"
                  disabled={!content}
                  title="Print the lesson as it looks here; choose Save as PDF in the print dialog (no TeX needed)"
                  onClick={() => {
                    exportRef.current?.removeAttribute("open");
                    if (articleRef.current) printElement(articleRef.current, `${title} (level ${depth})`);
                  }}
                >
                  Print from browser
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
                  {added.length > 0 && (
                    <div className="alert info small" role="status">
                      <strong>Deepened:</strong>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {added.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
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
