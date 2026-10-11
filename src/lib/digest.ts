import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { splitSections, stem, topKeywords, truncate } from "./text";
import { stripTimestamps } from "./transcript";
import { addTopic, getMaterial, listTopics, normTitle, setDigest } from "./store";
import type { Digest, DigestTopic, Material } from "./types";

/**
 * A digest of one material: a short summary, key terms, and its topics (two levels, with the
 * [mm:ss] where each starts in a recording). It shows under the material, draws that material's
 * own mindmap, and feeds the course brainmap. The AI writes it when available; offline it is
 * extracted from headings, or for transcripts from the most frequent phrases of each stretch.
 */

const RECORDING_KINDS = new Set(["youtube", "video", "audio_memo"]);
const MAX_AI_CHARS = 200_000;

/** Recordings are summarised by the AI on import; other materials keep the offline digest unless asked. */
export function wantsAiDigest(m: Pick<Material, "kind">): boolean {
  return aiEnabled() && RECORDING_KINDS.has(m.kind);
}

const TopicSchema = z.object({
  title: z.string().describe("Concise topic name, max ~6 words"),
  start: z.string().nullable().describe('Where it starts in the recording as "mm:ss" or "h:mm:ss" (from the [mm:ss] markers), or null'),
  summary: z.string().describe("1-2 sentences on what is said about it; maths in LaTeX ($...$)"),
});
const DigestSchema = z.object({
  summary: z.string().describe("3-5 sentence overview of the content for a student; maths in LaTeX ($...$)"),
  keywords: z.array(z.string()).describe("6-12 key terms, most important first"),
  topics: z
    .array(TopicSchema.extend({ subtopics: z.array(TopicSchema).describe("0-6 subtopics") }))
    .describe("3-10 main topics in the order they are covered"),
});

export async function makeDigest(m: Pick<Material, "title" | "kind" | "text">, useAi: boolean): Promise<Digest | null> {
  const text = (m.text ?? "").trim();
  if (!text) return null;
  if (useAi && aiEnabled()) {
    try {
      const out = await generateStructured({
        schema: DigestSchema,
        effort: "low",
        maxTokens: 8000,
        context: `<material title="${m.title.replace(/"/g, "'")}" kind="${m.kind}">\n${truncate(text, MAX_AI_CHARS)}\n</material>`,
        prompt:
          "Summarise this course material for a student's study map: an overview, the key terms, and the topics it covers in order with their subtopics. Keep only subject content (no greetings, logistics or small talk). Fix obvious speech-recognition errors in terms. Use the [mm:ss] markers, when present, for where each topic starts.",
      });
      const clean = (t: z.infer<typeof TopicSchema>): DigestTopic => ({ title: t.title.trim(), start: normStart(t.start), summary: t.summary.trim() });
      return {
        summary: out.summary.trim(),
        keywords: out.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 12),
        topics: out.topics.slice(0, 12).map((t) => ({ ...clean(t), subtopics: t.subtopics.slice(0, 8).map(clean) })),
        by: "ai",
      };
    } catch (err) {
      console.error("AI digest failed; using the offline one", err);
    }
  }
  return offlineDigest(text);
}

function normStart(s: string | null | undefined): string | null {
  const m = s?.match(/(\d{1,2}:)?\d{1,2}:\d{2}/);
  return m ? m[0] : null;
}

/** Give new or changed materials their offline digest at once (cheap), returning them with it. */
export function digestNow(materials: Material[]): Material[] {
  return materials.map((m) => {
    if (m.digest || !m.text?.trim()) return m;
    const digest = offlineDigest(m.text);
    setDigest(m.id, digest);
    return { ...m, digest };
  });
}

/** Replace the offline digest of recordings with an AI one (run after the response, it can take a while). */
export async function upgradeDigests(ids: string[]): Promise<void> {
  for (const id of ids) {
    const m = getMaterial(id);
    if (!m?.text?.trim() || m.digest?.by === "ai" || !wantsAiDigest(m)) continue;
    const digest = await makeDigest(m, true);
    // Skip if the text was edited meanwhile; that edit made its own digest.
    if (digest?.by === "ai" && getMaterial(id)?.text === m.text) setDigest(id, digest);
  }
}

