import { DEPTH_LEVELS, type Mastery, type MaterialKind, type PlanItem, type TopicNode } from "./types";

/**
 * Progressive (spiral) study plan.
 *
 * The course is covered in several iterations. Iteration k studies every topic
 * that still needs work at depth k, so each pass revisits the same material one
 * level deeper (Survey -> Understand -> Apply -> Master) until the target level.
 *
 * Where a topic enters the spiral depends on how the student marked it:
 *   don't know / unmarked -> starts at depth 1
 *   familiar              -> starts at depth 2
 *   know                  -> only a confirmation pass at the target depth
 * Depth already achieved in earlier plans is skipped.
 */

export interface PlanInput {
  roots: TopicNode[];
  targetLevel: number; // 1..4
  startDate: string; // YYYY-MM-DD
  examDate: string | null; // YYYY-MM-DD
  hoursPerDay: number;
  materialKinds: Map<string, MaterialKind>; // material id -> kind
}

export type DraftItem = Omit<PlanItem, "id" | "plan_id">;

export interface DraftPlan {
  start_date: string;
  end_date: string;
  target_level: number;
  iterations: number;
  warnings: string[];
  items: DraftItem[];
}

const BASE_MINUTES = [0, 20, 30, 40, 45];
const IMPORTANCE_FACTOR = [0, 0.75, 1, 1.35];
const MIN_ITEM_MINUTES = 10;
const DEFAULT_SPAN_DAYS = 21;

export function startDepth(mastery: Mastery | null, target: number, achieved: number): number {
  const fromMark = mastery === "know" ? target : mastery === "familiar" ? Math.min(2, target) : 1;
  return Math.max(fromMark, achieved + 1);
}

/** Leaves are the study units; parents only group them. */
export function studyUnits(roots: TopicNode[]): { node: TopicNode; path: string[] }[] {
  const out: { node: TopicNode; path: string[] }[] = [];
  const walk = (ns: TopicNode[], path: string[]) => {
    for (const n of ns) {
      if (n.children.length) walk(n.children, [...path, n.title]);
      else out.push({ node: n, path });
    }
  };
  walk(roots, []);
  return out;
}

export function buildPlan(input: PlanInput): DraftPlan {
  const target = Math.min(4, Math.max(1, Math.round(input.targetLevel)));
  const units = studyUnits(input.roots);
  const warnings: string[] = [];

  // 1. Lay out the spiral: iteration k = all units that need depth k.
  type Slot = { iteration: number; unit: (typeof units)[number]; depth: number; minutes: number };
  const slots: (Slot | { iteration: number; checkpoint: true; topics: string[] })[] = [];
  let iterations = 0;
  for (let k = 1; k <= target; k++) {
    const pass = units.filter((u) => {
      const s = startDepth(u.node.effective_mastery, target, u.node.achieved_depth);
      return s <= k && k <= target;
    });
    if (!pass.length) continue;
    iterations++;
    for (const u of pass) {
      const factor = IMPORTANCE_FACTOR[Math.min(3, Math.max(1, u.node.importance))];
      slots.push({ iteration: k, unit: u, depth: k, minutes: Math.round(BASE_MINUTES[k] * factor) });
    }
    slots.push({ iteration: k, checkpoint: true, topics: pass.map((u) => u.node.title) });
  }

  if (!units.length) warnings.push("Build the brainmap first: there are no topics to plan yet.");
  else if (!slots.length) warnings.push("Every topic is already at the target level. Raise the target level or mark topics you want to revisit.");

  // 2. Fit into the calendar. The exam day itself is not a study day.
  const parsedStart = parseDate(input.startDate);
  const start = Number.isNaN(parsedStart.getTime()) ? parseDate(fmtDate(new Date())) : parsedStart;
  const exam = input.examDate ? parseDate(input.examDate) : null;
  const hasExam = exam !== null && !Number.isNaN(exam.getTime());
  let end = hasExam ? exam : addDays(start, DEFAULT_SPAN_DAYS);
  let studyDays = daysBetween(start, end);
  if (studyDays < 1) {
    warnings.push(
      hasExam && studyDays < 0
        ? "The exam date has passed. Update it in the plan settings; for now the plan covers one day."
        : "The exam is today, so the plan fits into a single day. Focus on the checkpoints and core topics.",
    );
    studyDays = 1;
    end = addDays(start, 1);
  }
  const dailyMinutes = Math.max(15, Math.round(input.hoursPerDay * 60));
  const capacity = studyDays * dailyMinutes;
  const checkpointMinutes = (n: number) => Math.min(45, 10 + n * 2);
  const baseMinutes = (x: (typeof slots)[number]) => ("checkpoint" in x ? checkpointMinutes(x.topics.length) : x.minutes);
  const totalStudy = slots.reduce((sum, x) => sum + baseMinutes(x), 0);

  // When even minimum-length sessions can't fit, drop the least valuable ones:
  // intermediate passes go first, then minor topics. The first and final pass of
  // each topic and the last checkpoint are kept as long as possible.
  let kept = slots;
  if (slots.length * MIN_ITEM_MINUTES > capacity) {
    const priority = (x: (typeof slots)[number]) => {
      if ("checkpoint" in x) return x.iteration === target ? 100 : 5;
      const first = startDepth(x.unit.node.effective_mastery, target, x.unit.node.achieved_depth);
      const tier = x.iteration === target ? 30 : x.iteration === first ? 20 : 10;
      return tier + Math.min(3, Math.max(1, x.unit.node.importance));
    };
    const maxSlots = Math.max(1, Math.floor(capacity / MIN_ITEM_MINUTES));
    const keep = new Set(
      slots
        .map((x, i) => ({ i, p: priority(x) }))
        .sort((x, y) => y.p - x.p || x.i - y.i)
        .slice(0, maxSlots)
        .map((x) => x.i),
    );
    kept = slots.filter((_, i) => keep.has(i));
    warnings.push(
      `Not enough time for every session: ${slots.length - kept.length} lower-priority session(s) (mostly intermediate passes) were left out. More hours per day or an earlier start would bring them back.`,
    );
  }

  // Shorten sessions proportionally until everything fits.
  const keptTotal = kept.reduce((sum, x) => sum + baseMinutes(x), 0);
  const fitted = (scale: number) => kept.map((x) => Math.max(MIN_ITEM_MINUTES, Math.round(baseMinutes(x) * scale)));
  let scale = keptTotal > capacity ? capacity / keptTotal : 1;
  let minutesList = fitted(scale);
  while (scale > 0.01 && minutesList.reduce((a, m) => a + m, 0) > capacity) {
    scale *= 0.95;
    minutesList = fitted(scale);
  }
  if (scale < 1 && kept.length === slots.length) {
    const needDays = Math.ceil(totalStudy / dailyMinutes);
    warnings.push(
      `The full plan needs about ${hours(totalStudy)} but only ${hours(capacity)} fit before ${hasExam ? "the exam" : "the end date"}. ` +
        `Sessions were shortened by about ${Math.round((1 - scale) * 100)}%. Studying ${Math.ceil(totalStudy / studyDays / 6) / 10}h/day or starting ${needDays - studyDays} day(s) earlier would avoid that.`,
    );
  }

  // Spread sessions evenly over the available days (never more than the daily budget).
  const items: DraftItem[] = [];
  let day = 0;
  let used = 0;
  let remaining = minutesList.reduce((a, m) => a + m, 0);
  let target_today = Math.min(dailyMinutes, Math.ceil(remaining / studyDays) + 10);
  kept.forEach((s, idx) => {
    const minutes = minutesList[idx];
    if (used > 0 && used + minutes > target_today && day < studyDays - 1) {
      day++;
      used = 0;
      target_today = Math.min(dailyMinutes, Math.ceil(remaining / (studyDays - day)) + 10);
    }
    used += minutes;
    remaining -= minutes;
    const date = fmtDate(addDays(start, day));
    const position = items.length;
    if ("checkpoint" in s) {
      items.push({
        day: day + 1,
        date,
        iteration: s.iteration,
        kind: "checkpoint",
        topic_id: null,
        topic_title: `Checkpoint: end of pass ${s.iteration} (${DEPTH_LEVELS[s.iteration - 1].name})`,
        depth: s.iteration,
        minutes,
        activities: checkpointActivities(s.iteration, s.topics),
        done: false,
        position,
      });
    } else {
      const kinds = new Set(s.unit.node.material_ids.map((id) => input.materialKinds.get(id)).filter(Boolean) as MaterialKind[]);
      items.push({
        day: day + 1,
        date,
        iteration: s.iteration,
        kind: "study",
        topic_id: s.unit.node.id,
        topic_title: s.unit.node.title,
        depth: s.depth,
        minutes,
        activities: activitiesFor(s.depth, kinds, s.unit.node.effective_mastery),
        done: false,
        position,
      });
    }
  });

  return {
    start_date: fmtDate(start),
    end_date: fmtDate(end),
    target_level: target,
    iterations,
    warnings,
    items,
  };
}

