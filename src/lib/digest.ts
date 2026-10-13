import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { proseLines, studySections, stem, topKeywords, truncate } from "./text";
import { headingRepairer } from "./headingRepair";
import { stripTimestamps } from "./transcript";
import { addTopic, getMaterial, listMaterials, listTopics, normTitle, setDigest, updateMaterial } from "./store";
import { checkKeywords, isGarbled, isWord, repairTerm, repairText } from "./textRepair";
import { abstractSentences, groundTerms, keywordMap, termLabel, type KeywordNode } from "./keywords";
import type { Digest, DigestTopic, Material } from "./types";

/**
 * A digest of one material: a short summary, its key terms, and its keyword map. The key terms come
 * first; the map is built from them (main terms with the terms that go with them, two levels), and each
 * term carries what the material itself says about it, quoted with its section or [mm:ss] time. It shows
 * under the material, where the student can edit the map, and the course brainmap is built from it. The
 * AI picks and organises the terms when available; offline they are extracted from the text. A material
 * without enough key terms falls back to its sections, or for transcripts the stretches of its talk.
 */

const RECORDING_KINDS = new Set(["youtube", "video", "audio_memo"]);
// A recording is summarised whole (its topics run its full length); a document up to the length of a
// long paper too, and past that its opening pages plus the headings of the rest, so every section
// still gets a topic while the cost stays down.
const MAX_AI_CHARS = 200_000;
const MAX_AI_DOC_CHARS = 120_000;

/** A long document cut to fit, with the headings of what was cut, so its later sections aren't lost. */
export function docExcerpt(text: string, max = MAX_AI_DOC_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max);
  const head = text.slice(0, cut > max * 0.9 ? cut : max);
  const rest = studySections(text.slice(head.length))
    .map((x) => x.heading)
    .filter(Boolean);
  return `${head}\n\n[The rest of the document is not shown. Its sections, in order: ${rest.length ? rest.join("; ") : "(no headings found)"}]`;
}

/** With an AI provider every material gets an AI digest after import: it reads the text in context. */
export function wantsAiDigest(): boolean {
  return aiEnabled();
}

const TermSchema = z.object({
  term: z.string().describe("The key term exactly as the material writes it (its acronym in brackets if it uses one), max ~6 words"),
  parent: z.string().nullable().describe("The main term this one belongs under, written exactly as that term; null for a main term"),
  note: z.string().describe("1-2 sentences of what the material says about this term, only from the material; maths in LaTeX ($...$)"),
  start: z.string().nullable().describe('In a recording, where it is first explained as "mm:ss" or "h:mm:ss" (from the [mm:ss] markers); otherwise null'),
});
const DigestSchema = z.object({
  summary: z.string().describe("3-5 sentence overview of the content for a student; maths in LaTeX ($...$)"),
  terms: z.array(TermSchema).describe("8-20 key terms: 4-8 main terms (parent null) in the order the material takes them up, each with the terms that belong under it"),
  corrections: z
    .array(
      z.object({
        wrong: z.string().describe("The misspelt word or words exactly as they appear in the text"),
        right: z.string().describe("The correct spelling"),
        context: z.string().describe("The wrong word with 2-4 words around it, copied exactly from the text, so the right place is fixed"),
      }),
    )
    .describe("Words the text extraction, OCR or speech recognition got wrong (broken ligatures like 'e ect' for 'effect', misread letters, misheard terms). Not style or grammar. Empty if none."),
});

export type Correction = z.infer<typeof DigestSchema>["corrections"][number];

export async function makeDigest(m: Pick<Material, "title" | "kind" | "text">, useAi: boolean): Promise<Digest | null> {
  return (await digestWithFixes(m, useAi))?.digest ?? null;
}

