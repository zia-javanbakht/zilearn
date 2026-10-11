"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Course, Material, TopicNode } from "@/lib/types";
import { MaterialsTab } from "./MaterialsTab";
import { BrainmapTab } from "./BrainmapTab";
import { PlanTab } from "./PlanTab";
import { ExamsTab } from "./ExamsTab";
import { NotesTab } from "./NotesTab";
import { PodcastsTab } from "./PodcastsTab";
import { SettingsTab } from "./SettingsTab";

export interface CourseData {
  course: Course;
  materials: Material[];
  tree: TopicNode[];
  planProgress: { total: number; done: number } | null;
}

const TABS = [
  ["materials", "Materials"],
  ["brainmap", "Brainmap"],
  ["plan", "Study plan"],
  ["exams", "Mock exams"],
  ["notes", "Review notes"],
  ["podcasts", "Podcasts"],
  ["settings", "Settings"],
] as const;
type Tab = (typeof TABS)[number][0];

export function CourseWorkspace({ id }: { id: string }) {
  const [data, setData] = useState<CourseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("materials");

  const reload = useCallback(() => api<CourseData>(`/api/courses/${id}`).then(setData).catch((e) => setError(e.message)), [id]);

  useEffect(() => {
    reload();
    const fromHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.some(([k]) => k === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [reload]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { course } = data;

  return (
    <div>
      <div className="spread">
        <div>
          <Link href="/" className="small muted">
            ← All courses
          </Link>
          <h1 style={{ margin: "4px 0" }}>
            {course.name} {course.code && <span className="badge">{course.code}</span>}
          </h1>
          <div className="row small muted">
            <span>{data.materials.length} items</span>·<span>{countTopics(data.tree)} topics</span>
            {course.exam_date && (
              <>
                ·<span>Exam {course.exam_date} ({daysUntil(course.exam_date)})</span>
              </>
            )}
            {data.planProgress && (
              <>
                ·<span>
                  Plan {data.planProgress.done}/{data.planProgress.total} done
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      {course.summary && <p className="muted" style={{ marginTop: 10, maxWidth: 900 }}>{course.summary}</p>}

      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => go(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "materials" && <MaterialsTab data={data} reload={reload} onBrainmap={() => go("brainmap")} />}
      {tab === "brainmap" && <BrainmapTab data={data} reload={reload} onPlan={() => go("plan")} />}
      {tab === "plan" && <PlanTab data={data} reload={reload} />}
      {tab === "exams" && <ExamsTab data={data} reload={reload} />}
      {tab === "notes" && <NotesTab data={data} />}
      {tab === "podcasts" && <PodcastsTab data={data} />}
      {tab === "settings" && <SettingsTab data={data} reload={reload} />}
    </div>
  );
}

function countTopics(ns: TopicNode[]): number {
  return ns.reduce((s, n) => s + 1 + countTopics(n.children), 0);
}

function daysUntil(date: string) {
  const d = Math.ceil((new Date(date + "T00:00:00").getTime() - Date.now()) / 86400000);
  return d > 1 ? `in ${d} days` : d === 1 ? "tomorrow" : d === 0 ? "today" : "passed";
}
