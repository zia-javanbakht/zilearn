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
  {
    level: 1,
    name: "Survey",
    goal: "Get the big picture: what it is, why it matters, the 3-5 key terms, and one intuitive example.",
    lesson: "A short orientation (no derivations): a plain-language explanation, the key terms with one-line definitions, one intuitive example or analogy, and why it matters for the course.",
  },
  {
    level: 2,
    name: "Understand",
    goal: "Explain how and why it works in your own words, and how it connects to neighbouring topics.",
    lesson: "Open with 2 quick recall questions on the level 1 ideas. Then explain the mechanism or reasoning step by step, the main definitions/results precisely, common misconceptions, and how it links to its sibling topics.",
  },
  {
    level: 3,
    name: "Apply",
    goal: "Solve exam-style problems with it: two worked examples, then problems on your own.",
    lesson: "Open with 2 recall questions on the level 2 ideas. Then give 2 fully worked exam-style examples with reasoning shown, a checklist of steps/pitfalls, and 2-3 unsolved practice problems (answers in a <details> block).",
  },
  {
    level: 4,
    name: "Master",
    goal: "Handle edge cases, compare with related ideas, critique, and teach it back from memory.",
    lesson: "Open with 2 recall questions on applying it. Then cover edge cases and limitations, compare and contrast with related topics, one hard multi-step or 'explain why' exam question with a model answer, and a teach-back prompt.",
  },
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

export type PlanItemKind = "study" | "checkpoint" | "diagnostic" | "overview" | "synthesis" | "recall" | "final";

export interface PlanItem {
  id: string;
  plan_id: string;
  day: number;
  date: string;
  iteration: number;
  kind: PlanItemKind;
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
