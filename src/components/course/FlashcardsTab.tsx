"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, localToday } from "../api";
import { Markdown } from "../Markdown";
import { Busy } from "../Busy";
import { ScopePicker, type ScopeValue } from "./ScopePicker";
import { describeInterval, nextDueIn, NEW_CARD, RATING_LABELS, review, type Rating } from "@/lib/srs";
import type { Card, CardStats } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

interface CardsResponse {
  stats: CardStats;
  cards: Card[];
}

export function FlashcardsTab({ data, active }: { data: CourseData; active: boolean }) {
  const id = data.course.id;
  const [stats, setStats] = useState<CardStats | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [scope, setScope] = useState<ScopeValue>({ kind: "course" });
  const [count, setCount] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<CardsResponse>(`/api/courses/${id}/cards?today=${localToday()}`)
        .then((r) => (setStats(r.stats), setCards(r.cards)))
        .catch((e) => setError(e.message)),
    [id],
  );
  // Reload whenever the tab is shown: exams and the plan can add or schedule cards meanwhile.
  useEffect(() => {
    if (active) load();
  }, [load, active]);

  async function generate() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await api<{ added: number; stats: CardStats }>(`/api/courses/${id}/cards`, { method: "POST", json: { scope, count, today: localToday() } });
      setInfo(r.added ? `Added ${r.added} new card${r.added === 1 ? "" : "s"}.` : "No new cards: the ones generated match cards you already have.");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startReview() {
    setError(null);
    try {
      const r = await api<CardsResponse>(`/api/courses/${id}/cards?due=1&today=${localToday()}`);
      setQueue(r.cards);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (queue) return <Review queue={queue} examDate={data.course.exam_date} onDone={() => (setQueue(null), load())} />;

  const ready = (stats?.due ?? 0) + Math.min(20, stats?.fresh ?? 0);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card stack">
        <div className="spread">
          <div>
            <h2 style={{ margin: 0 }}>Flashcards</h2>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              Spaced repetition: each card comes back just before you would forget it, and every card is seen again before your exam.
            </p>
          </div>
          <button className="primary" disabled={!ready} onClick={startReview}>
            {ready ? `Review now (${ready})` : "Nothing due today"}
          </button>
        </div>
        {stats && stats.total > 0 && (
          <div className="row small">
            <span className="badge dont_know">{stats.due} due</span>
            <span className="badge">{stats.fresh} new</span>
            <span className="badge know">{stats.learned} learned</span>
            <span className="muted">{stats.total} cards. Up to 20 new cards are introduced per day.</span>
          </div>
        )}
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Make cards</h3>
        <div className="row">
          <ScopePicker tree={data.tree} value={scope} onChange={setScope} />
          <label className="field">
            How many
            <input type="number" min={5} max={60} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 80 }} />
          </label>
          <button className="primary" style={{ alignSelf: "flex-end" }} onClick={generate} disabled={busy || !data.tree.length}>
            {busy ? <Busy label="Writing cards…" hint="usually under a minute" /> : "Generate cards"}
          </button>
        </div>
        {!data.tree.length && <div className="alert">Build the brainmap first.</div>}
        <p className="small muted" style={{ margin: 0 }}>
          Tip: after a mock exam, use &quot;Make flashcards from my mistakes&quot; to turn every wrong answer into a card.
        </p>
        <AddCard courseId={id} onAdded={load} />
        {info && <div className="alert info">{info}</div>}
        {error && <div className="alert error">{error}</div>}
      </div>

      {cards && cards.length > 0 && <CardList cards={cards} onChange={load} />}
    </div>
  );
}

function AddCard({ courseId, onAdded }: { courseId: string; onAdded: () => void }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setError(null);
    try {
      await api(`/api/courses/${courseId}/cards`, { method: "POST", json: { front, back } });
      setFront("");
      setBack("");
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>Write your own card</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <textarea aria-label="Front" placeholder="Front: a question or cue" value={front} onChange={(e) => setFront(e.target.value)} style={{ minHeight: 60 }} />
        <textarea aria-label="Back" placeholder="Back: the answer (Markdown and $maths$ work)" value={back} onChange={(e) => setBack(e.target.value)} style={{ minHeight: 60 }} />
        <div className="row">
          <button className="sm primary" disabled={!front.trim() || !back.trim()} onClick={add}>
            Add card
          </button>
          {error && <span className="small" style={{ color: "var(--dont)" }}>{error}</span>}
        </div>
      </div>
    </details>
  );
}

