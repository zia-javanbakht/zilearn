import { z } from "zod";
import { aiEnabled, generateStructured, generateText } from "./ai";
import { excerptsFor } from "./kb";
import { buildTree, flattenTree, getCourse, getTopic, listMaterials, listTopics } from "./store";
import { truncate } from "./text";
import {
  DEPTH_LEVELS,
  MASTERY_LABELS,
  type Course,
  type ExamGrade,
  type ExamQuestion,
  type PodcastSegment,
  type TopicNode,
} from "./types";
import { newId } from "./db";

/* ---------------- Scope ---------------- */

export type Scope = { kind: "course" } | { kind: "topic"; topicId: string } | { kind: "weak" };

export function parseScope(v: unknown): Scope {
  const s = v as Partial<{ kind: string; topicId: string }>;
  if (s?.kind === "topic" && typeof s.topicId === "string") return { kind: "topic", topicId: s.topicId };
  if (s?.kind === "weak") return { kind: "weak" };
  return { kind: "course" };
}

export interface ScopeContext {
  course: Course;
  label: string;
  nodes: TopicNode[]; // every topic in scope (flattened)
  outline: string;
  sources: string;
}

const WEIGHT = { dont_know: 3, familiar: 2, know: 1 } as const;

export function resolveScope(courseId: string, scope: Scope, sourceBudget = 120_000): ScopeContext {
  const course = getCourse(courseId);
  if (!course) throw new Error("Course not found");
  const roots = buildTree(listTopics(courseId));
  let nodes = flattenTree(roots);
  let label = "Whole course";
  let outlineRoots = roots;

  if (scope.kind === "topic") {
    const root = nodes.find((n) => n.id === scope.topicId);
    if (!root) throw new Error("Topic not found");
    nodes = flattenTree([root]);
    outlineRoots = [root];
    label = root.title;
  } else if (scope.kind === "weak") {
    const weak = nodes.filter((n) => !n.children.length && n.effective_mastery !== "know");
    if (weak.length) nodes = weak;
    label = "Weak topics";
  }

  const ids = new Set(nodes.map((n) => n.id));
  const outline = renderOutline(outlineRoots, ids);

  let sources = "";
  if (nodes.length === 0 || (scope.kind === "course" && fullTextFits(courseId, sourceBudget))) {
    sources = listMaterials(courseId, true)
      .filter((m) => m.text)
      .map((m) => `<material title="${m.title.replace(/"/g, "'")}" kind="${m.kind}">\n${m.text}\n</material>`)
      .join("\n\n");
  } else {
    const per = Math.max(1500, Math.floor(sourceBudget / Math.max(1, nodes.length)));
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const n of nodes) {
      for (const ex of excerptsFor(courseId, `${n.title} ${n.keywords.join(" ")}`, per, n.material_ids)) {
        if (seen.has(ex)) continue;
        seen.add(ex);
        parts.push(ex);
      }
    }
    sources = truncate(parts.join("\n\n---\n\n"), sourceBudget);
  }
  return { course, label, nodes, outline, sources };
}

function fullTextFits(courseId: string, budget: number) {
  return listMaterials(courseId, true).reduce((s, m) => s + (m.text?.length ?? 0), 0) <= budget;
}

function renderOutline(roots: TopicNode[], include: Set<string>, depth = 0): string {
  const lines: string[] = [];
  for (const n of roots) {
    const inSubtree = include.has(n.id) || flattenTree(n.children).some((c) => include.has(c.id));
    if (!inSubtree) continue;
    const mark = n.effective_mastery ? ` [student: ${MASTERY_LABELS[n.effective_mastery]}]` : "";
    lines.push(`${"  ".repeat(depth)}- ${n.title}${mark}: ${n.summary}`);
    const sub = renderOutline(n.children, include, depth + 1);
    if (sub) lines.push(sub);
  }
  return lines.join("\n");
}

/* ---------------- Lessons (one topic at one depth) ---------------- */

