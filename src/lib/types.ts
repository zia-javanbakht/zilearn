export const MATERIAL_KINDS = [
  "lecture_notes",
  "slides",
  "pdf",
  "youtube",
  "audio_memo",
  "sample_exam",
  "workshop",
  "tutorial",
  "reading",
  "other",
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  lecture_notes: "Lecture notes",
  slides: "Slides",
  pdf: "PDF",
  youtube: "YouTube",
  audio_memo: "Audio memo",
  sample_exam: "Sample exam",
  workshop: "Workshop",
  tutorial: "Tutorial",
  reading: "Reading",
  other: "Other",
};

export type Mastery = "dont_know" | "familiar" | "know";
export const MASTERY_LABELS: Record<Mastery, string> = {
  dont_know: "Don't know anything",
  familiar: "Familiar",
  know: "Know",
};

/** Progressive depth levels. Each study iteration goes one level deeper. */
export const DEPTH_LEVELS = [
  { level: 1, name: "Survey", goal: "Get the big picture: what it is, why it matters, key terms." },
  { level: 2, name: "Understand", goal: "Explain the ideas in your own words and see how they connect." },
  { level: 3, name: "Apply", goal: "Work problems and examples; use the ideas in exam-style questions." },
  { level: 4, name: "Master", goal: "Handle edge cases, compare and critique, teach it back from memory." },
] as const;

export interface Course {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  exam_date: string | null;
  target_level: number;
  hours_per_day: number;
  summary: string | null;
  created_at: string;
}

export interface Material {
  id: string;
  course_id: string;
  kind: MaterialKind;
  title: string;
  source_type: "file" | "url" | "text";
  filename: string | null;
  mime: string | null;
  path: string | null;
  url: string | null;
  text: string | null;
  status: "ready" | "error" | "partial";
  note: string | null;
  created_at: string;
}

export interface Topic {
  id: string;
  course_id: string;
  parent_id: string | null;
  title: string;
  summary: string;
  keywords: string[];
  material_ids: string[];
  importance: number;
  position: number;
  mastery: Mastery | null;
  achieved_depth: number;
}

export interface TopicNode extends Topic {
  children: TopicNode[];
  effective_mastery: Mastery | null;
}

export interface PlanItem {
  id: string;
  plan_id: string;
  day: number;
  date: string;
  iteration: number;
  kind: "study" | "checkpoint";
  topic_id: string | null;
  topic_title: string;
  depth: number;
  minutes: number;
  activities: string[];
  done: boolean;
  position: number;
}

export interface Plan {
  id: string;
  course_id: string;
  created_at: string;
  start_date: string;
  end_date: string;
  target_level: number;
  iterations: number;
  warnings: string[];
  items: PlanItem[];
}

export interface ExamQuestion {
  id: string;
  type: "mcq" | "short" | "long";
  topic_id: string | null;
  topic_title: string;
  prompt: string;
  options: string[];
  answer_index: number | null;
  model_answer: string;
  marks: number;
}

export interface ExamGrade {
  question_id: string;
  score: number;
  max: number;
  feedback: string;
}

export interface Exam {
  id: string;
  course_id: string;
  title: string;
  created_at: string;
  duration_minutes: number;
  questions: ExamQuestion[];
  answers: Record<string, string> | null;
  grades: ExamGrade[] | null;
  generated_by: "claude" | "heuristic";
}

export interface ReviewNote {
  id: string;
  course_id: string;
  title: string;
  scope: string;
  content: string;
  created_at: string;
  generated_by: "claude" | "heuristic";
}

export interface PodcastSegment {
  speaker: "A" | "B";
  text: string;
}

export interface Podcast {
  id: string;
  course_id: string;
  title: string;
  scope: string;
  hosts: { A: string; B: string };
  segments: PodcastSegment[];
  created_at: string;
  generated_by: "claude" | "heuristic";
}

export interface KnowledgeLink {
  id: string;
  from_topic: string;
  to_topic: string;
  score: number;
  relation: string | null;
}
