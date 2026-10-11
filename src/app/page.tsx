"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import type { Course } from "@/lib/types";

type CourseRow = Course & { material_count: number; topic_count: number };

export default function Home() {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [form, setForm] = useState({ name: "", code: "", exam_date: "", target_level: 3, hours_per_day: 2 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<CourseRow[]>("/api/courses").then(setCourses).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const c = await api<Course>("/api/courses", { method: "POST", json: { ...form, exam_date: form.exam_date || null } });
      window.location.href = `/courses/${c.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div>
        <h1>Your courses</h1>
        <p className="muted">
          Drop in everything for a course (PDFs, slides, YouTube links, audio memos, sample exams, workshops, tutorials). ziLearn maps it into a
          brainmap, you mark what you know, and it builds a progressive study plan.
        </p>
      </div>
      {error && <div className="alert error">{error}</div>}

      <form className="card stack" onSubmit={create}>
        <h2>New course</h2>
        <div className="row">
          <label className="field grow">
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Machine Learning" />
          </label>
          <label className="field">
            Code
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="COMP3000" style={{ width: 120 }} />
          </label>
          <label className="field">
            Exam date
            <input type="date" value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
          </label>
          <label className="field">
            Required level
            <select value={form.target_level} onChange={(e) => setForm({ ...form, target_level: Number(e.target.value) })}>
              <option value={1}>1 · Survey</option>
              <option value={2}>2 · Understand</option>
              <option value={3}>3 · Apply</option>
              <option value={4}>4 · Master</option>
            </select>
          </label>
          <label className="field">
            Hours / day
            <input type="number" min={0.25} step={0.25} value={form.hours_per_day} onChange={(e) => setForm({ ...form, hours_per_day: Number(e.target.value) })} style={{ width: 90 }} />
          </label>
          <button className="primary" disabled={busy} style={{ alignSelf: "flex-end" }}>
            {busy ? <span className="spinner" /> : null} Create
          </button>
        </div>
      </form>

      {courses === null ? (
        <p className="muted">Loading…</p>
      ) : courses.length === 0 ? (
        <div className="empty card">No courses yet. Create your first one above.</div>
      ) : (
        <div className="grid">
          {courses.map((c) => (
            <Link key={c.id} href={`/courses/${c.id}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="spread">
                <h3 style={{ margin: 0 }}>{c.name}</h3>
                {c.code && <span className="badge">{c.code}</span>}
              </div>
              <p className="muted small" style={{ margin: "8px 0" }}>
                {c.summary ? c.summary.slice(0, 160) + (c.summary.length > 160 ? "…" : "") : "No brainmap yet."}
              </p>
              <div className="row small muted">
                <span>{c.material_count} items</span>·<span>{c.topic_count} topics</span>
                {c.exam_date && (
                  <>
                    ·<span>Exam {c.exam_date}</span>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