export async function generateLesson(topicId: string, depth: number): Promise<{ content: string; by: "claude" | "heuristic" }> {
  const topic = getTopic(topicId);
  if (!topic) throw new Error("Topic not found");
  const course = getCourse(topic.course_id)!;
  const level = DEPTH_LEVELS[Math.min(4, Math.max(1, depth)) - 1];
  const excerpts = excerptsFor(topic.course_id, `${topic.title} ${topic.keywords.join(" ")}`, 20000, topic.material_ids);

  if (!aiEnabled()) {
    const body = [
      `## ${topic.title} - pass ${depth}: ${level.name}`,
      `**Goal:** ${level.goal}`,
      topic.summary,
      topic.keywords.length ? `**Key terms:** ${topic.keywords.join(", ")}` : "",
      "### From your materials",
      ...(excerpts.length ? excerpts.slice(0, 4).map((e) => "> " + truncate(e, 1200).replace(/\n/g, "\n> ")) : ["_No matching excerpts found._"]),
      "### Check yourself",
      `- Can you explain **${topic.title}** in two sentences without notes?`,
      depth >= 2 ? "- How does it connect to the topics around it?" : "- What are the key terms and what do they mean?",
      depth >= 3 ? "- Solve one problem that uses it, then check against your sources." : "",
    ];
    return { content: body.filter(Boolean).join("\n\n"), by: "heuristic" };
  }

  const content = await generateText({
    prompt: `Course: ${course.name}
Topic: ${topic.title}
Topic summary: ${topic.summary}
Key terms: ${topic.keywords.join(", ")}

Excerpts from the student's own materials:
${excerpts.join("\n\n---\n\n") || "(none found)"}

The student is studying this topic progressively. This is pass ${depth} of up to 4, at the "${level.name}" level: ${level.goal}
Earlier passes covered the shallower levels; later passes go deeper, so do not cover everything now.

Write the lesson for this pass in Markdown:
- Start with a 2-3 sentence "Where this fits" orientation.
- Teach the content at exactly this depth. Use examples, and LaTeX ($...$) for maths where relevant.
- You may include one small Mermaid diagram in a \`\`\`mermaid block if it genuinely helps.
- Point to which of the student's materials to look at (by title) when useful.
- End with "Check yourself": 3-5 questions appropriate to this level, with brief answers in a collapsed <details> block.`,
  });
  return { content, by: "claude" };
}

/* ---------------- Mock exams ---------------- */

const ExamSchema = z.object({
  title: z.string(),
  questions: z.array(
    z.object({
      type: z.enum(["mcq", "short", "long"]),
      topic: z.string().describe("Title of the topic tested, copied from the outline"),
      prompt: z.string().describe("Question text in Markdown"),
      options: z.array(z.string()).describe("4 options for mcq, empty otherwise"),
      answer_index: z.number().int().nullable().describe("0-based correct option for mcq, null otherwise"),
      model_answer: z.string().describe("Model answer / marking guide"),
      marks: z.number().int(),
    }),
  ),
});

export interface ExamOptions {
  scope: Scope;
  questionCount: number;
  mix: { mcq: number; short: number; long: number }; // relative weights
  durationMinutes: number;
}

