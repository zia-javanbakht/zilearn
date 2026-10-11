"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { Busy } from "../Busy";
import { ScopePicker, type ScopeValue } from "./ScopePicker";
import type { Exam, ExamGrade, ExamQuestion } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

export function ExamsTab({ data, reload, openExamId, onPlan }: { data: CourseData; reload: () => void; openExamId?: string | null; onPlan: () => void }) {
  const id = data.course.id;
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [active, setActive] = useState<Exam | null>(null);
  useEffect(() => {
    if (openExamId) api<Exam>(`/api/exams/${openExamId}`).then(setActive).catch(() => {});
  }, [openExamId]);
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

  if (active) return <ExamRunner exam={active} courseId={id} onBack={() => (setActive(null), load(), reload())} onPlan={() => (reload(), onPlan())} />;

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
            {busy ? <Busy label="Writing questions…" /> : "Generate exam"}
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

const draftKey = (id: string) => `zilearn:exam-draft:${id}`;

function readDraft(id: string): { answers: Record<string, string>; deadline: number } | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function ExamRunner({ exam: initial, courseId, onBack, onPlan }: { exam: Exam; courseId: string; onBack: () => void; onPlan: () => void }) {
  const [exam, setExam] = useState(initial);
  const graded = !!exam.grades;
  // Unsubmitted answers and the deadline survive a refresh or leaving the page.
  const [draft] = useState(() => (initial.grades ? null : readDraft(initial.id)));
  const [answers, setAnswers] = useState<Record<string, string>>(initial.answers ?? draft?.answers ?? {});
  const [deadline] = useState(() => draft?.deadline ?? Date.now() + initial.duration_minutes * 60_000);
  const [selfMarks, setSelfMarks] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [cardsMsg, setCardsMsg] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const answered = Object.values(answers).some((a) => a.trim());

  useEffect(() => {
    if (graded) return;
    try {
      localStorage.setItem(draftKey(exam.id), JSON.stringify({ answers, deadline }));
    } catch {}
  }, [answers, deadline, exam.id, graded]);

  useEffect(() => {
    if (graded || !answered) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [graded, answered]);

  const setAnswer = useCallback((qid: string, v: string) => setAnswers((a) => ({ ...a, [qid]: v })), []);
  const setSelf = useCallback((qid: string, v: number) => setSelfMarks((m) => ({ ...m, [qid]: v })), []);

  async function submit(withSelf = false) {
    setBusy(true);
    setError(null);
    try {
      setExam(await api<Exam>(`/api/exams/${exam.id}`, { method: "POST", json: { answers, selfMarks: withSelf ? selfMarks : undefined } }));
      try {
        localStorage.removeItem(draftKey(exam.id));
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function back() {
    if (!graded && answered && !confirm("Leave this exam? Your answers are kept on this device and you can come back to finish.")) return;
    onBack();
  }

  async function applyMarks() {
    try {
      const r = await api<{ updated: unknown[] }>(`/api/exams/${exam.id}/apply`, { method: "POST" });
      setApplied(`Updated marks on ${r.updated.length} topic${r.updated.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function mistakesToCards() {
    try {
      const r = await api<{ added: number; mistakes: number }>(`/api/exams/${exam.id}/cards`, { method: "POST" });
      setCardsMsg(
        r.mistakes
          ? `Added ${r.added} flashcard${r.added === 1 ? "" : "s"} from ${r.mistakes} mistake${r.mistakes === 1 ? "" : "s"}${r.added < r.mistakes ? " (the rest were already cards)" : ""}. Review them in the Flashcards tab.`
          : "No mistakes to turn into cards. Nice work.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reschedule() {
    setBusy(true);
    try {
      const d = new Date();
      const start_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      await api(`/api/courses/${courseId}/plan`, { method: "POST", json: { start_date } });
      onPlan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const score = exam.grades?.reduce((s, g) => s + g.score, 0) ?? 0;
  const max = exam.questions.reduce((s, q) => s + q.marks, 0);
  const needsSelf = exam.grades?.some((g) => g.feedback.startsWith("Needs marking"));
  // Marks on answers waiting for the student's own marking: without saying so, "1/34" reads as a fail.
  const toMark = (exam.grades ?? []).filter((g) => g.feedback.startsWith("Needs marking")).reduce((s, g) => s + (exam.questions.find((q) => q.id === g.question_id)?.marks ?? 0), 0);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="spread card" style={{ position: "sticky", top: 58, zIndex: 5 }}>
        <div>
          <button className="ghost sm" onClick={back}>
            ← Back
          </button>
          <strong>{exam.title}</strong>
        </div>
        {graded ? (
          <div className="row">
            <span className={`badge ${score / max >= 0.8 ? "know" : score / max >= 0.5 ? "familiar" : "dont_know"}`}>
              Score {score}/{max} ({Math.round((score / max) * 100)}%)
            </span>
            {toMark > 0 && (
              <button
                className="sm"
                title="Compare your answers with the model answers and enter your marks"
                onClick={() => document.querySelector(".question .self-mark")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              >
                {toMark} mark{toMark === 1 ? "" : "s"} to mark yourself
              </button>
            )}
            <button className="sm" onClick={applyMarks}>
              Update my brainmap marks
            </button>
            <button className="sm" onClick={mistakesToCards}>
              Make flashcards from my mistakes
            </button>
          </div>
        ) : (
          <div className="row">
            <Countdown deadline={deadline} onExpire={() => setTimeUp(true)} />
            <button className="primary" disabled={busy} onClick={() => submit()}>
              {busy ? <Busy label="Marking…" hint="usually under a minute" /> : "Submit for marking"}
            </button>
          </div>
        )}
      </div>
      {timeUp && !graded && <div className="alert">Time is up. Finish the sentence you are writing, then submit, just as in the real exam.</div>}
      {applied && (
        <div className="alert info spread">
          <span>{applied} Update your study plan so weak topics are repeated at the right depth.</span>
          <button className="primary sm" disabled={busy} onClick={reschedule}>
            Update study plan
          </button>
        </div>
      )}
      {cardsMsg && <div className="alert info">{cardsMsg}</div>}
      {error && <div className="alert error">{error}</div>}

      {exam.questions.map((q, i) => (
        <QuestionRow
          key={q.id}
          q={q}
          index={i}
          answer={answers[q.id]}
          grade={exam.grades?.find((g) => g.question_id === q.id)}
          graded={graded}
          selfMark={selfMarks[q.id]}
          onAnswer={setAnswer}
          onSelfMark={setSelf}
        />
      ))}
      {needsSelf && (
        <button className="primary" onClick={() => submit(true)} disabled={busy}>
          Save my marks
        </button>
      )}
    </div>
  );
}

/** Ticks on its own so the questions don't re-render every second. */
function Countdown({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const expired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((deadline - now) / 1000));
  useEffect(() => {
    if (left === 0 && !expired.current) {
      expired.current = true;
      onExpire();
    }
  }, [left, onExpire]);
  return (
    <span className={`badge ${left < 300 ? "dont_know" : ""}`} role="timer" aria-live={left < 60 ? "polite" : "off"}>
      {left === 0 ? "Time's up" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`}
    </span>
  );
}

const QuestionRow = memo(function QuestionRow({
  q,
  index,
  answer,
  grade: g,
  graded,
  selfMark,
  onAnswer,
  onSelfMark,
}: {
  q: ExamQuestion;
  index: number;
  answer: string | undefined;
  grade: ExamGrade | undefined;
  graded: boolean;
  selfMark: number | undefined;
  onAnswer: (qid: string, v: string) => void;
  onSelfMark: (qid: string, v: number) => void;
}) {
  return (
    <div className="question">
      <div className="spread small muted">
        <span>
          Q{index + 1} · {q.type === "mcq" ? "Multiple choice" : q.type === "short" ? "Short answer" : "Long answer"} · {q.topic_title}
        </span>
        <span>
          {g ? `${g.score}/` : ""}
          {q.marks} mark{q.marks > 1 ? "s" : ""}
        </span>
      </div>
      <Markdown>{q.prompt}</Markdown>
      {q.type === "mcq" ? (
        <div role="radiogroup" aria-label={`Question ${index + 1} options`}>
          {q.options.map((o, oi) => {
            const chosen = answer === String(oi);
            const cls = graded ? (oi === q.answer_index ? "correct" : chosen ? "wrong" : "") : "";
            return (
              <label key={oi} className={`option ${cls}`}>
                <input type="radio" name={q.id} disabled={graded} checked={chosen} onChange={() => onAnswer(q.id, String(oi))} />
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
          aria-label={`Answer to question ${index + 1}`}
          value={answer ?? ""}
          onChange={(e) => onAnswer(q.id, e.target.value)}
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
            <label className="small row self-mark">
              Your mark:
              <input type="number" min={0} max={q.marks} value={selfMark ?? ""} onChange={(e) => onSelfMark(q.id, Number(e.target.value))} style={{ width: 70 }} />/ {q.marks}
            </label>
          )}
        </div>
      )}
    </div>
  );
});
