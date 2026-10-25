"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Busy } from "../Busy";
import type { ChatMessage, Citation } from "@/lib/ask";
import type { CourseData } from "./CourseWorkspace";

/** "[2]" markers become links to the passage, shown under the answer when clicked. Maths is left alone. */
function linkCitations(text: string): string {
  return text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\[(\d+)\]/g, (all, n: string | undefined) => (n ? `[${n}](#cite-${n})` : all));
}

export function AskTab({ data }: { data: CourseData }) {
  const id = data.course.id;
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<ChatMessage[]>(`/api/courses/${id}/chat`)
      .then(setMessages)
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [messages, pending]);

  async function ask(q = question) {
    const text = q.trim();
    if (!text || pending) return;
    setPending(text);
    setQuestion("");
    setError(null);
    try {
      const r = await api<{ question: ChatMessage; answer: ChatMessage }>(`/api/courses/${id}/chat`, { method: "POST", json: { question: text } });
      setMessages((m) => [...(m ?? []), r.question, r.answer]);
    } catch (e) {
      setError((e as Error).message);
      setQuestion(text); // give the question back to edit or resend
    } finally {
      setPending(null);
    }
  }

  async function clear() {
    if (!window.confirm("Clear this conversation?")) return;
    await api(`/api/courses/${id}/chat`, { method: "DELETE" });
    setMessages([]);
  }

  // A few questions to start from, made from the course's first topics.
  const starters = useMemo(() => {
    const topics = data.tree.flatMap((t) => [t, ...t.children]).filter((t) => t.title.length < 60);
    const out: string[] = [];
    if (topics[0]) out.push(`What is ${topics[0].title}?`);
    if (topics[1]) out.push(`Why does ${topics[1].title} matter?`);
    if (topics[2] && topics[3]) out.push(`How are ${topics[2].title} and ${topics[3].title} related?`);
    return out;
  }, [data.tree]);

  const noMaterials = data.materials.length === 0;
  return (
    <div className="stack ask" style={{ gap: 14, maxWidth: 860 }}>
      <div className="card stack">
        <div className="spread">
          <div>
            <h2 style={{ margin: 0 }}>Ask this course</h2>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              Questions are answered from your own materials. Every numbered mark links to the passage it came from, so you can check it.
            </p>
          </div>
          {messages && messages.length > 0 && (
            <button className="sm ghost" onClick={clear}>
              Clear conversation
            </button>
          )}
        </div>
        {noMaterials && <div className="alert">Add materials first: answers come only from what this course contains.</div>}
      </div>

      {messages?.map((m) => (m.role === "user" ? <div key={m.id} className="ask-q">{m.content}</div> : <Answer key={m.id} message={m} data={data} />))}
      {pending && (
        <>
          <div className="ask-q">{pending}</div>
          <div className="card">
            <Busy label="Looking through your materials…" hint="usually a few seconds" />
          </div>
        </>
      )}
      {messages && !messages.length && !pending && starters.length > 0 && (
        <div className="row">
          {starters.map((s) => (
            <button key={s} className="sm ghost" onClick={() => ask(s)} disabled={noMaterials}>
              {s}
            </button>
          ))}
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <div ref={end} />

      <form
        className="card row ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <textarea
          aria-label="Your question"
          placeholder="Ask about anything in this course…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask();
            }
          }}
          rows={2}
          className="grow"
        />
        <button className="primary" type="submit" disabled={!question.trim() || !!pending || noMaterials}>
          Ask
        </button>
      </form>
    </div>
  );
}

function Answer({ message, data }: { message: ChatMessage; data: CourseData }) {
  const [open, setOpen] = useState<number | null>(null);
  const files = useMemo(() => new Map(data.materials.map((m) => [m.id, m])), [data.materials]);
  const shown = message.citations.find((c) => c.n === open) ?? null;
  return (
    <div
      className="card stack ask-a"
      onClick={(e) => {
        // Clicking a [n] in the answer opens that passage.
        const a = (e.target as HTMLElement).closest("a");
        const n = a?.getAttribute("href")?.match(/^#cite-(\d+)$/)?.[1];
        if (n) {
          e.preventDefault();
          setOpen((o) => (o === Number(n) ? null : Number(n)));
        }
      }}
    >
      <Markdown>{linkCitations(message.content)}</Markdown>
      {message.citations.length > 0 && (
        <div className="row small" style={{ gap: 6 }}>
          <span className="muted">Sources:</span>
          {message.citations.map((c) => (
            <button key={c.n} className={`sm cite-chip ${open === c.n ? "on" : ""}`} onClick={() => setOpen((o) => (o === c.n ? null : c.n))} title={c.title}>
              [{c.n}] {c.title.length > 40 ? `${c.title.slice(0, 39)}…` : c.title}
            </button>
          ))}
        </div>
      )}
      {shown && <Passage c={shown} hasFile={!!files.get(shown.material_id)?.path} />}
      {message.generated_by === "heuristic" && message.citations.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          No AI is connected, so this is the passages&apos; closest sentences rather than a written answer. Connect one in Settings for full answers.
        </p>
      )}
    </div>
  );
}

function Passage({ c, hasFile }: { c: Citation; hasFile: boolean }) {
  return (
    <blockquote className="passage">
      <div className="spread small">
        <strong>
          [{c.n}] {c.title}
        </strong>
        {hasFile && (
          <a href={`/api/materials/${c.material_id}/file`} target="_blank" rel="noreferrer">
            Open the file
          </a>
        )}
      </div>
      <div className="passage-text">{c.text}</div>
    </blockquote>
  );
}
