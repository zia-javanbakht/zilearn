import { z } from "zod";
import { aiEnabled, generateStructured } from "./ai";
import { offlineDigest } from "./digest";
import { proseLines, studySections, titleFromFilename, topKeywords, truncate } from "./text";
import { checkKeywords, repairTerm } from "./textRepair";
import { clipWords } from "./figure";
import { headingRepairer } from "./headingRepair";
import { abstractOf } from "./keywords";
import type { NewTopic } from "./store";
import type { Course, Digest, DigestTopic, Material } from "./types";
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
  // Key terms first: when the items have keyword maps, those are the map, with or without AI.
  if (usable.some(keywordMapOf)) {
    if (aiEnabled()) {
      try {
        // The AI gathers the terms under broader branches itself; offline, the document's sections do.
        const out = await describeWithAi(course, usable, heuristicTopics(usable, { gather: false }));
        return { ...out, by: "claude" };
      } catch (e) {
        console.warn("[brainmap] The AI couldn't describe the keyword map; using the items' own sentences.", e);
      }
    }
    return { topics: heuristicTopics(usable), summary: heuristicSummary(course, usable), by: "heuristic" };
  }
  if (aiEnabled() && usable.length) {
    const { topics, summary } = await structureWithClaude(course, usable);
    return { topics, summary, by: "claude" };
  }
  return { topics: heuristicTopics(usable), summary: heuristicSummary(course, usable), by: "heuristic" };
}

const DescribeSchema = z.object({
  course_summary: z.string().describe("2-4 sentence overview of what the course covers."),
  groups: z
    .array(
      z.object({
        title: z.string().describe("A broader concept the branches share, as the materials name it (max ~6 words)"),
        summary: z.string().describe("1-2 sentences on what ties them together, from the materials"),
        members: z.array(z.string()).describe("ids of the top-level branches it holds (2 or more)"),
      }),
    )
    .describe("Only when there are more than 8 top-level branches: broader branches to gather related ones under. Otherwise empty."),
  topics: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string().describe("1-3 sentences: what the materials say about this term, for the case they say it"),
        importance: z.number().int().describe("1 = minor, 2 = normal, 3 = core / heavily examined"),
      }),
    )
    .describe("One entry per branch id given."),
});

/**
 * The AI's part when the map is built from keyword maps: the branches stay the items' terms, as they are;
 * the AI writes each one's summary from the materials, rates its importance and, when there are many
 * top-level branches, gathers related ones under broader ones.
 */
