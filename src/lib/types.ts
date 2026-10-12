export const MATERIAL_KINDS = [
  "lecture_notes",
  "slides",
  "pdf",
  "youtube",
  "audio_memo",
  "video",
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
  video: "Video",
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
    goal: "Get the big picture: what it is, why it matters, its key terms, and one intuitive example.",
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
    goal: "Solve exam-style problems with it, from a worked example to problems on your own.",
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
  sha256?: string | null; // content hash of an uploaded file
  rel_path?: string | null; // e.g. "Week 3/Lecture notes.pdf" when imported from a folder or zip
  digest?: Digest | null; // summary, key terms and topics of this material
  scan?: ScanInfo | null; // PDF pages that are pictures without text, and what was done about them
  created_at: string;
}

/** Pages of a PDF that are only pictures (a scan without OCR). */
export interface ScanInfo {
  pages: number[]; // 1-based
  total: number;
  /** OCR text was written into the PDF itself, so the file is searchable. */
  layer?: boolean;
  /** Who read the pictured pages for the material's text, if anyone. */
  text_by?: "ai" | "ocr" | null;
  /** Pages whose own text layer is too damaged to trust (a poor OCR layer from a scanner). */
  poor?: number[];
  /** Pages with display maths the text layer flattens. */
  maths?: number[];
  /** Pages the AI read again from the PDF itself (the scanned, poor and maths pages). */
  ai_pages?: number[];
}

export interface DigestTopic {
  title: string;
  start: string | null; // "mm:ss" in a recording
  summary: string;
  subtopics?: DigestTopic[];
}

export interface Digest {
  summary: string;
  keywords: string[];
  topics: DigestTopic[];
  by: "ai" | "offline";
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
  manual?: number; // 1 when the student added or edited it
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
  audio: string | null; // recorded MP3 (path relative to the data dir)
  audio_marks: number[] | null; // start second of each segment in the MP3
  created_at: string;
  generated_by: "claude" | "heuristic";
}

export interface Card {
  id: string;
  course_id: string;
  topic_id: string | null;
  topic_title?: string | null;
  front: string;
  back: string;
  source: "generated" | "exam" | "manual";
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
  due: string | null; // YYYY-MM-DD; null = new, never reviewed
  last_review: string | null;
  created_at: string;
  generated_by: "claude" | "heuristic" | "student";
}

export interface CardStats {
  total: number;
  due: number; // reviewed before and due today or earlier
  fresh: number; // never reviewed
  learned: number; // reviewed at least once and not currently due
}

export interface KnowledgeLink {
  id: string;
  from_topic: string;
  to_topic: string;
  score: number;
  relation: string | null;
}
