import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { splitSections, topKeywords, truncate } from "./text";
import type { NewTopic } from "./store";
import type { Course, Material } from "./types";
import { MATERIAL_KIND_LABELS } from "./types";

/* ---------------- Structuring ---------------- */

const TopicSchema = z.object({
  course_summary: z.string().describe("2-4 sentence overview of what the course covers."),
  topics: z
    .array(
      z.object({
        ref: z.string().describe("Short unique id like T1, T1.2"),
        parent_ref: z.string().nullable().describe("ref of the parent topic, or null for a top-level branch"),
        title: z.string().describe("Concise topic name (max ~6 words)"),
        summary: z.string().describe("1-3 sentences: what the student must know about this topic"),
        keywords: z.array(z.string()).describe("3-8 key terms"),
        importance: z.number().int().describe("1 = minor, 2 = normal, 3 = core / heavily examined"),
        sources: z.array(z.string()).describe("Material ids (e.g. M2) this topic draws on"),
      }),
    )
    .describe("Flat list of topics; nesting via parent_ref."),
});

const MAX_CHARS = 600_000;

export async function structureCourse(course: Course, materials: Material[]): Promise<{ topics: NewTopic[]; summary: string; by: "claude" | "heuristic" }> {
  const usable = materials.filter((m) => (m.text ?? "").trim().length > 0 || m.title);
  if (aiEnabled() && usable.length) {
    const { topics, summary } = await structureWithClaude(course, usable);
    return { topics, summary, by: "claude" };
  }
  return { topics: heuristicTopics(usable), summary: heuristicSummary(course, usable), by: "heuristic" };
}

async function structureWithClaude(course: Course, materials: Material[]) {
  const total = materials.reduce((s, m) => s + (m.text?.length ?? 0), 0);
  const ratio = total > MAX_CHARS ? MAX_CHARS / total : 1;
  const refs = new Map<string, string>();
  const blocks = materials.map((m, i) => {
    const ref = `M${i + 1}`;
    refs.set(ref, m.id);
    const body = m.text ? truncate(m.text, Math.max(2000, Math.floor(m.text.length * ratio))) : "(no text available)";
    return `<material id="${ref}" kind="${MATERIAL_KIND_LABELS[m.kind]}" title="${m.title.replace(/"/g, "'")}">\n${body}\n</material>`;
  });
  const prompt = `Course: ${course.name}${course.code ? ` (${course.code})` : ""}
${course.description ? `Description: ${course.description}\n` : ""}
Below are all the materials the student has collected for this course (lecture notes, slides, recordings, sample exams, workshops, tutorials, ...).

${blocks.join("\n\n")}

Build a brainmap of the course content:
- Organise by concept, not by file: merge material that covers the same idea from different sources.
- 4-10 top-level branches, each with subtopics; go 2-4 levels deep. Leaves should be study-sized (30-60 minutes of work at most).
- Order branches and subtopics in a sensible learning order (prerequisites first).
- Mark importance 3 for topics that are core or appear in sample exams.
- Cite source material ids for each topic.
- Do not create topics for administrative content (assessment dates, course logistics).`;

  const out = await generateStructured({ schema: TopicSchema, prompt, effort: "medium" });
  const seen = new Set<string>();
  const topics: NewTopic[] = [];
  for (const t of out.topics) {
    if (!t.ref || seen.has(t.ref)) continue;
    seen.add(t.ref);
    topics.push({
      ref: t.ref,
      parent_ref: t.parent_ref && t.parent_ref !== t.ref ? t.parent_ref : null,
      title: t.title.trim(),
      summary: t.summary.trim(),
      keywords: t.keywords.slice(0, 8),
      importance: t.importance,
      material_ids: t.sources.map((s) => refs.get(s.trim())).filter((x): x is string => Boolean(x)),
    });
  }
  return { topics, summary: out.course_summary };
}

/** Offline structuring: one branch per material, subtopics from detected headings. */
export function heuristicTopics(materials: Material[]): NewTopic[] {
  const topics: NewTopic[] = [];
  materials.forEach((m, i) => {
    const ref = `M${i}`;
    const text = m.text ?? "";
    const sections = splitSections(text).filter((s) => s.heading);
    topics.push({
      ref,
      parent_ref: null,
      title: m.title,
      summary: firstSentences(text, 2) || `${MATERIAL_KIND_LABELS[m.kind]} for this course.`,
      keywords: topKeywords(text, 6),
      material_ids: [m.id],
      importance: m.kind === "sample_exam" ? 3 : 2,
    });
    const seen = new Set<string>();
    for (const s of sections) {
      const key = s.heading.toLowerCase();
      if (seen.has(key) || seen.size >= 15) continue;
      seen.add(key);
      topics.push({
        ref: `${ref}.${seen.size}`,
        parent_ref: ref,
        title: truncate(s.heading, 60),
        summary: firstSentences(s.body, 2),
        keywords: topKeywords(`${s.heading} ${s.body}`, 6),
        material_ids: [m.id],
        importance: 2,
      });
    }
  });
  return topics;
}

function heuristicSummary(course: Course, materials: Material[]) {
  const kw = topKeywords(materials.map((m) => `${m.title} ${m.text ?? ""}`).join(" "), 8);
  return `${course.name} draws on ${materials.length} item${materials.length === 1 ? "" : "s"}. Frequent themes: ${kw.join(", ")}.`;
}

function firstSentences(text: string, n: number) {
  const s = text
    .replace(/--- Page \d+ ---/g, " ")
    .replace(/^\s*(#{1,6}\s+|[-*]\s+|slide \d+:\s*)/gim, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = s.match(/[^.!?]+[.!?]+/g) ?? (s ? [s] : []);
  return truncate(parts.slice(0, n).join(" ").trim(), 300);
}

export { toFlowchart, toMindmap } from "./mermaid";