export async function generateExam(courseId: string, opts: ExamOptions) {
  const ctx = resolveScope(courseId, opts.scope, 100_000);
  const leaves = ctx.nodes.filter((n) => !n.children.length);
  const pool = leaves.length ? leaves : ctx.nodes;
  if (!pool.length) throw new Error("Build the brainmap first so there are topics to examine.");
  const count = Math.min(40, Math.max(1, opts.questionCount));
  const totalW = opts.mix.mcq + opts.mix.short + opts.mix.long || 1;
  const nMcq = Math.round((count * opts.mix.mcq) / totalW);
  const nLong = Math.round((count * opts.mix.long) / totalW);
  const nShort = Math.max(0, count - nMcq - nLong);

  const sampleExams = listMaterials(courseId, true).filter((m) => m.kind === "sample_exam" && m.text);
  const byTitle = new Map(pool.map((n) => [n.title.toLowerCase(), n]));

  if (aiEnabled()) {
    const out = await generateStructured({
      schema: ExamSchema,
      effort: "medium",
      prompt: `Write a mock exam for the course "${ctx.course.name}" (scope: ${ctx.label}).

Topic outline (with the student's self-assessment):
${ctx.outline}

${sampleExams.length ? `Sample exams from this course - match their style, difficulty and question formats:\n${sampleExams.map((m) => `<sample_exam title="${m.title}">\n${truncate(m.text!, 30000)}\n</sample_exam>`).join("\n")}\n` : ""}
Source material:
${ctx.sources}

Requirements:
- Exactly ${nMcq} multiple-choice (4 options, one correct), ${nShort} short-answer and ${nLong} long-answer questions.
- Weight towards topics the student marked "Don't know anything" or "Familiar", but cover the scope.
- Target the course's required level (${DEPTH_LEVELS[ctx.course.target_level - 1].name}); include some application questions.
- Marks: mcq 1, short 2-5, long 8-15. Give a precise marking guide in model_answer.
- Questions must be answerable from the course content. Plausible distractors for MCQs.`,
    });
    const questions: ExamQuestion[] = out.questions.map((q) => {
      const node = byTitle.get(q.topic.toLowerCase()) ?? pool.find((n) => q.topic.toLowerCase().includes(n.title.toLowerCase()));
      const mcq = q.type === "mcq" && q.options.length >= 2;
      return {
        id: newId(),
        type: mcq ? "mcq" : q.type === "mcq" ? "short" : q.type,
        topic_id: node?.id ?? null,
        topic_title: node?.title ?? q.topic,
        prompt: q.prompt,
        options: mcq ? q.options : [],
        answer_index: mcq ? Math.min(q.options.length - 1, Math.max(0, q.answer_index ?? 0)) : null,
        model_answer: q.model_answer,
        marks: Math.max(1, q.marks),
      };
    });
    return { title: out.title || `Mock exam: ${ctx.label}`, questions, by: "claude" as const };
  }

  // Offline: build questions from topic summaries.
  const weighted = pool.flatMap((n) => Array(WEIGHT[n.effective_mastery ?? "dont_know"]).fill(n) as TopicNode[]);
  const pick = () => weighted[Math.floor(Math.random() * weighted.length)];
  const questions: ExamQuestion[] = [];
  for (let i = 0; i < nMcq; i++) {
    const n = pick();
    const others = shuffle(pool.filter((p) => p.id !== n.id)).slice(0, 3);
    if (!n.summary || others.length < 1) {
      questions.push(shortQ(n, 2));
      continue;
    }
    const options = shuffle([n, ...others]);
    questions.push({
      id: newId(),
      type: "mcq",
      topic_id: n.id,
      topic_title: n.title,
      prompt: `Which topic does this describe?\n\n> ${blank(n.summary, n.title)}`,
      options: options.map((o) => o.title),
      answer_index: options.indexOf(n),
      model_answer: n.title,
      marks: 1,
    });
  }
  for (let i = 0; i < nShort; i++) questions.push(shortQ(pick(), 3));
  for (let i = 0; i < nLong; i++) {
    const n = pick();
    questions.push({
      id: newId(),
      type: "long",
      topic_id: n.id,
      topic_title: n.title,
      prompt: `Discuss **${n.title}** in depth: define it, explain how it works, give an example, and relate it to at least one other topic in the course.`,
      options: [],
      answer_index: null,
      model_answer: `${n.summary}\n\nKey terms to cover: ${n.keywords.join(", ")}`,
      marks: 10,
    });
  }
  return { title: `Mock exam: ${ctx.label}`, questions, by: "heuristic" as const };
}