export function activitiesFor(depth: number, kinds: Set<MaterialKind>, mastery: Mastery | null): string[] {
  const a: string[] = [];
  switch (depth) {
    case 1:
      a.push("Read the topic overview and skim the source material");
      if (kinds.has("slides")) a.push("Flip through the slides, noting headings and diagrams");
      if (kinds.has("youtube") || kinds.has("audio_memo")) a.push("Watch or listen to the recording at 1.5x for orientation");
      a.push("Write down 3-5 key terms and a one-line definition of each");
      break;
    case 2:
      a.push("Study the lesson in depth and read the full source sections");
      if (kinds.has("lecture_notes") || kinds.has("reading") || kinds.has("pdf")) a.push("Make structured notes: definitions, how parts connect, why it works");
      a.push("Explain the topic aloud without notes (Feynman technique)");
      a.push("Create 3-5 flashcards for the ideas you found hardest");
      break;
    case 3:
      if (kinds.has("tutorial") || kinds.has("workshop")) a.push("Redo the related tutorial / workshop problems without looking at solutions");
      if (kinds.has("sample_exam")) a.push("Attempt the matching sample exam questions under time pressure");
      a.push("Work through worked examples, then solve a fresh problem yourself");
      a.push("Review your flashcards (spaced repetition)");
      break;
    default:
      a.push("Answer exam-style questions from memory, including tricky edge cases");
      a.push("Compare this topic with related ones: similarities, differences, when to use which");
      if (kinds.has("sample_exam")) a.push("Do a timed sample-exam section and mark it strictly");
      a.push("Teach it back: write a half-page summary from memory, then check gaps");
  }
  if (mastery === "know") a.unshift("Quick confidence check: if you can't answer the lesson questions, mark this topic as Familiar and rebuild the plan");
  return a;
}

function checkpointActivities(iteration: number, topics: string[]): string[] {
  return [
    `Self-test on this pass (${topics.length} topic${topics.length === 1 ? "" : "s"}): generate a short mock exam focused on ${DEPTH_LEVELS[iteration - 1].name.toLowerCase()}-level questions`,
    "Update your marks in the brainmap for anything that still feels shaky",
    "Skim your notes and flashcards from this pass",
  ];
}

/* ---------- dates ---------- */

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function hours(min: number) {
  return `${Math.round(min / 6) / 10}h`;
}