function Review({ queue: initial, examDate, onDone }: { queue: Card[]; examDate: string | null; onDone: () => void }) {
  const [queue, setQueue] = useState(initial);
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [again, setAgain] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const card = queue[0];
  const today = localToday();
  const daysToExam = examDate ? Math.round((Date.parse(examDate) - Date.parse(today)) / 86400000) : null;

  const previews = useMemo(() => {
    if (!card) return null;
    const state = card.due == null ? NEW_CARD : card;
    return ([1, 2, 3, 4] as Rating[]).map((r) => describeInterval(nextDueIn(review(state, r), daysToExam)));
  }, [card, daysToExam]);

  const rate = useCallback(
    async (rating: Rating) => {
      if (!card) return;
      setError(null);
      try {
        const updated = await api<Card>(`/api/cards/${card.id}`, { method: "PATCH", json: { rating, today } });
        setReviewed((n) => n + 1);
        // Forgotten cards come back at the end of this session until they stick.
        if (rating === 1) setAgain((n) => n + 1);
        setQueue((q) => (rating === 1 ? [...q.slice(1), updated] : q.slice(1)));
        setShown(false);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [card, today],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!shown && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        rate(Number(e.key) as Rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, rate]);

  return (
    <div className="stack" style={{ gap: 12, maxWidth: 760, margin: "0 auto" }}>
      <div className="spread">
        <button className="ghost sm" onClick={onDone}>
          ← Done
        </button>
        <span className="small muted" role="status">
          {reviewed} reviewed · {queue.length} left
        </span>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!card ? (
        <div className="card empty">
          <h2>All done for today 🎉</h2>
          <p>
            You reviewed {reviewed} card{reviewed === 1 ? "" : "s"}
            {again ? `, and went over ${again} again until it stuck` : ""}. Come back tomorrow for the next batch.
          </p>
          <button className="primary" onClick={onDone}>
            Back to flashcards
          </button>
        </div>
      ) : (
        <div className="card flashcard">
          <div className="small muted spread">
            <span>{card.topic_title ?? "General"}</span>
            <span>{card.due == null ? "New" : card.lapses ? `Forgotten ${card.lapses}×` : `Every ${describeInterval(card.interval)}`}</span>
          </div>
          <Markdown>{card.front}</Markdown>
          {shown ? (
            <>
              <hr />
              <Markdown>{card.back}</Markdown>
              <div className="row rate" style={{ justifyContent: "center" }}>
                {([1, 2, 3, 4] as Rating[]).map((r, i) => (
                  <button key={r} className={`rate-${r}`} onClick={() => rate(r)}>
                    <strong>{RATING_LABELS[r]}</strong>
                    <span className="small">{previews?.[i]}</span>
                  </button>
                ))}
              </div>
              <p className="small muted" style={{ textAlign: "center", margin: 0 }}>
                Keys 1-4. Be honest: &quot;Again&quot; if you couldn&apos;t recall it, &quot;Hard&quot; if it took real effort.
              </p>
            </>
          ) : (
            <button className="primary" style={{ alignSelf: "center" }} onClick={() => setShown(true)}>
              Show answer <span className="small">(Space)</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CardList({ cards, onChange }: { cards: Card[]; onChange: () => void }) {
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? cards.filter((c) => `${c.front} ${c.back} ${c.topic_title ?? ""}`.toLowerCase().includes(f)) : cards;
  }, [cards, filter]);
  return (
    <div className="card stack">
      <div className="spread">
        <h3 style={{ margin: 0 }}>All cards</h3>
        <input aria-label="Filter cards" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 240 }} />
      </div>
      <div className="list">
        {shown.slice(0, 300).map((c) =>
          editing === c.id ? (
            <EditCard key={c.id} card={c} onClose={() => (setEditing(null), onChange())} />
          ) : (
            <div key={c.id} className="list-item spread" style={{ alignItems: "flex-start" }}>
              <details style={{ flex: 1, minWidth: 0 }}>
                <summary style={{ cursor: "pointer" }}>
                  <span className="small muted">{c.topic_title ?? "General"} · </span>
                  {c.front.split("\n")[0].replace(/[*_`$#>]/g, "").slice(0, 140)}
                </summary>
                <Markdown>{c.back}</Markdown>
              </details>
              <div className="row" style={{ flexShrink: 0 }}>
                <span className="small muted">{c.due == null ? "new" : `due ${c.due}`}</span>
                <button className="sm ghost" onClick={() => setEditing(c.id)}>
                  Edit
                </button>
                <button
                  className="sm ghost danger"
                  aria-label="Delete card"
                  onClick={async () => {
                    await api(`/api/cards/${c.id}`, { method: "DELETE" });
                    onChange();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ),
        )}
      </div>
      {shown.length > 300 && <p className="small muted">Showing 300 of {shown.length}. Use the filter to find others.</p>}
    </div>
  );
}

function EditCard({ card, onClose }: { card: Card; onClose: () => void }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  return (
    <div className="list-item stack">
      <textarea aria-label="Front" value={front} onChange={(e) => setFront(e.target.value)} style={{ minHeight: 60 }} />
      <textarea aria-label="Back" value={back} onChange={(e) => setBack(e.target.value)} style={{ minHeight: 60 }} />
      <div className="row">
        <button
          className="sm primary"
          onClick={async () => {
            await api(`/api/cards/${card.id}`, { method: "PATCH", json: { front, back } });
            onClose();
          }}
        >
          Save
        </button>
        <button className="sm ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