/** A digest, plus (from the AI) the words it found misspelt in the text. */
export async function digestWithFixes(m: Pick<Material, "title" | "kind" | "text">, useAi: boolean): Promise<{ digest: Digest; corrections: Correction[] } | null> {
  const text = (m.text ?? "").trim();
  if (!text) return null;
  if (useAi && aiEnabled()) {
    try {
      const recording = RECORDING_KINDS.has(m.kind);
      const out = await generateStructured({
        schema: DigestSchema,
        effort: "low",
        maxTokens: 8000,
        context: `<material title="${m.title.replace(/"/g, "'")}" kind="${m.kind}">\n${recording ? truncate(text, MAX_AI_CHARS) : docExcerpt(text)}\n</material>`,
        prompt: `Read this course material for a student's study map. Start from its key terms: the concepts, methods, models, quantities and named results it is about. Then organise them into a keyword map, and for each term say what the material says about it.

- Key terms are terms the material itself uses, written as it writes them. Not the journal, authors, affiliations, funding, references, figure or table numbers, slide navigation, or a generic word on its own (model, results, study, method, analysis, element).
- 4-8 main terms in the order the material takes them up; every other term goes under the main term it belongs to (its parent is that main term, written exactly the same). An idea belongs to one term.
- Each note says only what the material says about that term, for the case it says it (a result found for one case is not stated for another).
- Use the [mm:ss] markers, when present, for where each term is first explained.
- The summary is a 3-5 sentence overview of the material for a student.

The text came from ${recording ? "speech recognition" : "PDF or document extraction, sometimes OCR"} and can be damaged: letters lost where a font joined ff/fi/fl ("e ect", "di erent", "rst" for "first"), words split or run together, misread letters ("rn" for "m", "1" for "l"), misheard technical terms. Read it in context:
- Write every term, note and the summary with correct spelling, as the subject spells it.
- List each damaged word you notice under corrections, with a few words of exact context. Don't list style, grammar or British/American spelling.`,
      });
      // Terms the text never uses are dropped; each kept one gets the material's own sentences about it.
      const nodes = groundTerms(
        text,
        out.terms.map((t) => ({ term: repairTerm(t.term, text), parent: t.parent ? repairTerm(t.parent, text) : null, note: t.note, start: normStart(t.start) })),
      );
      if (nodes.length >= 2)
        return {
          digest: { summary: out.summary.trim(), ...fromKeywords(nodes), by: "ai", basis: "keywords" },
          corrections: out.corrections ?? [],
        };
      console.warn("AI key terms not found in the text; using the offline keyword map");
    } catch (err) {
      console.error("AI digest failed; using the offline one", err);
    }
  }
  return { digest: offlineDigest(text), corrections: [] };
}

/**
 * Apply the AI's spelling corrections to the text, carefully: a fix must be a small change of spelling
 * (not a rewrite), and a real word is only changed in the place the AI quoted ("form" -> "from" there,
 * not everywhere). Returns the text and the fixes made.
 */
