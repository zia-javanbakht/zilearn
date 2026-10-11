"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { LessonModal } from "./LessonModal";
import { DEPTH_LEVELS, type Exam, type Plan, type PlanItem, type PlanItemKind, type TopicNode } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

type Go = (t: "exams" | "notes" | "podcasts", opts?: { examId?: string }) => void;

const KIND_LABEL: Partial<Record<PlanItemKind, string>> = {
  overview: "Branch overview",
  synthesis: "Branch synthesis",
  diagnostic: "Quick check",
  recall: "Recall",
  checkpoint: "Checkpoint",
  final: "Exam prep",
};

export function PlanTab({ data, reload, go }: { data: CourseData; reload: () => void; go: Go }) {
  const { course } = data;
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [form, setForm] = useState({ exam_date: course.exam_date ?? "", target_level: course.target_level, hours_per_day: course.hours_per_day });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [lesson, setLesson] = useState<{ id: string; title: string; depth: number } | null>(null);

  const load = () => api<Plan | null>(`/api/courses/${course.id}/plan`).then(setPlan).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function build(ask = true) {
    if (ask && plan && !confirm("Rebuild the plan from today using your current marks? Completed sessions are kept as history.")) return;
    const p = await run("plan", () =>
      api<Plan>(`/api/courses/${course.id}/plan`, { method: "POST", json: { ...form, exam_date: form.exam_date || null, start_date: localDate() } }),
    );
    if (p) {
      setPlan(p);
      reload();
    }
  }

  async function toggle(item: PlanItem) {
    const done = !item.done;
    const set = (v: boolean) => setPlan((p) => p && { ...p, items: p.items.map((i) => (i.id === item.id ? { ...i, done: v } : i)) });
    set(done);
    try {
      await api(`/api/plan-items/${item.id}`, { method: "PATCH", json: { done } });
      reload();
    } catch (e) {
      set(!done);
      setError((e as Error).message);
    }
  }

  async function quiz(item: PlanItem) {
    const ids =
      item.kind === "final"
        ? []
        : (plan?.items ?? []).filter((i) => i.kind === "study" && i.iteration === item.iteration && i.topic_id).map((i) => i.topic_id!);
    const exam = await run(`quiz:${item.id}`, () =>
      api<Exam>(`/api/courses/${course.id}/exams`, {
        method: "POST",
        json:
          item.kind === "final"
            ? { scope: { kind: "course" }, questionCount: 20, durationMinutes: 90, title: "Final mock exam" }
            : {
                scope: { kind: "topics", ids, label: `Pass ${item.iteration} checkpoint` },
                questionCount: Math.min(15, Math.max(5, ids.length)),
                durationMinutes: 25,
                depth: item.iteration,
                title: `Checkpoint: pass ${item.iteration} (${DEPTH_LEVELS[item.iteration - 1].name})`,
                mix: { mcq: 5, short: 4, long: item.iteration >= 3 ? 1 : 0 },
              },
      }),
    );
    if (exam) go("exams", { examId: exam.id });
  }

  async function forDay(items: PlanItem[], what: "notes" | "podcasts", date: string) {
    const ids = [...new Set(items.map((i) => i.topic_id).filter((x): x is string => Boolean(x)))];
    if (!ids.length) return setError("This day has no topics to summarise.");
    const scope = { kind: "topics", ids, label: `Study day ${formatDay(date)}` };
    const ok = await run(`${what}:${date}`, () =>
      api(`/api/courses/${course.id}/${what}`, { method: "POST", json: what === "notes" ? { scope, style: "concise" } : { scope, minutes: 8 } }),
    );
    if (ok) go(what);
  }

  async function weakNotes() {
    const ok = await run("weak", () => api(`/api/courses/${course.id}/notes`, { method: "POST", json: { scope: { kind: "weak" }, style: "cheatsheet" } }));
    if (ok) go("notes");
  }

  const paths = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (ns: TopicNode[], trail: string[]) =>
      ns.forEach((n) => {
        m.set(n.id, trail.join(" › "));
        walk(n.children, [...trail, n.title]);
      });
    walk(data.tree, []);
    return m;
  }, [data.tree]);

  const days = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of plan?.items ?? []) m.set(it.date, [...(m.get(it.date) ?? []), it]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [plan]);

  const today = localDate();
  const total = plan?.items.length ?? 0;
  const done = plan?.items.filter((i) => i.done).length ?? 0;
  const overdue = plan?.items.filter((i) => !i.done && i.date < today).length ?? 0;
  const passes = useMemo(() => {
    const m = new Map<number, { minutes: number; topics: number }>();
    for (const it of plan?.items ?? []) {
      if (it.kind === "recall" || it.kind === "final") continue;
      const p = m.get(it.iteration) ?? { minutes: 0, topics: 0 };
      p.minutes += it.minutes;
      if (it.kind === "study") p.topics++;
      m.set(it.iteration, p);
    }
    return [...m.entries()];
  }, [plan]);
  const maxMinutes = Math.max(1, ...passes.map(([, p]) => p.minutes));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card stack">
        <h2>Progressive study plan</h2>
        <p className="muted small" style={{ margin: 0 }}>
          You go through the course in several passes, each one level deeper (Survey → Understand → Apply → Master) until the required level.
          Topics you marked Familiar join from pass 2; topics you Know get a quick check early and a confirmation at the end. Short recall warm-ups
          bring back what you studied 1, 3 and 7 days earlier, and the day before the exam is kept for a full mock exam.
        </p>
        <div className="row">
          <label className="field">
            Exam date
            <input type="date" value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
          </label>
          <label className="field">
            Required level
            <select value={form.target_level} onChange={(e) => setForm({ ...form, target_level: Number(e.target.value) })}>
              {DEPTH_LEVELS.map((l) => (
                <option key={l.level} value={l.level}>
                  {l.level} · {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Hours per day
            <input type="number" min={0.25} step={0.25} value={form.hours_per_day} onChange={(e) => setForm({ ...form, hours_per_day: Number(e.target.value) })} style={{ width: 100 }} />
          </label>
          <button className="primary" style={{ alignSelf: "flex-end" }} onClick={() => build()} disabled={!!busy || !data.tree.length}>
            {busy === "plan" && <span className="spinner" role="status" aria-label="Working" />} {plan ? "Rebuild from today" : "Create plan"}
          </button>
        </div>
        {!data.tree.length && <div className="alert">Build the brainmap and mark your topics first.</div>}
        {error && <div className="alert error">{error}</div>}
      </div>

      {plan === undefined ? (
        <p className="muted">Loading…</p>
      ) : plan === null ? null : (
        <>
          {overdue > 0 && (
            <div className="alert spread">
              <span>
                You have {overdue} unfinished session{overdue === 1 ? "" : "s"} from earlier days. Rescheduling spreads the remaining work from today;
                finished sessions are kept.
              </span>
              <button className="primary" onClick={() => build(false)} disabled={!!busy}>
                Reschedule from today
              </button>
            </div>
          )}
          {plan.warnings.map((w, i) => (
            <div key={i} className="alert">
              {w}
            </div>
          ))}
          <div className="card stack">
            <div className="spread">
              <strong>
                {plan.iterations} pass{plan.iterations === 1 ? "" : "es"} · {plan.start_date} → exam {plan.end_date}
              </strong>
              <span className="small muted">
                {done}/{total} sessions done
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <div className="row" style={{ alignItems: "flex-end" }}>
              {passes.map(([k, p]) => (
                <div key={k} className={`depth-${k}`} style={{ flex: 1, minWidth: 90 }}>
                  <div className="spiral">
                    <div style={{ height: `${Math.max(12, (p.minutes / maxMinutes) * 100)}%` }} />
                  </div>
                  <div className="small">
                    <span className="depth-pill">
                      Pass {k} · {DEPTH_LEVELS[k - 1].name}
                    </span>
                  </div>
                  <div className="small muted">
                    {p.topics} topics · {Math.round(p.minutes / 6) / 10}h
                  </div>
                </div>
              ))}
            </div>
            <label className="small muted row" style={{ gap: 6 }}>
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide completed
            </label>
          </div>

          <div>
            {days.map(([date, items]) => {
              const visible = hideDone ? items.filter((i) => !i.done) : items;
              if (!visible.length) return null;
              const mins = items.reduce((s, i) => s + i.minutes, 0);
              const past = date < today;
              return (
                <div key={date} className={`day${date === today ? " today" : ""}`} style={past ? { opacity: 0.85 } : undefined}>
                  <div className="spread">
                    <strong>
                      {formatDay(date)} {date === today && <span className="badge know">Today</span>}
                    </strong>
                    <div className="row">
                      <span className="small muted">{Math.round(mins / 6) / 10}h</span>
                      {items.some((i) => i.topic_id) && !past && (
                        <>
                          <button className="sm ghost" disabled={!!busy} onClick={() => forDay(items, "notes", date)} title="Review notes for this day's topics">
                            {busy === `notes:${date}` ? <span className="spinner" role="status" aria-label="Working" /> : "📝"} Notes
                          </button>
                          <button className="sm ghost" disabled={!!busy} onClick={() => forDay(items, "podcasts", date)} title="A short podcast on this day's topics">
                            {busy === `podcasts:${date}` ? <span className="spinner" role="status" aria-label="Working" /> : "🎧"} Podcast
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {visible.map((it) => (
                    <div key={it.id} className={`plan-item ${it.kind}${it.done ? " done" : ""} depth-${it.depth}`}>
                      <input type="checkbox" checked={it.done} onChange={() => toggle(it)} style={{ marginTop: 4 }} />
                      <div className="grow">
                        <div className="spread">
                          <div className="row" style={{ gap: 8 }}>
                            {KIND_LABEL[it.kind] ? (
                              <span className="badge accent">{KIND_LABEL[it.kind]}</span>
                            ) : (
                              <span className="depth-pill">
                                L{it.depth} {DEPTH_LEVELS[it.depth - 1].name}
                              </span>
                            )}
                            <div>
                              {it.topic_id && paths.get(it.topic_id) && <div className="small muted">{paths.get(it.topic_id)}</div>}
                              <strong>{it.topic_title}</strong>
                            </div>
                          </div>
                          <div className="row">
                            <span className="small muted">{it.minutes} min</span>
                            {it.topic_id && it.kind !== "recall" && (
                              <button className="sm" onClick={() => setLesson({ id: it.topic_id!, title: it.topic_title, depth: it.depth })}>
                                {it.kind === "diagnostic" ? "Check questions" : "Open lesson"}
                              </button>
                            )}
                            {(it.kind === "checkpoint" || (it.kind === "final" && it.topic_title === "Final mock exam")) && (
                              <button className="sm primary" disabled={!!busy} onClick={() => quiz(it)}>
                                {busy === `quiz:${it.id}` && <span className="spinner" role="status" aria-label="Working" />} {it.kind === "final" ? "Start mock exam" : "Start checkpoint quiz"}
                              </button>
                            )}
                            {it.kind === "final" && it.topic_title === "Review weak topics" && (
                              <button className="sm" disabled={!!busy} onClick={weakNotes}>
                                {busy === "weak" && <span className="spinner" role="status" aria-label="Working" />} Make cheat sheet
                              </button>
                            )}
                          </div>
                        </div>
                        <ul>
                          {it.activities.map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
      {lesson && (
        <LessonModal
          topicId={lesson.id}
          title={lesson.title}
          depth={lesson.depth}
          onClose={() => setLesson(null)}
          onCompleted={() => {
            load();
            reload();
          }}
        />
      )}
    </div>
  );
}

function formatDay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** The user's local calendar date (not UTC). */
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
