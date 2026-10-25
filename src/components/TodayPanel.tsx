"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, localToday } from "./api";
import type { TodayCourse } from "@/lib/store";

const KIND: Record<string, string> = {
  overview: "Overview",
  synthesis: "Synthesis",
  diagnostic: "Quick check",
  recall: "Recall",
  checkpoint: "Checkpoint",
  final: "Exam prep",
};

/** What every course asks of the student today: the plan's sessions, overdue ones and flashcards. */
export function TodayPanel() {
  const [rows, setRows] = useState<TodayCourse[] | null>(null);
  useEffect(() => {
    api<TodayCourse[]>(`/api/today?today=${localToday()}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  if (!rows?.length) return null;
  const minutes = rows.reduce((n, r) => n + r.sessions.reduce((m, s) => m + s.minutes, 0), 0);
  return (
    <section className="card stack" aria-labelledby="today-h">
      <div className="spread">
        <h2 id="today-h" style={{ margin: 0 }}>
          Today
        </h2>
        {minutes > 0 && <span className="muted small">about {minutes >= 90 ? `${Math.round(minutes / 6) / 10} h` : `${minutes} min`} of study planned</span>}
      </div>
      {rows.map((r) => (
        <div key={r.course.id} className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <Link href={`/courses/${r.course.id}#plan`}>
              <strong>{r.course.name}</strong>
            </Link>
            {r.examInDays !== null && r.examInDays >= 0 && (
              <span className={`badge ${r.examInDays <= 7 ? "dont_know" : ""}`}>{r.examInDays === 0 ? "Exam today" : `Exam in ${r.examInDays} day${r.examInDays === 1 ? "" : "s"}`}</span>
            )}
          </div>
          {r.sessions.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {r.sessions.slice(0, 6).map((s) => (
                <li key={s.id}>
                  {KIND[s.kind] ? <span className="badge accent">{KIND[s.kind]}</span> : <span className="muted">Level {s.depth}</span>} {s.topic_title}{" "}
                  <span className="muted">· {s.minutes} min</span>
                </li>
              ))}
              {r.sessions.length > 6 && <li className="muted">and {r.sessions.length - 6} more</li>}
            </ul>
          )}
          <div className="row small" style={{ gap: 12 }}>
            {r.cards > 0 && (
              <Link href={`/courses/${r.course.id}#cards`}>
                {r.cards} flashcard{r.cards === 1 ? "" : "s"} to review
              </Link>
            )}
            {r.overdue > 0 && (
              <Link href={`/courses/${r.course.id}#plan`} className="muted">
                {r.overdue} session{r.overdue === 1 ? "" : "s"} from earlier days not ticked off: rebuild the plan from today to fit them in
              </Link>
            )}
            {!r.sessions.length && !r.cards && !r.overdue && <span className="muted">Nothing planned today.</span>}
          </div>
        </div>
      ))}
    </section>
  );
}