/**
 * Add a material's topics to its course brainmap as a new branch (title = the material, children = its
 * digest topics), without rebuilding the map. Not marked hand-made, so a rebuild reorganises it.
 * Returns why it couldn't, or null.
 */
export function addBranch(m: Material): { topic_id: string } | { error: string } {
  const digest = m.digest ?? (m.text?.trim() ? offlineDigest(m.text) : null);
  if (!digest?.topics.length) return { error: "This item has no topics yet. Add or transcribe its text first." };
  const roots = listTopics(m.course_id).filter((t) => !t.parent_id);
  if (roots.some((t) => normTitle(t.title) === normTitle(m.title) || (t.material_ids.length === 1 && t.material_ids[0] === m.id)))
    return { error: `"${m.title}" is already a branch of the brainmap.` };
  const at = (s: string | null) => (s ? `[${s}] ` : "");
  const branch = addTopic(m.course_id, { title: m.title, summary: digest.summary, keywords: digest.keywords.slice(0, 8), material_ids: [m.id], manual: false });
  for (const t of digest.topics) {
    const child = addTopic(m.course_id, { title: t.title, summary: at(t.start) + t.summary, parent_id: branch.id, material_ids: [m.id], manual: false });
    for (const s of t.subtopics ?? []) addTopic(m.course_id, { title: s.title, summary: at(s.start) + s.summary, parent_id: child.id, material_ids: [m.id], manual: false });
  }
  return { topic_id: branch.id };
}

/**
 * After new text arrives (an import, a transcript, captions): give recordings their AI digest, then put
 * recordings and videos that aren't in the course brainmap yet into it as their own branch, so a
 * lecture's topics show up without a rebuild. Courses without a brainmap get them when it is built.
 */
export async function settleNewText(ids: string[]): Promise<void> {
  await upgradeDigests(ids);
  for (const id of ids) {
    const m = getMaterial(id);
    if (!m?.digest?.topics.length || !RECORDING_KINDS.has(m.kind)) continue;
    const topics = listTopics(m.course_id);
    if (!topics.length || topics.some((t) => t.material_ids.includes(m.id))) continue;
    addBranch(m);
  }
}

/* ---------------- Offline ---------------- */

const STAMP = /\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]/;

/** Text without LaTeX, so "\\eta \\nabla" isn't taken for a key term. */
const noMath = (s: string) => s.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\(.*?\\\)/g, " ");

export function offlineDigest(text: string): Digest {
  const plain = stripTimestamps(text);
  const terms = noMath(plain);
  const sections = splitSections(text).filter((s) => s.heading);
  let topics: DigestTopic[];
  if (sections.length >= 2) {
    topics = sections.slice(0, 15).map((s) => ({
      title: truncate(stripTimestamps(s.heading), 60),
      start: s.heading.match(STAMP)?.[1] ?? s.body.match(STAMP)?.[1] ?? null,
      summary: keySentences(stripTimestamps(s.body), 1),
    }));
  } else {
    const segs = segments(text).map((seg) => ({ seg, body: stripTimestamps(seg) }));
    const spread = phraseSpread(segs.map((x) => noMath(x.body)));
    topics = segs.map(({ seg, body }) => ({ title: titleFor(noMath(body), spread, segs.length), start: seg.match(STAMP)?.[1] ?? null, summary: keySentences(body, 1) }));
    // Neighbouring stretches about the same thing become one topic.
    topics = topics.filter((t, i) => i === 0 || t.title !== topics[i - 1].title);
  }
  const phrases = topPhrases(terms, 6).filter((p) => p.count >= 2).map((p) => p.phrase);
  const covered = new Set(phrases.flatMap((p) => p.split(" ").map(stem)));
  const keywords = [...phrases, ...topKeywords(terms, 12).filter((w) => !covered.has(stem(w)))].slice(0, 10);
  return { summary: keySentences(plain, 3), keywords, topics: topics.filter((t) => t.title), by: "offline" };
}

/** Split a long text into 2-10 stretches of similar length on paragraph boundaries. */
function segments(text: string): string[] {
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim());
  // About one topic per 1500 characters (two to three minutes of speech), at most ten.
  const n = Math.max(1, Math.min(10, Math.round(text.length / 1500)));
  if (n === 1 || paras.length < 2) return [text];
  const target = text.length / n;
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    cur += (cur ? "\n\n" : "") + p;
    if (cur.length >= target) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.length ? (out[out.length - 1] += "\n\n" + cur) : out.push(cur);
  return out;
}

