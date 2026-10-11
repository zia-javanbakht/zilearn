"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { LessonModal } from "./LessonModal";
import { DEPTH_LEVELS, type Plan, type PlanItem } from "@/lib/types";
import type { CourseData } from "./CourseWorkspace";

export function PlanTab({ data, reload }: { data: CourseData; reload: () => void }) {
  const { course } = data;
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [form, setForm] = useState({ exam_date: course.exam_date ?? "", target_level: course.target_level, hours_per_day: course.hours_per_day });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [lesson, setLesson] = useState<PlanItem | null>(null);

  useEffect(() => {
    api<Plan | null>(`/api/courses/${course.id}/plan`).then(setPlan).catch((e) => setError(e.message));
  }, [course.id]);

  async function build() {
    if (plan && !confirm("Rebuild the plan from your current marks? Depth you've already completed is kept.")) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await api<Plan>(`/api/courses/${course.id}/plan`, { method: "POST", json: { ...form, exam_date: form.exam_date || null } }));
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: PlanItem) {
    const done = !item.done;
    setPlan((p) => p && { ...p, items: p.items.map((i) => (i.id === item.id ? { ...i, done } : i)) });
    await api(`/api/plan-items/${item.id}`, { method: "PATCH", json: { done } });
    reload();
  }

  const days = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of plan?.items ?? []) m.set(it.date, [...(m.get(it.date) ?? []), it]);
    return [...m.entries()];
  }, [plan]);

  const today = new Date().toISOString().slice(0, 10);
  const done = plan?.items.filter((i) => i.done).length ?? 0;
  const total = plan?.items.length ?? 0;
  const passes = useMemo(() => {
    const m = new Map<number, { minutes: number; topics: number; done: number }>();
    for (const it of plan?.items ?? []) {
      const p = m.get(it.iteration) ?? { minutes: 0, topics: 0, done: 0 };
      p.minutes += it.minutes;
      if (it.kind === "study") p.topics++;
      if (it.done) p.done++;
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
          You go through the course several times. Each pass revisits the same topics one level deeper (Survey → Understand → Apply → Master) until
          you reach the required level. Topics you marked as Familiar join from pass 2; topics you Know get a single check at the end.
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
          <button className="primary" style={{ alignSelf: "flex-end" }} onClick={build} disabled={busy || !data.tree.length}>
            {busy && <span className="spinner" />} {plan ? "Rebuild plan" : "Create plan"}
          </button>
        </div>
        {!data.tree.length && <div className="alert">Build the brainmap and mark your topics first.</div>}
        {error && <div className="alert error">{error}</div>}
      </div>

      {plan === undefined ? (
        <p className="muted">Loading…</p>
      ) : plan === null ? null : (
        <>
          {plan.warnings.map((w, i) => (
            <div key={i} className="alert">
              {w}
            </div>
          ))}
          <div className="card stack">
            <div className="spread">
              <strong>
                {plan.iterations} pass{plan.iterations === 1 ? "" : "es"} · {days.length} days · {plan.start_date} → {plan.end_date}
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
              return (
                <div key={date} className={`day${date === today ? " today" : ""}`}>
                  <div className="spread">
                    <strong>
                      Day {items[0].day} · {formatDay(date)} {date === today && <span className="badge know">Today</span>}
                    </strong>
                    <span className="small muted">{Math.round(mins / 6) / 10}h</span>
                  </div>
                  {visible.map((it) => (
                    <div key={it.id} className={`plan-item ${it.kind}${it.done ? " done" : ""} depth-${it.depth}`}>
                      <input type="checkbox" checked={it.done} onChange={() => toggle(it)} style={{ marginTop: 4 }} />
                      <div className="grow">
                        <div className="spread">
                          <div className="row" style={{ gap: 8 }}>
                            <span className="depth-pill">
                              L{it.depth} {DEPTH_LEVELS[it.depth - 1].name}
                            </span>
                            <strong>{it.topic_title}</strong>
                          </div>
                          <div className="row">
                            <span className="small muted">{it.minutes} min</span>
                            {it.topic_id && (
                              <button className="sm" onClick={() => setLesson(it)}>
                                Open lesson
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
      {lesson?.topic_id && <LessonModal topicId={lesson.topic_id} title={lesson.topic_title} depth={lesson.depth} onClose={() => setLesson(null)} />}
    </div>
  );
}

function formatDay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
