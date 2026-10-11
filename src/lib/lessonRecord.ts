import { getCourse, getTopic, listCards, listExams, listTopics } from "./store";
import { DEPTH_LEVELS } from "./types";
import { truncate } from "./text";

/**
 * What the student has already shown about a topic, so a lesson can target it: the mock exam questions
 * they lost marks on (with what they wrote and the marker's feedback) and the flashcards they keep
 * forgetting. Covers the topic and its subtopics. Empty when there is nothing to report.
 */
export interface StudentRecord {
  goal: string;
  text: string;
  mistakes: number;
  /** Days to the exam, when there is a date. */
  days: number | null;
  target: number;
  /** The slips themselves, for lessons made without AI. */
  slips: { question: string; feedback: string }[];
}

export function studentRecord(topicId: string): StudentRecord {
  const topic = getTopic(topicId);
  if (!topic) return { goal: "", text: "", mistakes: 0, days: null, target: 3, slips: [] };
  const all = listTopics(topic.course_id);
  const ids = new Set([topic.id]);
  // The topic and everything below it in the brainmap.
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of all) if (t.parent_id && ids.has(t.parent_id) && !ids.has(t.id)) (ids.add(t.id), (grew = true));
  }

  const lost: string[] = [];
  const slips: StudentRecord["slips"] = [];
  for (const e of listExams(topic.course_id)) {
    if (!e.grades) continue;
    for (const q of e.questions) {
      if (!q.topic_id || !ids.has(q.topic_id)) continue;
      const g = e.grades.find((x) => x.question_id === q.id);
      if (!g || g.feedback.startsWith("Needs marking") || g.score >= g.max) continue;
      const answer = e.answers?.[q.id]?.trim();
      slips.push({ question: q.prompt, feedback: g.feedback });
      lost.push(
        `- Question: ${truncate(q.prompt.replace(/\s+/g, " "), 300)}\n  Their answer: ${answer ? truncate(answer.replace(/\s+/g, " "), 300) : "(left blank)"}\n  Mark: ${g.score}/${g.max}. Feedback: ${truncate(g.feedback.replace(/\s+/g, " "), 300)}`,
      );
    }
  }
  const forgotten = listCards(topic.course_id)
    .filter((c) => c.topic_id && ids.has(c.topic_id) && c.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses)
    .slice(0, 6)
    .map((c) => `- "${truncate(c.front.replace(/\s+/g, " "), 160)}" (answer: ${truncate(c.back.replace(/\s+/g, " "), 160)}), forgotten ${c.lapses} time${c.lapses === 1 ? "" : "s"}`);

  const course = getCourse(topic.course_id);
  const days = course?.exam_date ? Math.ceil((Date.parse(`${course.exam_date}T00:00:00`) - Date.now()) / 86_400_000) : null;
  const goal = [
    days !== null && days >= 0 ? `Exam in ${days} day${days === 1 ? "" : "s"}.` : "",
    course ? `Level they need for the exam: ${course.target_level} (${DEPTH_LEVELS[course.target_level - 1]?.name ?? ""}).` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const parts = [
    lost.length ? `Mock exam questions on this topic where they lost marks (most recent last):\n${lost.slice(-6).join("\n")}` : "",
    forgotten.length ? `Flashcards on this topic they keep forgetting:\n${forgotten.join("\n")}` : "",
  ].filter(Boolean);
  return { goal, text: parts.join("\n\n"), mistakes: lost.length + forgotten.length, days, target: course?.target_level ?? 3, slips: slips.slice(-4) };
}