const WORD = /[A-Za-z][A-Za-z0-9\-']*/g;
const STOP = new Set(tokensOf("the a an and or of to in on for with is are was were be been this that these those it its as at by from we you they i so then than which what when where how can could will would should may might do does did not no yes just also very really okay ok right um uh like going gonna want know think say said get got let let's make one two lot thing things kind sort today here there now talk talking look looking see mean basically actually we're you're it's that's there's here's i'm don't can't bit maybe against between through into over under about after before during each every all some any more most other such only own same both few written using uses used called means"));

function tokensOf(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Most frequent two- and three-word phrases (e.g. "gradient descent"), as written in the text. */
export function topPhrases(text: string, n: number): { phrase: string; count: number }[] {
  const counts = new Map<string, { phrase: string; count: number }>();
  for (const sentence of text.split(/[.!?;:\n]+/)) {
    const words = sentence.match(WORD) ?? [];
    for (let len = 2; len <= 3; len++) {
      for (let i = 0; i + len <= words.length; i++) {
        const gram = words.slice(i, i + len);
        const lower = gram.map((w) => w.toLowerCase());
        if (lower.some((w) => STOP.has(w) || (w.length < 3 && !/\d/.test(w)))) continue;
        const key = lower.map(stem).join(" ");
        const c = counts.get(key);
        if (c) c.count++;
        else counts.set(key, { phrase: lower.join(" "), count: 1 });
      }
    }
  }
  const all = [...counts.values()].sort((a, b) => b.count - a.count || a.phrase.split(" ").length - b.phrase.split(" ").length);
  const out: { phrase: string; count: number }[] = [];
  for (const p of all) {
    // A phrase and its longer or shorter forms, or one sharing a word with a more frequent phrase
    // ("descent updates" after "gradient descent"), count once.
    const words = new Set(p.phrase.split(" ").map(stem));
    if (out.some((o) => o.phrase.split(" ").some((w) => words.has(stem(w))))) continue;
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

/** In how many stretches each phrase occurs, so a stretch is named for what sets it apart. */
function phraseSpread(bodies: string[]): Map<string, number> {
  const spread = new Map<string, number>();
  for (const b of bodies) for (const p of topPhrases(b, 30)) spread.set(p.phrase, (spread.get(p.phrase) ?? 0) + 1);
  return spread;
}

function titleFor(text: string, spread: Map<string, number>, total: number): string {
  const best = topPhrases(text, 30)
    .filter((p) => p.count >= 2)
    .map((p) => ({ ...p, score: p.count * Math.log(1 + total / (spread.get(p.phrase) ?? 1)) }))
    .sort((a, b) => b.score - a.score)[0];
  // Without a repeated phrase, the single most frequent term; "Marks and gradient" style pairs read as noise.
  const title = best ? best.phrase : (topKeywords(text, 1)[0] ?? "");
  return title ? title[0].toUpperCase() + title.slice(1) : "";
}

/** The n sentences that best cover the text's frequent terms, in their original order. */
export function keySentences(raw: string, n: number): string {
  // Headings aren't sentences: left in, they'd run into the sentence after them ("Gradient Descent Gradient descent ...").
  const text = raw
    .replace(/^\s*#{1,6}\s+.*$/gm, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
    .trim();
  const sentences = (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [text]).map((s) => s.trim()).filter((s) => s.split(" ").length >= 6 && s.length <= 400);
  if (!sentences.length) return truncate(text.replace(/\s+/g, " ").trim(), 300);
  const weight = new Map(topKeywords(text, 25).map((w, i) => [stem(w), 25 - i]));
  const scored = sentences.map((s, i) => {
    const words = (s.toLowerCase().match(/[a-z][a-z0-9\-]+/g) ?? []).map(stem);
    const score = words.reduce((sum, w) => sum + (weight.get(w) ?? 0), 0) / Math.sqrt(words.length || 1);
    return { s, i, score };
  });
  const seen = new Set<string>();
  return scored
    .filter((x) => !seen.has(x.s.toLowerCase()) && seen.add(x.s.toLowerCase()))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(" ");
}
