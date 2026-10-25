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
import { FlashcardsTab } from "./FlashcardsTab";
import { PodcastsTab } from "./PodcastsTab";
import { SettingsTab } from "./SettingsTab";
import { AskTab } from "./AskTab";

export interface CourseData {
  course: Course;
  materials: Material[];
  tree: TopicNode[];
  planProgress: { total: number; done: number } | null;
}

const TABS = [
  ["materials", "Materials"],
  ["brainmap", "Brainmap"],
  ["ask", "Ask"],
  ["plan", "Study plan"],
  ["cards", "Flashcards"],
  ["exams", "Mock exams"],
  ["notes", "Review notes"],
  ["podcasts", "Podcasts"],
  ["settings", "Settings"],
] as const;
type Tab = (typeof TABS)[number][0];
const KEEP: Tab[] = ["materials", "ask", "cards", "exams", "notes", "podcasts"];

export function CourseWorkspace({ id }: { id: string }) {
  const [data, setData] = useState<CourseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("materials");
  const [openExamId, setOpenExamId] = useState<string | null>(null);
  // Tabs that generate with Claude stay mounted once opened, so a running generation survives switching tabs.
  const [kept, setKept] = useState<Set<Tab>>(() => new Set());
  useEffect(() => {
    if (KEEP.includes(tab)) setKept((k) => (k.has(tab) ? k : new Set(k).add(tab)));
  }, [tab]);

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

  const go = (t: Tab, opts?: { examId?: string }) => {
    setOpenExamId(opts?.examId ?? null);
    setTab(t);
    history.replaceState(null, "", `${window.location.search}#${t}`);
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
          <div className="small muted">
            {[
              `${data.materials.length} items`,
              `${countTopics(data.tree)} topics`,
              course.exam_date ? `Exam ${course.exam_date} (${daysUntil(course.exam_date)})` : "",
              data.planProgress ? `Plan ${data.planProgress.done}/${data.planProgress.total} done` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
      {course.summary && <p className="muted" style={{ marginTop: 10, maxWidth: 900 }}>{course.summary}</p>}

      <Steps data={data} go={go} />

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => go(k)}>
            {label}
          </button>
        ))}
      </div>

      {(tab === "materials" || kept.has("materials")) && (
        <div hidden={tab !== "materials"}>
          <MaterialsTab data={data} reload={reload} onBrainmap={() => go("brainmap")} />
        </div>
      )}
      {tab === "brainmap" && <BrainmapTab data={data} reload={reload} onPlan={() => go("plan")} />}
      {(tab === "ask" || kept.has("ask")) && (
        <div hidden={tab !== "ask"}>
          <AskTab data={data} />
        </div>
      )}
      {tab === "plan" && <PlanTab data={data} reload={reload} go={go} />}
      {(tab === "cards" || kept.has("cards")) && (
        <div hidden={tab !== "cards"}>
          <FlashcardsTab data={data} active={tab === "cards"} />
        </div>
      )}
      {(tab === "exams" || kept.has("exams")) && (
        <div hidden={tab !== "exams"}>
          <ExamsTab key={openExamId ?? "list"} data={data} reload={reload} openExamId={openExamId} onPlan={() => go("plan")} />
        </div>
      )}
      {(tab === "notes" || kept.has("notes")) && (
        <div hidden={tab !== "notes"}>
          <NotesTab data={data} />
        </div>
      )}
      {(tab === "podcasts" || kept.has("podcasts")) && (
        <div hidden={tab !== "podcasts"}>
          <PodcastsTab data={data} />
        </div>
      )}
      {tab === "settings" && <SettingsTab data={data} reload={reload} />}
    </div>
  );
}

/** Getting-started guide: shows the next step until a plan exists. */
function Steps({ data, go }: { data: CourseData; go: (t: Tab) => void }) {
  const leaves: TopicNode[] = [];
  const walk = (ns: TopicNode[]) => ns.forEach((n) => (n.children.length ? walk(n.children) : leaves.push(n)));
  walk(data.tree);
  const marked = leaves.filter((n) => n.effective_mastery).length;
  const steps: { label: string; done: boolean; tab: Tab; hint: string }[] = [
    { label: "Add materials", done: data.materials.length > 0, tab: "materials", hint: "Drop in your lecture notes, slides, recordings and sample exams." },
    { label: "Build the brainmap", done: data.tree.length > 0, tab: "brainmap", hint: "ziLearn organises everything into topics." },
    {
      label: "Mark what you know",
      done: leaves.length > 0 && marked > 0,
      tab: "brainmap",
      hint: "Mark branches as Know, Familiar or Don't know. Unmarked topics are treated as Don't know.",
    },
    { label: "Create your study plan", done: data.planProgress !== null, tab: "plan", hint: "Set your exam date and get a day-by-day progressive plan." },
  ];
  const next = steps.findIndex((s) => !s.done);
  if (next === -1) return null;
  return (
    <div className="card row" style={{ marginTop: 14, gap: 16 }}>
      {steps.map((s, i) => (
        <button key={s.label} className={`sm ${i === next ? "primary" : "ghost"}`} onClick={() => go(s.tab)} title={s.hint} style={{ opacity: s.done ? 0.6 : 1 }}>
          {s.done ? "✓" : `${i + 1}.`} {s.label}
        </button>
      ))}
      <span className="small muted grow">{steps[next].hint}</span>
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