async function describeWithAi(course: Course, materials: Material[], topics: NewTopic[]): Promise<{ topics: NewTopic[]; summary: string }> {
  const refs = new Map(materials.map((m, i) => [m.id, `M${i + 1}`]));
  const kids = (ref: string | null) => topics.filter((t) => t.parent_ref === ref);
  const line = (t: NewTopic, indent: string): string[] => [
    `${indent}- [${t.ref}] ${t.title} (from ${t.material_ids.map((id) => refs.get(id)).join(", ")})${t.summary ? `: ${truncate(t.summary.replace(/\s+/g, " "), 300)}` : ""}`,
    ...kids(t.ref).flatMap((c) => line(c, indent + "  ")),
  ];
  const budget = Math.floor(MAX_CHARS / Math.max(1, materials.length));
  const blocks = materials.map((m) => `<material id="${refs.get(m.id)}" kind="${MATERIAL_KIND_LABELS[m.kind]}" title="${m.title.replace(/"/g, "'")}">\n${m.text ? truncate(m.text, budget) : "(no text available)"}\n</material>`);
  const tops = kids(null).length;
  const out = await generateStructured({
    schema: DescribeSchema,
    effort: "low",
    maxTokens: 16000,
    context: blocks.join("\n\n"),
    prompt: `Course: ${course.name}${course.code ? ` (${course.code})` : ""}

This is the student's brainmap of the course, built from the key terms of the materials above: each branch is a key term (the student checked these maps), the branches under it are the terms the materials discuss with it, and the text after each is a sentence the material says about it.

${kids(null).flatMap((t) => line(t, "")).join("\n")}

For every branch id:
- Write its summary from what the materials say about that term: 1-3 sentences a student can learn from, for the case the material says it (a result found for one case is not stated for another). Use only the materials; do not add facts they don't state.
- Rate its importance: 3 for terms the materials build on or that sample exams ask about.
Keep the branches as they are: don't rename, add or drop any.
${tops > 8 ? `There are ${tops} top-level branches: gather related ones under 3-6 broader branches named as the materials name the concept they share. A branch that fits no group stays where it is.` : "Leave groups empty."}`,
  });
  const byId = new Map(out.topics.map((t) => [t.id.replace(/^\[|\]$/g, "").trim(), t]));
  const described = topics.map((t) => {
    const d = byId.get(t.ref);
    const summary = d?.summary?.trim();
    return { ...t, summary: summary || t.summary, importance: d ? Math.min(3, Math.max(1, d.importance)) : t.importance };
  });
  // Groups hold top-level branches only, each in one group, and need two members to be worth a branch.
  const top = new Set(kids(null).map((t) => t.ref));
  const placed = new Set<string>();
  const groups: NewTopic[] = [];
  for (const [g, grp] of (out.groups ?? []).entries()) {
    const members = grp.members.map((x) => x.replace(/^\[|\]$/g, "").trim()).filter((x) => top.has(x) && !placed.has(x));
    if (members.length < 2 || !grp.title.trim()) continue;
    const ref = `G${g}`;
    members.forEach((x) => placed.add(x));
    const ids = [...new Set(members.flatMap((x) => described.find((t) => t.ref === x)!.material_ids))];
    groups.push({ ref, parent_ref: null, title: truncate(grp.title.trim(), 80), summary: grp.summary.trim(), keywords: members.map((x) => bareTerm(described.find((t) => t.ref === x)!.title)).slice(0, 8), material_ids: ids, importance: 3 });
    for (const t of described) if (members.includes(t.ref)) t.parent_ref = ref;
  }
  // Each group stands where its first member stood.
  const ordered: NewTopic[] = [];
  for (const t of described) {
    const g = groups.find((x) => x.ref === t.parent_ref);
    if (g && !ordered.includes(g)) ordered.push(g);
    ordered.push(t);
  }
  return { topics: ordered, summary: out.course_summary.trim() || heuristicSummary(course, materials) };
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
    // A digest keeps the whole of a long recording in view even when its transcript is cut to fit; a keyword
    // map is the skeleton the course map is built from, and one the student edited is theirs.
    const digest = m.digest
      ? m.digest.basis === "keywords"
        ? `<keyword_map${m.digest.edited ? ' checked_by_student="yes"' : ""}>\n${m.digest.summary}\n${keywordLines(m.digest)}\n</keyword_map>\n`
        : `<digest>\n${m.digest.summary}\nKey terms: ${m.digest.keywords.join(", ")}\nTopics: ${m.digest.topics.map((t) => t.title).join("; ")}\n</digest>\n`
      : "";
    return `<material id="${ref}" kind="${MATERIAL_KIND_LABELS[m.kind]}" title="${m.title.replace(/"/g, "'")}">\n${digest}${body}\n</material>`;
  });
  const prompt = `Course: ${course.name}${course.code ? ` (${course.code})` : ""}
${course.description ? `Description: ${course.description}\n` : ""}
Below are all the materials the student has collected for this course (lecture notes, slides, recordings, sample exams, workshops, tutorials, ...).

${blocks.join("\n\n")}

Build a brainmap of the course content:
- Build it from the materials' keyword maps: their key terms are the topics. Merge the same term from different materials into one topic (organise by concept, not by file), group terms under broader ones, and add a topic only for content no keyword map covers. A map checked by the student is final for that material: keep every term in it, keep its grouping where it makes sense across the course, and add nothing from that material that its map leaves out.
- Organise by concept, not by file: merge material that covers the same idea from different sources.
- 4-10 top-level branches, each with subtopics; go 2-4 levels deep. Leaves should be study-sized (30-60 minutes of work at most).
- Order branches and subtopics in a sensible learning order (prerequisites first).
- Mark importance 3 for topics that are core or appear in sample exams.
- Cite source material ids for each topic.
- Cover every numbered section and appendix of a paper or set of notes somewhere in the map.
- Write each summary only from what its own section says: a result found for one case (one test, geometry or example) is not stated for the others, and a comparison says which method came out better where.
- Each idea belongs to one topic: when two sections treat the same criteria or result (e.g. the Jacobian determinant test under both the Jacobian and element quality), give it to the topic that defines it, and let the other's summary point to that topic by name instead of repeating it.
- Where a source uses one symbol for two things (e.g. J for an area ratio in a figure and J = det F later), say so in the summaries that use it.
- Slide navigation, title slides and section dividers ("Part I", a lone section name) aren't topics; a part title from a divider names the course's wider part, not this material's content.
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

/** A keyword map as indented lines: "- term: note", its terms under it. */
function keywordLines(d: Digest): string {
  const line = (t: DigestTopic, indent: string) => `${indent}- ${t.title}${t.summary ? `: ${truncate(t.summary.replace(/\s+/g, " "), 300)}` : ""}`;
  return d.topics.flatMap((t) => [line(t, ""), ...(t.subtopics ?? []).map((s) => line(s, "  "))]).join("\n");
}

/** Key terms spelt as the sources spell them; ones the sources never use are dropped unless that leaves too few. */
function groundedTerms(terms: string[], sources: string): string[] {
  if (!sources.trim()) return terms.slice(0, 8);
  const checked = checkKeywords(terms, sources, { max: 8 });
  return checked.length >= Math.min(3, terms.length) ? checked : terms.map((t) => repairTerm(t, sources)).filter(Boolean).slice(0, 8);
}

/** Exercises, hints, answers and quizzes: practice on the material, not a part of its content. */
const DRILL_SECTION = /^((multiple[- ]choice\s+)?(concept\s+)?quiz(zes)?|exercises?|hints?|answers?|questions and answers|answer checks|self[- ]?tests?|review questions|practice (problems|questions)|problems|solutions|warm[- ]?up|check yourself|your turn|try (it|this))\b/i;

// A lesson's scaffolding ("Where this fits", "Key terms", "Takeaways") frames its sections the same way.
const CONTEXT_SECTION =
  /^(introduction( and motivation)?|motivation|background|conclusions?|concluding remarks|summary( and conclusions?)?|discussion and conclusions?|closing remarks|outlook|map of this (lesson|topic|chapter)|where this fits|key (terms|ideas|points)|common (mistakes|errors|pitfalls)|connections|takeaways|key takeaways|learning (objectives|outcomes)|objectives|recap|what('|’)s next|further reading)$/i;

const RESTATES = /^(map of this (lesson|topic|chapter)|where this fits|key (terms|ideas|points)|takeaways|key takeaways|connections|common (mistakes|errors|pitfalls)|recap)$/i;

const keywordMapOf = (m: Material) => (m.digest && (m.digest.basis === "keywords" || m.digest.edited) && m.digest.topics.length ? m.digest : null);

/** A term as one key across items: "Representative volume elements (RVE)" and "representative volume element" match. */
const termKey = (t: string) =>
  bareTerm(t)
    .toLowerCase()
    .replace(/[-‐‑–\s]+/g, " ")
    .replace(/(?<=\w)s\b/g, "")
    .trim()
    .replace(/^(the|a|an) /, "");

/** Most main terms that stand as top-level branches on their own; more are gathered under broader ones. */
const MAX_LOOSE_BRANCHES = 5;

/** Most top-level branches the items' main terms make before each item becomes a branch of its own. */
const MAX_TERM_BRANCHES = 14;

/**
 * The course map from the items' keyword maps: their main terms are the branches (a term several items
 * use is one branch, citing them all) and the terms under each main term are its sub-branches, each with
 * what the item says about it. Null when the items' main terms are too many to stand as branches.
 */
function keywordBranches(mapped: Material[], gather = true): NewTopic[] | null {
  type Branch = { title: string; summary: string; ids: string[]; subs: Map<string, { title: string; summary: string; ids: string[] }> };
  const mains = new Map<string, Branch>();
  for (const m of mapped)
    for (const t of keywordMapOf(m)!.topics.slice(0, 20)) {
      const key = termKey(t.title);
      if (!key) continue;
      let b = mains.get(key);
      if (!b) mains.set(key, (b = { title: t.title, summary: noteOf(t), ids: [], subs: new Map() }));
      if (!b.ids.includes(m.id)) b.ids.push(m.id);
      for (const st of (t.subtopics ?? []).slice(0, 20)) {
        const k = termKey(st.title);
        if (!k || k === key || mains.has(k)) continue;
        const sub = b.subs.get(k);
        if (sub) sub.ids.includes(m.id) || sub.ids.push(m.id);
        else b.subs.set(k, { title: st.title, summary: noteOf(st), ids: [m.id] });
      }
    }
  if (mapped.length > 1 && mains.size > MAX_TERM_BRANCHES) return null;
  // A term that is a main term somewhere is a branch, not also a sub-branch elsewhere; a term two items put
  // under different main terms stays under the first.
  const placed = new Set<string>();
  for (const b of mains.values())
    for (const k of [...b.subs.keys()]) {
      if (mains.has(k) || placed.has(k)) b.subs.delete(k);
      placed.add(k);
    }
  const topics: NewTopic[] = [];
  const branches = [...mains.values()];
  // One paper or set of notes with many main terms: its sections gather them, as the AI gathers them under broader branches.
  const groups = gather && mapped.length === 1 && branches.length > MAX_LOOSE_BRANCHES ? sectionGroups(mapped[0], branches.map((b) => b.title)) : null;
  const groupOf = new Map<number, string>();
  groups?.forEach((g, gi) => {
    const all = [...g.members, ...g.parts.flatMap((p) => p.members)];
    topics.push({ ref: `S${gi}`, parent_ref: null, title: g.title, summary: g.summary, keywords: all.map((i) => bareTerm(branches[i].title)).slice(0, 8), material_ids: [mapped[0].id], importance: 3 });
    for (const i of g.members) groupOf.set(i, `S${gi}`);
    g.parts.forEach((p, k) => {
      topics.push({ ref: `S${gi}.p${k}`, parent_ref: `S${gi}`, title: p.title, summary: p.summary, keywords: p.members.map((i) => bareTerm(branches[i].title)).slice(0, 8), material_ids: [mapped[0].id], importance: p.members.length ? 3 : 2 });
      for (const i of p.members) groupOf.set(i, `S${gi}.p${k}`);
    });
  });
  branches.forEach((b, j) => {
    const ref = `K${j}`;
    const subs = [...b.subs.values()];
    topics.push({ ref, parent_ref: groupOf.get(j) ?? null, title: truncate(b.title, 80), summary: b.summary, keywords: [b.title, ...subs.map((x) => x.title)].map(bareTerm).slice(0, 8), material_ids: b.ids, importance: subs.length >= 2 || b.ids.length > 1 ? 3 : 2 });
    subs.forEach((st, k) => topics.push({ ref: `${ref}.${k}`, parent_ref: ref, title: truncate(st.title, 80), summary: st.summary, keywords: [bareTerm(st.title)], material_ids: st.ids, importance: 2 }));
  });
  return orderByDocument(mergeNamesakes(topics), groups);
}

/** A term a section is named after ("Stress measures" in "Stress Measures") is that section's branch: its sub-terms move up to it. */
function mergeNamesakes(topics: NewTopic[]): NewTopic[] {
  const drop = new Set<string>();
  for (const t of topics) {
    // A main term in a section, or a sub-term anywhere ("Theorem of expended power" under another term).
    if (!t.ref.startsWith("K") || !(t.parent_ref?.startsWith("S") || t.ref.includes("."))) continue;
    // Its namesake section, wherever the term itself was placed.
    const parent = topics.find((p) => p.ref.startsWith("S") && termKey(p.title) === termKey(t.title));
    if (!parent) continue;
    drop.add(t.ref);
    // Its sub-terms stay where it was placed: in that section, or with what the text discusses them.
    for (const c of topics) if (c.parent_ref === t.ref) c.parent_ref = t.parent_ref;
  }
  return topics.filter((t) => !drop.has(t.ref));
}

/** Groups first where they start; a term outside every group stays where the keyword map put it. */
function orderByDocument(topics: NewTopic[], groups: { title: string }[] | null): NewTopic[] {
  if (!groups?.length) return topics;
  const tops = topics.filter((t) => !t.parent_ref);
  const under = (ref: string): NewTopic[] => topics.filter((t) => t.parent_ref === ref).flatMap((t) => [t, ...under(t.ref)]);
  return tops.flatMap((t) => [t, ...under(t.ref)]);
}

/**
 * A single paper or set of notes with many key terms: its sections gather them, as a student reads it.
 * Each main term goes to the section that mentions it most (its introduction and conclusion count for
 * less); a section that gathers two or more terms is a branch, named as the material names it.
 */
type SectionGroup = { title: string; summary: string; members: number[]; parts: { title: string; summary: string; members: number[] }[] };

function sectionGroups(m: Material, terms: string[]): SectionGroup[] | null {
  const text = m.text ?? "";
  const sections = studySections(text).filter((s) => s.heading && !/^(abstract|summary|keywords?)$/i.test(s.heading));
  const lvl = Math.min(...sections.map((s) => s.level ?? 1).filter((l) => l > 0));
  type Part = { title: string; body: string; subs: { title: string; body: string }[] };
  type G = { title: string; body: string; own: string; context: boolean; parts: Part[] };
  const gs: G[] = [];
  for (const s of sections) {
    if ((s.level ?? 1) === 0) continue;
    if ((s.level ?? 1) <= lvl || !gs.length) gs.push({ title: s.heading, body: s.body, own: s.body, context: CONTEXT_SECTION.test(s.heading) || /^appendix\b/i.test(s.heading) || DRILL_SECTION.test(s.heading), parts: [] });
    else {
      const g = gs[gs.length - 1];
      g.body += `\n${s.heading}\n${s.body}`;
      // Its subsections, one level down; deeper ones belong to theirs.
      if ((s.level ?? 1) === lvl + 1 || !g.parts.length) g.parts.push({ title: s.heading, body: s.body, subs: [] });
      else {
        const p = g.parts[g.parts.length - 1];
        p.body += `\n${s.heading}\n${s.body}`;
        if ((s.level ?? 1) === lvl + 2 || !p.subs.length) p.subs.push({ title: s.heading, body: s.body });
        else p.subs[p.subs.length - 1].body += `\n${s.heading}\n${s.body}`;
      }
    }
  }
  if (gs.length < 2) return null;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const count = (body: string, term: string) => {
    const words = bareTerm(term).toLowerCase().split(/\s+/).map((w) => esc(w.replace(/s$/, "")) + "s?");
    return (body.toLowerCase().match(new RegExp(`\\b${words.join("[\\s-]+")}\\b`, "g")) ?? []).length;
  };
  const boxes = new Map<string, Set<string>>();
  const boxed = (body: string) => {
    if (!boxes.has(body))
      boxes.set(
        body,
        new Set(
          [...body.matchAll(/^\s*(?:definition|theorem|lemma|corollary|proposition|keypoint|key point|remark)\s+[\d.]+\s*[—–]\s*([^.\n]{3,80})\./gim)].map((m) => termKey(m[1].replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim())),
        ),
      );
    return boxes.get(body)!;
  };
  const members = gs.map(() => [] as number[]);
  const partOf = gs.map((g) => g.parts.map(() => [] as number[]));
  const subOf = gs.map((g) => g.parts.map((p) => p.subs.map(() => [] as number[])));
  terms.forEach((t, i) => {
    let best = -1;
    let score = 0;
    gs.forEach((g, gi) => {
      // A lesson's map, key-term list or takeaways restate every term: they say nothing about where one belongs.
      const n = count(g.body, t) * (g.context ? (RESTATES.test(g.title) ? 0 : 0.5) : 1);
      if (n > score) (score = n), (best = gi);
    });
    // The section whose box defines or states it ("Theorem 2.2 — Divergence (Gauss') Theorem") is its home.
    const home = gs.findIndex((g) => !g.context && boxed(g.body).has(termKey(t)));
    if (home >= 0) best = home;
    if (best < 0) return;
    // A term one subsection discusses most of the time goes under that subsection.
    const g = gs[best];
    const inPart = g.parts.map((p) => count(p.body, t));
    const k = inPart.indexOf(Math.max(0, ...inPart));
    if (k >= 0 && inPart[k] >= 1 && inPart[k] >= 0.5 * count(g.body, t)) {
      // And within it, a sub-subsection the same way: that one is listed beside its subsection.
      const inSub = g.parts[k].subs.map((x) => count(x.body, t));
      const j = inSub.indexOf(Math.max(0, ...inSub));
      if (j >= 0 && inSub[j] >= 1 && inSub[j] >= 0.5 * inPart[k]) subOf[best][k][j].push(i);
      else partOf[best][k].push(i);
    } else members[best].push(i);
  });
  const mend = headingRepairer(text);
  const out: SectionGroup[] = gs.flatMap((g, gi) => {
    // An introduction or conclusion frames the paper's topics rather than being one: its terms stay branches of their own.
    if (g.context) return [];
    // Subsections that name a part of the content, or hold a term.
    const parts = g.parts
      .flatMap((p, k) => [
        { title: clipWords(mend(p.title), 60), summary: firstSentences(p.body, 2), members: partOf[gi][k], sub: false },
        ...p.subs.map((x, j) => ({ title: clipWords(mend(x.title), 60), summary: firstSentences(x.body, 2), members: subOf[gi][k][j], sub: true })).filter((x) => x.members.length),
      ])
      .filter((p) => p.members.length || (!p.sub && !DRILL_SECTION.test(p.title) && !CONTEXT_SECTION.test(p.title) && p.title.split(/\s+/).length <= 8 && !/[?]$/.test(p.title)))
      .slice(0, 8)
      .map(({ sub: _, ...p }) => p);
    const held = members[gi].length + parts.reduce((n, p) => n + p.members.length, 0);
    if (held < 1 && parts.length < 3) return [];
    return [{ title: clipWords(mend(g.title), 60), summary: firstSentences(g.own, 2) || firstSentences(g.body, 2), members: members[gi], parts }];
  });
  return out.length >= 2 ? out : null;
}

/**
 * Offline structuring. Items with a keyword map (above all one the student checked on the Materials tab)
 * give the branches: their main terms, with the terms under them as sub-branches. Any other item is a
 * branch of its own, with its sections (or its digest's topics) under it.
 */
export function heuristicTopics(materials: Material[], opts: { gather?: boolean } = {}): NewTopic[] {
  const mapped = materials.filter((m) => keywordMapOf(m));
  const byTerms = mapped.length ? keywordBranches(mapped, opts.gather ?? true) : null;
  const topics: NewTopic[] = byTerms ?? [];
  materials.forEach((m, i) => {
    if (byTerms && keywordMapOf(m)) return;
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
      title: own && fileNamed(m) ? clipWords(mend(own), 80) : m.title,
      summary: digest?.summary || firstSentences(abstractOf(text) ?? afterTitlePage(text), 2) || `${MATERIAL_KIND_LABELS[m.kind]} for this course.`,
      keywords: digest?.keywords.slice(0, 8) ?? topKeywords(text, 6),
      material_ids: [m.id],
      importance: m.kind === "sample_exam" ? 3 : 2,
    });
    // Too many items' terms to stand as branches: each item's keyword map is its own branch.
    const keywordMap = keywordMapOf(m);
    if (keywordMap) {
      keywordMap.topics.slice(0, 20).forEach((t, j) => {
        const tref = `${ref}.k${j}`;
        const subs = t.subtopics ?? [];
        topics.push({ ref: tref, parent_ref: ref, title: truncate(t.title, 80), summary: noteOf(t), keywords: [t.title, ...subs.map((x) => x.title)].map(bareTerm).slice(0, 8), material_ids: [m.id], importance: subs.length >= 2 ? 3 : 2 });
        subs.slice(0, 20).forEach((st, k) => topics.push({ ref: `${tref}.${k}`, parent_ref: tref, title: truncate(st.title, 80), summary: noteOf(st), keywords: [bareTerm(st.title)], material_ids: [m.id], importance: 2 }));
      });
      return;
    }
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

/**
 * A title that is only the file's name, and a code-like one ("abs2024", "csd l7", "Thompson nlcm"): the
 * document's own title says more. A title the student gave the item is kept.
 */
function fileNamed(m: Material): boolean {
  if (!/\s/.test(m.title)) return true;
  if (!m.filename || titleFromFilename(m.filename) !== m.title) return false;
  const words = m.title.split(/\s+/);
  return words.length <= 3 && words.some((w) => /\d/.test(w) || /^[a-z]+$/.test(w));
}

/** "Representative volume element (RVE)" as a key term: "Representative volume element". */
const bareTerm = (t: string) => t.replace(/\s*\([^)]*\)$/, "").trim();

/** A term's note, with where the material says it ("… (see “Material properties”)"); see plainSummary. */
function noteOf(t: DigestTopic): string {
  const where = t.evidence?.find((e) => e.text === t.summary)?.where;
  return where && t.summary ? `${t.summary} (see “${where.replace(/[“”]/g, "")}”)` : t.summary;
}

function heuristicSummary(course: Course, materials: Material[]) {
  // The key terms of the items' maps, first terms first; word counts only for items without a map.
  const terms = new Map<string, string>();
  const width = Math.max(0, ...materials.map((m) => m.digest?.topics.length ?? 0));
  for (let i = 0; i < width && terms.size < 8; i++)
    for (const m of materials) {
      const t = m.digest?.basis === "keywords" || m.digest?.edited ? m.digest.topics[i] : undefined;
      if (t && terms.size < 8) terms.set(bareTerm(t.title).toLowerCase(), bareTerm(t.title));
    }
  const rest = materials.filter((m) => !(m.digest?.basis === "keywords" || m.digest?.edited));
  const kw = [...terms.values(), ...(rest.length && terms.size < 8 ? topKeywords(rest.map((m) => `${m.title} ${m.text ?? ""}`).join(" "), 8 - terms.size) : [])];
  return `${course.name} draws on ${materials.length} item${materials.length === 1 ? "" : "s"}. ${terms.size ? "Key terms" : "Frequent themes"}: ${kw.join(", ")}.`;
}

/** Numbered notes without an abstract: their text from the first numbered section, past the title page. */
function afterTitlePage(text: string): string {
  const first = text.search(/^#{1,6}\s+1\.?\s+\p{L}/mu);
  return first > 0 ? text.slice(first) : text;
}

function firstSentences(text: string, n: number) {
  const s = proseLines(text.split("\n"))
    // A figure's labels ("1 2", "Natural / Parent") and a line of symbols say nothing on their own:
    // keep lines of words, list items and headings.
    .filter((l) => (l.match(/(?:^|\s)[A-Za-z][a-z]{2,}[,.;:)]?(?=\s|$)/g) ?? []).length >= 3 || /^\s*-\s+\S/.test(l) || /^#/.test(l.trim()))
    // A lesson's lists of its terms and formulas ("Key terms: …") are its layout.
    .filter((l) => !/^\s*(key (terms|words)|keywords|formula|procedure)\s*:/i.test(l))
    // A box's label ("Definition 3.1 — Mass of the Cuts (Smith 2002).") names it; its text says what it is.
    .map((l) => l.replace(/^\s*(definition|theorem|lemma|corollary|proposition|keypoint|key point|example|remark|intuition)\s+[\d.]+\s*[—–-]\s*.{1,120}?\.(?=\s+\p{Lu})\s*/iu, ""))
    .join("\n")
    .replace(/--- Page \d+ ---/g, " ")
    // Headings (a title, the author line under it) aren't sentences of the text, but they end one.
    .replace(/^\s*#{1,6}\s+.*$/gm, "\u0000")
    .replace(/^\s*([-*]\s+|slide \d+:\s*)/gim, "");
  // A sentence ends at a stop followed by a space, not at the dot of "3.1" or "e.g.,".
  const parts = s
    .split("\u0000")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((x) => x.match(/(?:[^.!?]|[.!?](?=\S))+[.!?]+(?=\s|$)|(?:[^.!?]|[.!?](?=\S))+$/g) ?? [])
    .filter((x) => /\p{L}{3}/u.test(x));
  return truncate(parts.slice(0, n).map((x) => x.trim()).join(" "), 300);
}

export { toFlowchart, toMindmap } from "./mermaid";