function shortQ(n: TopicNode, marks: number): ExamQuestion {
  return {
    id: newId(),
    type: "short",
    topic_id: n.id,
    topic_title: n.title,
    prompt: `Briefly explain **${n.title}**${n.keywords.length ? ` (mention: ${n.keywords.slice(0, 3).join(", ")})` : ""}.`,
    options: [],
    answer_index: null,
    model_answer: n.summary || n.keywords.join(", "),
    marks,
  };
}

function blank(summary: string, title: string) {
  const words = title.split(/\s+/).filter((w) => w.length > 3);
  let s = summary;
  for (const w of words) s = s.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "____");
  return s;
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const GradeSchema = z.object({
  grades: z.array(z.object({ question_id: z.string(), score: z.number(), feedback: z.string() })),
});

/** Grade an attempt. MCQs are marked locally; written answers by Claude (or left for self-marking offline). */
export async function gradeExam(
  questions: ExamQuestion[],
  answers: Record<string, string>,
  selfMarks: Record<string, number> = {},
): Promise<ExamGrade[]> {
  const grades = new Map<string, ExamGrade>();
  const written: ExamQuestion[] = [];
  for (const q of questions) {
    const a = (answers[q.id] ?? "").trim();
    if (q.type === "mcq") {
      const right = a !== "" && Number(a) === q.answer_index;
      grades.set(q.id, {
        question_id: q.id,
        score: right ? q.marks : 0,
        max: q.marks,
        feedback: right ? "Correct." : `Correct answer: ${q.options[q.answer_index ?? 0]}`,
      });
    } else if (!a) {
      grades.set(q.id, { question_id: q.id, score: 0, max: q.marks, feedback: "No answer given." });
    } else if (q.id in selfMarks) {
      grades.set(q.id, { question_id: q.id, score: clamp(selfMarks[q.id], 0, q.marks), max: q.marks, feedback: "Self-marked against the model answer." });
    } else written.push(q);
  }

  if (written.length && aiEnabled()) {
    const out = await generateStructured({
      schema: GradeSchema,
      effort: "low",
      prompt: `Mark these exam answers strictly but fairly against the marking guide. Award partial credit. Feedback: 1-3 sentences saying what was missing or wrong and how to improve.

${written
  .map(
    (q) => `<question id="${q.id}" marks="${q.marks}">
<prompt>${q.prompt}</prompt>
<marking_guide>${q.model_answer}</marking_guide>
<student_answer>${answers[q.id]}</student_answer>
</question>`,
  )
  .join("\n")}`,
    });
    for (const g of out.grades) {
      const q = written.find((w) => w.id === g.question_id);
      if (q) grades.set(q.id, { question_id: q.id, score: clamp(g.score, 0, q.marks), max: q.marks, feedback: g.feedback });
    }
  }
  for (const q of written) {
    if (!grades.has(q.id)) grades.set(q.id, { question_id: q.id, score: 0, max: q.marks, feedback: "Needs marking: compare with the model answer and enter your mark." });
  }
  return questions.map((q) => grades.get(q.id)!);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));
}

/* ---------------- Review notes ---------------- */