export function applyCorrections(text: string, corrections: Correction[]): { text: string; applied: string[] } {
  const applied: string[] = [];
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const c of corrections) {
    const wrong = c.wrong?.trim();
    const right = c.right?.trim();
    if (!wrong || !right || wrong === right || wrong.length > 40 || right.length > 40 || /\n/.test(wrong + right)) continue;
    const a = squash(wrong);
    const b = squash(right);
    if (!b || distance(a, b) > Math.max(2, Math.ceil(Math.max(a.length, b.length) * 0.4))) continue;
    const esc = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const word = new RegExp(`(?<![A-Za-z])${esc}(?![A-Za-z])`, "g");
    const ctx = c.context?.trim();
    const at = ctx ? text.replace(/\s+/g, " ").indexOf(ctx.replace(/\s+/g, " ")) : -1;
    let next = text;
    if (ctx && at >= 0 && ctx.includes(wrong)) {
      // Fix it inside the quoted context only (found again in the original spacing).
      const ctxRe = new RegExp(ctx.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
      next = text.replace(ctxRe, (hit) => hit.replace(new RegExp(esc), right));
    } else if (!wrong.split(/\s+/).every((w) => isWord(w.toLowerCase()))) {
      // Not a real word anywhere: safe to fix every occurrence.
      next = text.replace(word, right);
    }
    if (next !== text) {
      text = next;
      applied.push(`"${wrong}" → "${right}"`);
    }
  }
  return { text, applied };
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function normStart(s: string | null | undefined): string | null {
  const m = s?.match(/(\d{1,2}:)?\d{1,2}:\d{2}/);
  return m ? m[0] : null;
}

/**
 * Give new or changed materials their offline digest at once (cheap), returning them with it. A digest from
 * before keyword maps is made again as a keyword map; one already a keyword map, or edited by the student, is kept.
 */
export function digestNow(materials: Material[]): Material[] {
  return materials.map((m) => {
    // A digest from before keyword maps (no basis, the AI's too) is remade from key terms; one the student edited stays.
    if (!m.text?.trim() || (m.digest && (m.digest.basis || m.digest.edited))) return m;
    const fresh = offlineDigest(m.text);
    // The AI's overview of the item is still good; its old topic list isn't the map.
    const digest = m.digest?.by === "ai" && m.digest.summary ? { ...fresh, summary: m.digest.summary } : fresh;
    setDigest(m.id, digest);
    return { ...m, digest };
  });
}

/**
 * A course's materials as the course page lists them (text cut short), with any digest saved before keyword
 * maps made again as one first, so the Materials tab shows the map the brainmap is built from.
 */
export function listMaterialsWithMaps(courseId: string): Material[] {
  const list = listMaterials(courseId);
  const stale = list.filter((m) => m.digest && !m.digest.basis && !m.digest.edited).map((m) => getMaterial(m.id)!);
  if (!stale.length) return list;
  const fresh = new Map(digestNow(stale).map((m) => [m.id, m.digest]));
  return list.map((m) => (fresh.has(m.id) ? { ...m, digest: fresh.get(m.id)! } : m));
}

/** Replace the offline digest with an AI one (run after the response, it can take a while), fixing the typos it finds. */
export async function upgradeDigests(ids: string[]): Promise<void> {
  for (const id of ids) {
    const m = getMaterial(id);
    // A map the student edited is theirs: only "Summarise again" replaces it.
    if (!m?.text?.trim() || m.digest?.by === "ai" || m.digest?.edited || !wantsAiDigest()) continue;
    const r = await digestWithFixes(m, true);
    // Skip if the text was edited meanwhile; that edit made its own digest.
    if (r?.digest.by !== "ai" || getMaterial(id)?.text !== m.text) continue;
    const { text, applied } = applyCorrections(m.text, r.corrections);
    if (applied.length) {
      const note = `Corrected ${applied.length} misspelt word${applied.length === 1 ? "" : "s"} from the extraction (e.g. ${applied.slice(0, 2).join(", ")}).`;
      updateMaterial(id, { text, note: m.note ? `${m.note} ${note}` : note });
    }
    setDigest(id, r.digest);
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

/** Topics and key terms of a digest from a keyword map: main terms with their terms under them. */
function fromKeywords(nodes: KeywordNode[]): Pick<Digest, "topics" | "keywords"> {
  const topic = (n: KeywordNode): DigestTopic => ({ title: termLabel(n.term, n.aliases), start: n.start, summary: n.note, evidence: n.evidence });
  const topics = nodes.slice(0, 12).map((n) => ({ ...topic(n), subtopics: n.children.slice(0, 8).map(topic) }));
  const keywords = [...nodes.map((n) => n.term), ...nodes.flatMap((n) => n.children.map((c) => c.term))].slice(0, 12);
  return { topics, keywords };
}

export function offlineDigest(raw: string): Digest {
  // Text saved before extraction repairs existed may still be broken ("e ect"); terms and summary use the repaired form.
  const text = repairText(raw).text;
  const plain = stripTimestamps(text);
  const summary = abstractSentences(text, 3) ?? keySentences(plain, 3);
  // Key terms first; the map is built from them.
  const nodes = keywordMap(text);
  if (nodes.length >= 2 && nodes.reduce((n, x) => n + 1 + x.children.length, 0) >= 4) return { summary, ...fromKeywords(nodes), by: "offline", basis: "keywords" };
  return { ...sectionDigest(text), summary };
}

/** Too few key terms to map (a short note, a chatty recording): the material's sections, or stretches of its talk. */
function sectionDigest(text: string): Digest {
  const plain = stripTimestamps(text);
  const terms = noMath(plain);
  const sections = studySections(text).filter((s) => s.heading);
  let topics: DigestTopic[];
  if (sections.length >= 2) {
    const mend = headingRepairer(text);
    topics = sections.slice(0, 15).map((s) => ({
      title: truncate(mend(stripTimestamps(s.heading)), 60),
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
  // Only terms the text really contains, in its own spelling, with no extraction fragments.
  const keywords = checkKeywords([...phrases, ...topKeywords(terms, 16).filter((w) => !covered.has(stem(w)))], terms, { strict: true, max: 10 });
  return { summary: keySentences(plain, 3), keywords, topics: topics.filter((t) => t.title), by: "offline", basis: "sections" };
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
const STOP = new Set(tokensOf("the a an and or of to in on for with is are was were be been this that these those it its as at by from we you they i so then than which what when where how can could will would should may might do does did not no yes just also very really okay ok right um uh like going gonna want know think say said get got let let's make one two lot thing things kind sort today here there now talk talking look looking see mean basically actually we're you're it's that's there's here's i'm don't can't bit maybe against between through into over under about after before during each every all some any more most other such only own same both few written using uses used called means per via thus hence etc"));

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
  // Nor are figure captions and table rows, which would otherwise run into the paragraph around them.
  const text = proseLines(raw.split("\n"))
    .join("\n")
    .replace(/^\s*#{1,6}\s+.*$/gm, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
    .trim();
  const sentences = (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [text])
    .map((s) => s.trim())
    .filter((s) => s.split(" ").length >= 6 && s.length <= 400 && !isGarbled(s));
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
