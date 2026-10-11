"use client";

import { useState } from "react";
import { api } from "../api";
import type { CourseData } from "./CourseWorkspace";

export function SettingsTab({ data, reload }: { data: CourseData; reload: () => void }) {
  const c = data.course;
  const [form, setForm] = useState({ name: c.name, code: c.code ?? "", description: c.description ?? "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await api(`/api/courses/${c.id}`, { method: "PATCH", json: form });
      setSaved(true);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 640 }}>
      <div className="card stack">
        <h2>Course details</h2>
        <label className="field">
          Name
          <input value={form.name} onChange={(e) => (setForm({ ...form, name: e.target.value }), setSaved(false))} />
        </label>
        <label className="field">
          Code
          <input value={form.code} onChange={(e) => (setForm({ ...form, code: e.target.value }), setSaved(false))} />
        </label>
        <label className="field">
          Description (helps structure the brainmap)
          <textarea value={form.description} onChange={(e) => (setForm({ ...form, description: e.target.value }), setSaved(false))} />
        </label>
        <div className="row">
          <button className="primary" onClick={save}>
            Save
          </button>
          {saved && <span className="small muted">Saved.</span>}
          {error && <span className="small" style={{ color: "var(--dont)" }}>{error}</span>}
        </div>
      </div>
      <div className="card stack">
        <h2>Delete course</h2>
        <p className="muted small">Removes the course with all its materials, brainmap, plan, exams, notes and podcasts.</p>
        <div>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Delete "${c.name}" and everything in it?`)) return;
              await api(`/api/courses/${c.id}`, { method: "DELETE" });
              window.location.href = "/";
            }}
          >
            Delete course
          </button>
        </div>
      </div>
    </div>
  );
}
