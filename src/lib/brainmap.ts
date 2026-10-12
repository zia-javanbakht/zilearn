import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { offlineDigest } from "./digest";
import { studySections, topKeywords, truncate } from "./text";
import { checkKeywords, repairTerm } from "./textRepair";
import { clipWords } from "./figure";
import { headingRepairer } from "./headingRepair";
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

// About 75k input tokens: enough for a semester of notes without making every rebuild expensive.
const MAX_CHARS = 300_000;

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
  // Small materials keep a floor of text; the rest share what is left of the budget.
  const floor = Math.min(2000, Math.floor(MAX_CHARS / Math.max(1, materials.length)));
  const ratio = total > MAX_CHARS ? Math.max(0, MAX_CHARS - floor * materials.length) / total : 1;
  const refs = new Map<string, string>();
  const blocks = materials.map((m, i) => {
    const ref = `M${i + 1}`;
    refs.set(ref, m.id);
    const body = m.text ? truncate(m.text, Math.max(floor, Math.floor(m.text.length * ratio))) : "(no text available)";
    // A digest keeps the whole of a long recording in view even when its transcript is cut to fit.
    const digest = m.digest
      ? `<digest>\n${m.digest.summary}\nKey terms: ${m.digest.keywords.join(", ")}\nTopics: ${m.digest.topics.map((t) => t.title).join("; ")}\n</digest>\n`
      : "";
    return `<material id="${ref}" kind="${MATERIAL_KIND_LABELS[m.kind]}" title="${m.title.replace(/"/g, "'")}">\n${digest}${body}\n</material>`;
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
- Cover every numbered section and appendix of a paper or set of notes somewhere in the map.
- Write each summary only from what its own section says: a result found for one case (one test, geometry or example) is not stated for the others, and a comparison says which method came out better where.
- Do not create topics for administrative content (assessment dates, course logistics).
- The text came from PDF extraction, OCR or speech recognition and may be damaged ("e ect" for "effect", "rst" for "first", misread or misheard terms). Read it in context and spell every title, summary and key term correctly; key terms must be terms the materials actually use.`;

  const out = await generateStructured({ schema: TopicSchema, prompt, effort: "medium", maxTokens: 32000 });
  const textOf = new Map(materials.map((m, i) => [`M${i + 1}`, `${m.title}\n${m.text ?? ""}`]));
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
      keywords: groundedTerms(t.keywords, t.sources.map((r) => textOf.get(r.trim()) ?? "").join("\n")),
      importance: t.importance,
      material_ids: t.sources.map((s) => refs.get(s.trim())).filter((x): x is string => Boolean(x)),
    });
  }
  return { topics, summary: out.course_summary };
}

/** Key terms spelt as the sources spell them; ones the sources never use are dropped unless that leaves too few. */
function groundedTerms(terms: string[], sources: string): string[] {
  if (!sources.trim()) return terms.slice(0, 8);
  const checked = checkKeywords(terms, sources, { max: 8 });
  return checked.length >= Math.min(3, terms.length) ? checked : terms.map((t) => repairTerm(t, sources)).filter(Boolean).slice(0, 8);
}

const CONTEXT_SECTION = /^(introduction( and motivation)?|motivation|background|conclusions?|concluding remarks|summary( and conclusions?)?|discussion and conclusions?|closing remarks|outlook)$/i;

/** Offline structuring: one branch per material, subtopics from detected headings. */
export function heuristicTopics(materials: Material[]): NewTopic[] {
  const topics: NewTopic[] = [];
  materials.forEach((m, i) => {
    const ref = `M${i}`;
    const text = m.text ?? "";
    const sections = studySections(text).filter((s) => s.heading);
    // Transcripts have no headings: their topics come from the material's digest instead.
    const digest = m.digest ?? (sections.length < 2 && text.trim() ? offlineDigest(text) : null);
    // One "#" heading at the top is the document's title; several are its sections (notes in Markdown).
    const tops = sections.filter((s) => s.level === 0).length;
    const titled = tops === 1 && sections[0]?.level === 0;
    const levelOf = (s: (typeof sections)[number]) => (titled ? (s.level ?? 1) : (s.level ?? 1) + (tops ? 1 : 0));
    const mend = headingRepairer(text);
    // A file name ("abs2024") says less than the document's own title.
    const own = titled ? sections[0].heading : undefined;
    topics.push({
      ref,
      parent_ref: null,
      title: own && !/\s/.test(m.title) ? clipWords(mend(own), 80) : m.title,
      summary: digest?.summary || firstSentences(text, 2) || `${MATERIAL_KIND_LABELS[m.kind]} for this course.`,
      keywords: digest?.keywords.slice(0, 8) ?? topKeywords(text, 6),
      material_ids: [m.id],
      importance: m.kind === "sample_exam" ? 3 : 2,
    });
    if (sections.length < 2 && digest?.topics.length) {
      digest.topics.slice(0, 15).forEach((t, j) => {
        const tref = `${ref}.d${j}`;
        topics.push({ ref: tref, parent_ref: ref, title: truncate(t.title, 60), summary: t.summary, keywords: topKeywords(`${t.title} ${t.summary}`, 6), material_ids: [m.id], importance: 2 });
        (t.subtopics ?? []).forEach((st, k) =>
          topics.push({ ref: `${tref}.${k}`, parent_ref: tref, title: truncate(st.title, 60), summary: st.summary, keywords: topKeywords(`${st.title} ${st.summary}`, 6), material_ids: [m.id], importance: 2 }),
        );
      });
      return;
    }
    const seen = new Set<string>();
    // Subsections go under their section ("2.1" under "2", "###" under "##"), two levels at most.
    const open: { level: number; ref: string }[] = [];
    for (const s of sections) {
      const key = s.heading.toLowerCase();
      // The document's own title is the branch, not a topic in it.
      // An introduction or conclusion frames the paper's topics rather than being one.
      if ((titled && s === sections[0]) || CONTEXT_SECTION.test(s.heading) || seen.has(key) || seen.size >= 25) continue;
      seen.add(key);
      const level = levelOf(s);
      while (open.length && open[open.length - 1].level >= level) open.pop();
      const parent = open.length && open.length < 2 ? open[open.length - 1].ref : open.length >= 2 ? open[1].ref : ref;
      const tref = `${ref}.${seen.size}`;
      if (open.length < 2) open.push({ level, ref: tref });
      topics.push({
        ref: tref,
        parent_ref: parent,
        title: clipWords(mend(s.heading), 60),
        summary: firstSentences(s.body, 2),
        keywords: checkKeywords(topKeywords(`${s.heading} ${s.body}`, 10), `${s.heading} ${s.body}`, { strict: true, max: 6 }),
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
