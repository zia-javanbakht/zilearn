import { aiEnabled, generateText, UserError } from "./ai";
import { db, newId } from "./db";
import { ftsQuery } from "./kb";
import { getCourse } from "./store";
import { stem, tokenize, truncate } from "./text";

/**
 * "Ask this course": answers to the student's questions from the course's own materials, every claim
 * pointing at the passage it came from. Passages come from the full-text index the knowledge base
 * search uses. Without an AI the answer is the passages' best-matching sentences, still cited.
 */

export interface Citation {
  n: number; // the [n] used in the answer
  material_id: string;
  title: string;
  chunk_index: number;
  /** The passage, for showing beside the answer. */
  text: string;
}

export interface ChatMessage {
  id: string;
  course_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  generated_by: "claude" | "heuristic" | "student";
  created_at: string;
}

interface Passage extends Citation {
  kind: string;
}

/** Content words of a question (or the whole question's words when it has none, e.g. "What is J?"). */
function queryWords(q: string): string[] {
  const words = [...new Set(tokenize(q))];
  return words.length ? words : (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/**
 * The passages that best match the question, numbered from 1. A short follow-up ("why?", "and the
 * second one?") is searched together with the question before it.
 */
export function retrieve(courseId: string, question: string, previous: string | null, limit = 8): Passage[] {
  let words = queryWords(question);
  if (previous && words.length < 3) words = [...new Set([...words, ...queryWords(previous)])];
  const fq = ftsQuery(words.join(" "));
  if (!fq) return [];
  const rows = db()
    .prepare(
      `SELECT f.content, f.material_id, f.chunk_index, m.title, m.kind FROM chunks_fts f JOIN materials m ON m.id = f.material_id
       WHERE chunks_fts MATCH ? AND f.course_id = ? ORDER BY bm25(chunks_fts) LIMIT ?`,
    )
    .all(fq, courseId, limit * 3) as { content: string; material_id: string; chunk_index: number; title: string; kind: string }[];
  // At most three passages from one material, so one long document doesn't crowd out the rest.
  const per = new Map<string, number>();
  const out: Passage[] = [];
  for (const r of rows) {
    const k = per.get(r.material_id) ?? 0;
    if (k >= 3 || out.length >= limit) continue;
    per.set(r.material_id, k + 1);
    // The first chunk starts with the material's title, indexed with the text.
    const text = (r.chunk_index === 0 ? r.content.replace(/^.*\n/, "") : r.content).trim();
    if (text) out.push({ n: out.length + 1, material_id: r.material_id, title: r.title, kind: r.kind, chunk_index: r.chunk_index, text });
  }
  return out;
}

/**
 * Sentences of a passage. Headings and table rows are left out, list items are sentences of their own,
 * and a display formula stays with the sentence that introduces it.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    let buf = "";
    let header: string[] | null = null;
    const flush = () => {
      // A recording's timestamps ("[05:05]") start a new sentence too.
      if (buf) out.push(...buf.split(/(?<=[.!?])\s+(?=[A-Z(“"]|\$(?!\$))|\s+(?=\[\d{1,2}:\d{2}(?::\d{2})?\])/));
      buf = "";
    };
    for (const raw of para.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (/^#{1,6}\s/.test(line)) {
        flush();
        continue;
      }
      // A table row reads as "Header: value; Header: value".
      if (line.startsWith("|")) {
        flush();
        const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
        if (!header) header = cells;
        else out.push(cells.map((c, i) => (header![i] ? `${header![i]}: ${c}` : c)).join("; "));
        continue;
      }
      header = null;
      if (/^([-*+]|\d+[.)])\s/.test(line)) {
        flush();
        buf = line.replace(/^([-*+]|\d+[.)])\s+/, "");
        flush();
        continue;
      }
      buf += (buf ? " " : "") + line;
    }
    flush();
  }
  return out.map((x) => x.trim()).filter((x) => x.length >= 20 && x.length <= 800);
}

/**
 * The offline answer: the sentences that share the most (and the rarest) words with the question,
 * each cited, in the order of their passages. Null when nothing in the passages is about the question.
 */
// Words that say what kind of answer is wanted, not what it is about.
const ASKING = new Set("happen happens mean means meaning work works explain describe difference differ give tell find show example important matter matters".split(" ").map(stem));

export function extractiveAnswer(question: string, passages: Passage[], max = 4): string | null {
  const q = new Set(tokenize(question).map(stem).filter((w) => !ASKING.has(w)));
  if (!q.size || !passages.length) return null;
  const split = new Map(passages.map((p) => [p.n, sentences(p.text)]));
  const cands = passages.flatMap((p) => split.get(p.n)!.map((s, i) => ({ p, i, s, stems: new Set(tokenize(s).map(stem)) })));
  // A word found in few sentences says more about which sentence answers the question.
  const df = new Map<string, number>();
  for (const c of cands) for (const w of c.stems) if (q.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  const defining = /^(what|define|definition)\b/i.test(question.trim());
  const scored = cands
    .map((c) => {
      let score = 0;
      for (const w of q) if (c.stems.has(w)) score += 1 + Math.log(cands.length / (df.get(w) ?? 1));
      if (defining && /\b(is|are) (defined as|called|known as|the|a|an)\b|\bwhere\b|:=|≡/i.test(c.s)) score *= 1.3;
      return { ...c, score };
    })
    .filter((c) => c.score > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((c) => c.score));
  // Only sentences close to the best one, so a stray shared word doesn't make it in.
  const picked = scored
    .filter((c) => c.score >= best * 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.p.n - b.p.n || a.i - b.i);
  const lines: string[] = [];
  const used = new Set<string>();
  for (const c of picked) {
    const key = `${c.p.n}:${c.i}`;
    if (used.has(key)) continue;
    used.add(key);
    // "This is how...", "It...": the sentence before says what "this" is.
    const prev = split.get(c.p.n)![c.i - 1];
    const lead = /^(this|these|it|its|they|such|here|that)\b/i.test(c.s) && prev && !used.has(`${c.p.n}:${c.i - 1}`) ? `${prev} ` : "";
    if (lead) used.add(`${c.p.n}:${c.i - 1}`);
    // A question in the material ("What's critical damping?") is answered by the sentence after it.
    const next = split.get(c.p.n)![c.i + 1];
    const tail = c.s.endsWith("?") && next && !used.has(`${c.p.n}:${c.i + 1}`) ? ` ${next}` : "";
    if (tail) used.add(`${c.p.n}:${c.i + 1}`);
    lines.push(`- ${lead}${c.s}${tail} [${c.p.n}]`);
  }
  return lines.join("\n");
}

/** Keep only [n] markers that point at a passage; returns the cleaned text and the numbers used. */
export function checkCitations(text: string, count: number): { text: string; used: number[] } {
  const used = new Set<number>();
  // Maths is matched first and kept as it is: [0, 1] there is an interval, not two citations.
  const cleaned = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (all, list: string | undefined) => {
    if (list === undefined) return all;
    const nums: number[] = [];
    for (const part of list.split(/\s*,\s*/)) {
      const range = part.split(/\s*[–-]\s*/).map(Number);
      if (range.length === 2 && range[1] >= range[0] && range[1] - range[0] < 10) for (let k = range[0]; k <= range[1]; k++) nums.push(k);
      else nums.push(range[0]);
    }
    const ok = nums.filter((k) => k >= 1 && k <= count);
    // A mark for a passage that doesn't exist cites nothing: it goes.
    if (!ok.length) return "";
    ok.forEach((k) => used.add(k));
    return ok.map((k) => `[${k}]`).join("");
  });
  return { text: cleaned.replace(/[ \t]+([.,;:!?])/g, "$1"), used: [...used].sort((a, b) => a - b) };
}

export const NOT_FOUND =
  "I couldn't find anything about that in this course's materials. Try other words for it, or add the material that covers it.";

/** Answer a question from the course materials. History is the conversation so far, oldest first. */
export async function answerQuestion(
  courseId: string,
  question: string,
  history: Pick<ChatMessage, "role" | "content">[] = [],
): Promise<{ text: string; citations: Citation[]; by: "claude" | "heuristic" }> {
  const course = getCourse(courseId);
  if (!course) throw new UserError("Course not found");
  const previous = [...history].reverse().find((m) => m.role === "user")?.content ?? null;
  const passages = retrieve(courseId, question, previous, aiEnabled() ? 10 : 6);
  const cite = (used: number[]) => passages.filter((p) => used.includes(p.n)).map(({ kind: _k, ...c }) => ({ ...c, text: truncate(c.text, 1500) }));

  if (!aiEnabled()) {
    const text = extractiveAnswer(question, passages);
    if (!text) return { text: NOT_FOUND, citations: [], by: "heuristic" };
    const checked = checkCitations(text, passages.length);
    return { text: `From your materials, the closest passages say:\n\n${checked.text}`, citations: cite(checked.used), by: "heuristic" };
  }

  // Earlier answers' [n] marks pointed at earlier passages; left in, they'd be read as these ones.
  const recent = history.slice(-6).map((m) => `${m.role === "user" ? "Student" : "You"}: ${truncate(m.content.replace(/\s*\[\d+\]/g, ""), 1500)}`);
  const { text } = await generateText({
    effort: "low",
    maxTokens: 3000,
    prompt: `A student taking "${course.name}" asks a question about the course. Answer from the numbered passages of their course materials below.

${passages.length ? passages.map((p) => `<passage n="${p.n}" source="${p.title.replace(/"/g, "'")}">\n${p.text}\n</passage>`).join("\n\n") : "(No passage of the materials matches this question.)"}

${recent.length ? `The conversation so far:\n${recent.join("\n")}\n\n` : ""}Student's question: ${question}

How to answer:
- Base the answer on the passages. After each sentence that uses a passage, cite it as [n] (several: [1][3]). Cite only passages that say what the sentence says.
- If the passages don't answer the question, say so plainly in the first sentence. You may then add a short answer from general knowledge of the subject, marked "(general knowledge, not from your materials)" and with no citation.
- Be direct and brief: a few sentences or a short list, as long as the question needs and no longer. Use $...$ for maths.
- Output only the answer.`,
  });
  const checked = checkCitations(text.trim(), passages.length);
  return { text: checked.text || NOT_FOUND, citations: cite(checked.used), by: "claude" };
}

/* ---------------- Stored conversation ---------------- */

type Row = Omit<ChatMessage, "citations"> & { citations: string };

const parse = (r: Row): ChatMessage => ({ ...r, citations: JSON.parse(r.citations) as Citation[] });

export function listChat(courseId: string, limit = 200): ChatMessage[] {
  const rows = db()
    .prepare("SELECT * FROM (SELECT rowid AS seq, * FROM chat_messages WHERE course_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq")
    .all(courseId, limit) as (Row & { seq?: number })[];
  return rows.map(({ seq: _s, ...r }) => parse(r));
}

export function addChat(courseId: string, m: Pick<ChatMessage, "role" | "content" | "citations" | "generated_by">): ChatMessage {
  const id = newId();
  db()
    .prepare("INSERT INTO chat_messages (id, course_id, role, content, citations, generated_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, courseId, m.role, m.content, JSON.stringify(m.citations), m.generated_by);
  return parse(db().prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as Row);
}

export function clearChat(courseId: string) {
  db().prepare("DELETE FROM chat_messages WHERE course_id = ?").run(courseId);
}
