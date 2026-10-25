"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../Markdown";
import { answer, nextQuestion, progress, startLearn, type LearnQuestion } from "@/lib/learn";
import { cardFront, markTyped, topicGivesAway } from "@/lib/cardView";
import type { Card } from "@/lib/types";

type Result = { right: boolean; picked: string; close?: boolean };

/** Quizlet-style Learn: multiple choice, then typing, until every card in the set is mastered. */
export function Learn({ cards, onDone }: { cards: Card[]; onDone: () => void }) {
  const [state, setState] = useState(() => startLearn(cards));
  const [q, setQ] = useState<LearnQuestion | null>(() => nextQuestion(state));
  const [result, setResult] = useState<Result | null>(null);
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const p = progress(state);
  const card = useMemo(() => cards.find((c) => c.id === q?.id) ?? null, [cards, q]);

  useEffect(() => {
    if (q?.mode === "typed" && !result) input.current?.focus();
  }, [q, result]);

  function check(picked: string, right: boolean, close = false) {
    if (!q || result) return;
    setResult({ right, picked, close });
  }

  function next(overrideRight?: boolean) {
    if (!q || !result) return;
    const s = answer(state, q, overrideRight ?? result.right);
    setState(s);
    setQ(nextQuestion(s));
    setResult(null);
    setTyped("");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (result && (e.key === "Enter" || (e.key === " " && (e.target as HTMLElement).tagName !== "INPUT"))) {
        e.preventDefault();
        next();
      } else if (!result && q?.mode === "choice" && /^[1-4]$/.test(e.key)) {
        const o = q.options[Number(e.key) - 1];
        if (o !== undefined) check(o, o === q.answer);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="stack" style={{ gap: 12, maxWidth: 760, margin: "0 auto" }}>
      <div className="spread">
        <button className="ghost sm" onClick={onDone}>
          ← Done
        </button>
        <span className="small muted" role="status">
          {p.mastered} of {p.total} mastered · {p.familiar} on the way
        </span>
      </div>
      <div className="learn-bar" aria-hidden>
        <span style={{ width: `${(100 * p.mastered) / Math.max(1, p.total)}%` }} className="m" />
        <span style={{ width: `${(100 * p.familiar) / Math.max(1, p.total)}%` }} className="f" />
      </div>
      {!q || !card ? (
        <div className="card empty">
          <h2>You know all {p.total} 🎉</h2>
          <p>
            {state.asked} questions, {state.right} right first go or after a retry. Your review schedule is unchanged; the cards still come back when they&apos;re due.
          </p>
          <button className="primary" onClick={onDone}>
            Back to flashcards
          </button>
        </div>
      ) : (
        <div className="card flashcard">
          <div className="small muted spread">
            <span>{!topicGivesAway(card) || result ? (card.topic_title ?? "General") : "Topic hidden until you answer"}</span>
            <span>{q.mode === "choice" ? "Pick the answer" : "Type the answer"}</span>
          </div>
          <Markdown>{cardFront(card, !!result)}</Markdown>
          {q.mode === "choice" ? (
            <div className="learn-options">
              {q.options.map((o, i) => {
                const cls = result ? (o === q.answer ? "right" : o === result.picked ? "wrong" : "") : "";
                return (
                  <button key={o} className={`learn-option ${cls}`} disabled={!!result} onClick={() => check(o, o === q.answer)}>
                    <span className="small muted">{i + 1}</span>
                    <Markdown>{o}</Markdown>
                  </button>
                );
              })}
            </div>
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (result) return next();
                const mark = markTyped(typed, q.answer);
                check(typed, mark !== "wrong", mark === "close");
              }}
            >
              <input ref={input} aria-label="Your answer" className="grow" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!!result} autoComplete="off" autoCapitalize="off" spellCheck={false} />
              {!result && (
                <>
                  <button type="submit" className="primary" disabled={!typed.trim()}>
                    Check
                  </button>
                  <button type="button" className="ghost" onClick={() => check("", false)}>
                    Don&apos;t know
                  </button>
                </>
              )}
            </form>
          )}
          {result && (
            <div className={`alert ${result.right ? "success" : "error"} stack`} style={{ gap: 6 }}>
              <strong>{result.right ? (result.close ? `Right, but check the spelling: ${q.answer}` : "Right!") : "Not quite."}</strong>
              {!result.right && q.mode === "typed" && (
                <span>
                  The answer is <strong>{q.answer}</strong>.
                </span>
              )}
              {card.back.trim() && card.kind !== "cloze" && q.mode === "typed" && <Markdown>{card.back}</Markdown>}
              <div className="row">
                <button className="primary" onClick={() => next()}>
                  Continue <span className="small">(Enter)</span>
                </button>
                {/* Typed answers are compared as text; the student knows when they meant the same thing. */}
                {!result.right && q.mode === "typed" && result.picked.trim() && (
                  <button className="ghost" onClick={() => next(true)}>
                    I was right
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