export async function generateNotes(courseId: string, scope: Scope, style: "concise" | "detailed" | "cheatsheet") {
  const ctx = resolveScope(courseId, scope);
  if (!ctx.nodes.length) throw new Error("Build the brainmap first.");
  if (!aiEnabled()) {
    const lines = [`# Review notes: ${ctx.course.name} - ${ctx.label}`, ""];
    const roots = buildTree(listTopics(courseId));
    const ids = new Set(ctx.nodes.map((n) => n.id));
    const walk = (ns: TopicNode[], depth: number) => {
      for (const n of ns) {
        const inside = ids.has(n.id) || flattenTree(n.children).some((c) => ids.has(c.id));
        if (!inside) continue;
        lines.push(`${"#".repeat(Math.min(6, depth + 2))} ${n.title}`, "", n.summary, "");
        if (n.keywords.length) lines.push(`**Key terms:** ${n.keywords.join(", ")}`, "");
        if (!n.children.length && style !== "cheatsheet") {
          const ex = excerptsFor(courseId, `${n.title} ${n.keywords.join(" ")}`, 1500, n.material_ids)[0];
          if (ex) lines.push("> " + truncate(ex, 700).replace(/\n/g, "\n> "), "");
        }
        walk(n.children, depth + 1);
      }
    };
    walk(roots, 0);
    return { title: `${ctx.label} - ${style}`, scope: ctx.label, content: lines.join("\n"), by: "heuristic" as const };
  }
  const styleGuide = {
    concise: "Concise revision notes: the essential definitions, results and how ideas connect. Around 1 page per major branch.",
    detailed: "Detailed study notes: full explanations, worked examples, common mistakes, and links between topics.",
    cheatsheet: "A dense one-to-two page cheat sheet: formulas, definitions, key facts, decision rules, in compact tables and bullet lists.",
  }[style];
  const content = await generateText({
    prompt: `Write review notes for "${ctx.course.name}" (scope: ${ctx.label}).

Style: ${styleGuide}

Topic outline with the student's self-assessment:
${ctx.outline}

Source material:
${ctx.sources}

Format as Markdown with headings that follow the outline. Use LaTeX ($...$) for maths, tables where they help, and at most two small Mermaid diagrams (\`\`\`mermaid) for structure or processes. Spend more space on topics the student doesn't know yet. Finish with a "Most likely exam questions" section.`,
  });
  return { title: `${ctx.label} - ${style}`, scope: ctx.label, content, by: "claude" as const };
}

/* ---------------- Podcasts ---------------- */

const PodcastSchema = z.object({
  title: z.string(),
  segments: z.array(z.object({ speaker: z.enum(["A", "B"]), text: z.string() })),
});

export async function generatePodcast(courseId: string, scope: Scope, minutes: number) {
  const ctx = resolveScope(courseId, scope);
  if (!ctx.nodes.length) throw new Error("Build the brainmap first.");
  const hosts = { A: "Alex", B: "Sam" };
  const words = Math.round(Math.min(40, Math.max(3, minutes)) * 150);
  if (aiEnabled()) {
    const out = await generateStructured({
      schema: PodcastSchema,
      effort: "medium",
      maxTokens: 32000,
      prompt: `Write a study podcast episode for a student taking "${ctx.course.name}" (scope: ${ctx.label}).

Two hosts: ${hosts.A} (A, the explainer) and ${hosts.B} (B, a curious fellow student who asks the questions the listener would ask and checks understanding).
Length: about ${words} words in total (~${minutes} minutes).

Topic outline with the student's self-assessment:
${ctx.outline}

Source material:
${ctx.sources}

Make it engaging and accurate: concrete examples and analogies, recap key points, call out common exam traps, and end with a quick-fire recap quiz. It will be read aloud by text-to-speech, so write maths in words, avoid symbols, Markdown, and stage directions. Keep each turn to 1-4 sentences.`,
    });
    return { title: out.title, scope: ctx.label, hosts, segments: out.segments.filter((s) => s.text.trim()), by: "claude" as const };
  }
  const segments: PodcastSegment[] = [
    { speaker: "A", text: `Welcome to your ziLearn study podcast on ${ctx.course.name}. Today: ${ctx.label}.` },
    { speaker: "B", text: "Great, let's go through it topic by topic." },
  ];
  for (const n of ctx.nodes.slice(0, 30)) {
    segments.push({ speaker: "B", text: `So what is ${n.title} about?` });
    segments.push({ speaker: "A", text: n.summary || `It covers ${n.keywords.join(", ")}.` });
    if (n.keywords.length) segments.push({ speaker: "B", text: `The key terms to remember are ${n.keywords.slice(0, 5).join(", ")}.` });
  }
  segments.push({ speaker: "A", text: "That's the overview. Rebuild this episode with an Anthropic API key for a full, conversational script." });
  return { title: `${ctx.label}: audio overview`, scope: ctx.label, hosts, segments, by: "heuristic" as const };
}
