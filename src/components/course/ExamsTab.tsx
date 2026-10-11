"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { ScopePicker, type ScopeValue } from "./ScopePicker";
import type { Exam } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

export function ExamsTab({ data, reload }: { data: CourseData; reload: () => void }) {
  const id = data.course.id;
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [active, setActive] = useState<Exam | null>(null);
  const [scope, setScope] = useState<ScopeValue>({ kind: "course" });
  const [cfg, setCfg] = useState({ questionCount: 10, durationMinutes: 45, mcq: 5, short: 3, long: 2 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<Exam[]>(`/api/courses/${id}/exams`).then(setExams).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const e = await api<Exam>(`/api/courses/${id}/exams`, {
        method: "POST",
        json: { scope, questionCount: cfg.questionCount, durationMinutes: cfg.durationMinutes, mix: { mcq: cfg.mcq, short: cfg.short, long: cfg.long } },
      });
      setActive(e);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (active) return <ExamRunner exam={active} onBack={() => (setActive(null), load(), reload())} />;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card stack">
        <h2>Create a mock exam</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Questions focus on what you marked as not known yet. If you uploaded sample exams, the mock exam follows their style.
        </p>
        <div className="row">
          <ScopePicker tree={data.tree} value={scope} onChange={setScope} />
          <label className="field">
            Questions
            <input type="number" min={1} max={40} value={cfg.questionCount} onChange={(e) => setCfg({ ...cfg, questionCount: Number(e.target.value) })} style={{ width: 80 }} />
          </label>
          <label className="field">
            Minutes
            <input type="number" min={5} max={240} value={cfg.durationMinutes} onChange={(e) => setCfg({ ...cfg, durationMinutes: Number(e.target.value) })} style={{ width: 80 }} />
          </label>
          <label className="field">
            Multiple choice
            <input type="range" min={0} max={10} value={cfg.mcq} onChange={(e) => setCfg({ ...cfg, mcq: Number(e.target.value) })} />
          </label>
          <label className="field">
            Short answer
            <input type="range" min={0} max={10} value={cfg.short} onChange={(e) => setCfg({ ...cfg, short: Number(e.target.value) })} />
          </label>
          <label className="field">
            Long answer
            <input type="range" min={0} max={10} value={cfg.long} onChange={(e) => setCfg({ ...cfg, long: Number(e.target.value) })} />
          </label>
          <button className="primary" style={{ alignSelf: "flex-end" }} onClick={create} disabled={busy || !data.tree.length}>
            {busy && <span className="spinner" />} {busy ? "Writing questions…" : "Generate exam"}
          </button>
        </div>
        {!data.tree.length && <div className="alert">Build the brainmap first.</div>}
        {error && <div className="alert error">{error}</div>}
      </div>

      <div className="card">
        <h2>Your mock exams</h2>
        {!exams?.length ? (
          <p className="muted">None yet.</p>
        ) : (
          <div className="list">
            {exams.map((e) => {
              const score = e.grades?.reduce((s, g) => s + g.score, 0);
              const max = e.questions.reduce((s, q) => s + q.marks, 0);
              return (
                <div key={e.id} className="list-item spread">
                  <div>
                    <strong>{e.title}</strong>
                    <div className="small muted">
                      {e.questions.length} questions · {e.duration_minutes} min · {e.created_at.slice(0, 16).replace("T", " ")}
                      {e.generated_by === "heuristic" && " · offline"}
                    </div>
                  </div>
                  <div className="row">
                    {score !== undefined && (
                      <span className={`badge ${score / max >= 0.8 ? "know" : score / max >= 0.5 ? "familiar" : "dont_know"}`}>
                        {score}/{max} ({Math.round((score / max) * 100)}%)
                      </span>
                    )}
                    <button className="sm" onClick={() => setActive(e)}>
                      {e.grades ? "Review" : "Start"}
                    </button>
                    <button
                      className="sm danger"
                      onClick={async () => {
                        await api(`/api/exams/${e.id}`, { method: "DELETE" });
                        load();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ExamRunner({ exam: initial, onBack }: { exam: Exam; onBack: () => void }) {
  const [exam, setExam] = useState(initial);
  const [answers, setAnswers] = useState<Record<string, string>>(initial.answers ?? {});
  const [selfMarks, setSelfMarks] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [left, setLeft] = useState(initial.duration_minutes * 60);
  const graded = !!exam.grades;
  const grade = (qid: string) => exam.grades?.find((g) => g.question_id === qid);

  useEffect(() => {
    if (graded) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [graded]);

  async function submit(withSelf = false) {
    setBusy(true);
    setError(null);
    try {
      setExam(await api<Exam>(`/api/exams/${exam.id}`, { method: "POST", json: { answers, selfMarks: withSelf ? selfMarks : undefined } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyMarks() {
    const r = await api<{ updated: unknown[] }>(`/api/exams/${exam.id}/apply`, { method: "POST" });
    setApplied(`Updated marks on ${r.updated.length} topic${r.updated.length === 1 ? "" : "s"}. Rebuild your study plan to reflect them.`);
  }

  const score = exam.grades?.reduce((s, g) => s + g.score, 0) ?? 0;
  const max = exam.questions.reduce((s, q) => s + q.marks, 0);
  const needsSelf = exam.grades?.some((g) => g.feedback.startsWith("Needs marking"));

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="spread card" style={{ position: "sticky", top: 58, zIndex: 5 }}>
        <div>
          <button className="ghost sm" onClick={onBack}>
            ← Back
          </button>
          <strong>{exam.title}</strong>
        </div>
        {graded ? (
          <div className="row">
            <span className={`badge ${score / max >= 0.8 ? "know" : score / max >= 0.5 ? "familiar" : "dont_know"}`}>
              Score {score}/{max} ({Math.round((score / max) * 100)}%)
            </span>
            <button className="sm" onClick={applyMarks}>
              Update my brainmap marks
            </button>
          </div>
        ) : (
          <div className="row">
            <span className={`badge ${left < 300 ? "dont_know" : ""}`}>
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
            </span>
            <button className="primary" disabled={busy} onClick={() => submit()}>
              {busy && <span className="spinner" />} Submit for marking
            </button>
          </div>
        )}
      </div>
      {applied && <div className="alert info">{applied}</div>}
      {error && <div className="alert error">{error}</div>}

      {exam.questions.map((q, i) => {
        const g = grade(q.id);
        return (
          <div key={q.id} className="question">
            <div className="spread small muted">
              <span>
                Q{i + 1} · {q.type === "mcq" ? "Multiple choice" : q.type === "short" ? "Short answer" : "Long answer"} · {q.topic_title}
              </span>
              <span>
                {g ? `${g.score}/` : ""}
                {q.marks} mark{q.marks > 1 ? "s" : ""}
              </span>
            </div>
            <Markdown>{q.prompt}</Markdown>
            {q.type === "mcq" ? (
              <div>
                {q.options.map((o, oi) => {
                  const chosen = answers[q.id] === String(oi);
                  const cls = graded ? (oi === q.answer_index ? "correct" : chosen ? "wrong" : "") : "";
                  return (
                    <label key={oi} className={`option ${cls}`}>
                      <input type="radio" name={q.id} disabled={graded} checked={chosen} onChange={() => setAnswers({ ...answers, [q.id]: String(oi) })} />
                      <span>
                        <strong>{String.fromCharCode(65 + oi)}.</strong> {o}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <textarea
                disabled={graded}
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                style={{ minHeight: q.type === "long" ? 200 : 90 }}
                placeholder="Your answer…"
              />
            )}
            {g && (
              <div className="stack" style={{ marginTop: 8 }}>
                <div className={`alert ${g.score >= g.max * 0.8 ? "info" : g.score >= g.max * 0.5 ? "" : "error"}`}>{g.feedback}</div>
                {q.type !== "mcq" && (
                  <details>
                    <summary className="small" style={{ cursor: "pointer" }}>
                      Model answer
                    </summary>
                    <Markdown>{q.model_answer}</Markdown>
                  </details>
                )}
                {g.feedback.startsWith("Needs marking") && (
                  <label className="small row">
                    Your mark:
                    <input type="number" min={0} max={q.marks} value={selfMarks[q.id] ?? ""} onChange={(e) => setSelfMarks({ ...selfMarks, [q.id]: Number(e.target.value) })} style={{ width: 70 }} />/ {q.marks}
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
      {needsSelf && (
        <button className="primary" onClick={() => submit(true)} disabled={busy}>
          Save my marks
        </button>
      )}
    </div>
  );
}
