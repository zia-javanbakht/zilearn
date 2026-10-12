import { DEPTH_LEVELS, type Mastery, type MaterialKind, type PlanItem, type PlanItemKind, type TopicNode } from "./types";

/**
 * Progressive (spiral) study plan.
 *
 * The course is covered in several passes. Pass k studies every topic that still
 * needs work at depth k, so each pass revisits the same material one level deeper
 * (Survey -> Understand -> Apply -> Master) until the target level.
 *
 * Where a topic enters the spiral depends on how the student marked it:
 *   don't know / unmarked -> starts at depth 1
 *   familiar              -> starts at depth 2
 *   know                  -> a quick diagnostic in pass 1, then a confirmation at the target depth
 * Depth already achieved is skipped, except that a topic marked "don't know" after
 * studying it (e.g. from a failed checkpoint) repeats its current depth.
 *
 * Around the spiral:
 *   - pass 1 opens each branch with an overview; the final pass closes it with a synthesis
 *   - passes 2+ interleave branches instead of finishing one branch before the next
 *   - each pass ends with a checkpoint quiz
 *   - short recall warm-ups revisit topics studied 1, 3 and 7 days earlier (spacing)
 *   - the day before the exam is kept for a full mock exam and weak-topic review
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
const RECALL_GAPS = [1, 3, 7];
const RECALL_RESERVE = 10; // minutes per day kept for recall warm-ups

export function startDepth(mastery: Mastery | null, target: number, achieved: number): number {
  if (mastery === "dont_know" && achieved > 0) return Math.min(achieved, target);
  const fromMark = mastery === "know" ? target : mastery === "familiar" ? Math.min(2, target) : 1;
  return Math.max(fromMark, achieved + 1);
}

export interface StudyUnit {
  node: TopicNode;
  path: string[];
  branch: TopicNode; // top-level ancestor (the unit itself for a lone top-level topic)
}

/** Leaves are the study units; parents only group them. */
export function studyUnits(roots: TopicNode[]): StudyUnit[] {
  const out: StudyUnit[] = [];
  const walk = (ns: TopicNode[], path: string[], branch: TopicNode | null) => {
    for (const n of ns) {
      const b = branch ?? n;
      if (n.children.length) walk(n.children, [...path, n.title], b);
      else out.push({ node: n, path, branch: b });
    }
  };
  walk(roots, [], null);
  return out;
}

interface Slot {
  kind: PlanItemKind;
  iteration: number;
  depth: number;
  minutes: number;
  topic: TopicNode | null;
  title: string;
  activities: string[];
  priority: number; // higher survives longer when time is short
}

/** Round-robin across branches, keeping each branch's own order (prerequisites first). */
function interleave(units: StudyUnit[]): StudyUnit[] {
  const groups = new Map<string, StudyUnit[]>();
  for (const u of units) groups.set(u.branch.id, [...(groups.get(u.branch.id) ?? []), u]);
  const queues = [...groups.values()];
  const out: StudyUnit[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

export function buildPlan(input: PlanInput): DraftPlan {
  const target = Math.min(4, Math.max(1, Math.round(input.targetLevel)));
  const units = studyUnits(input.roots);
  const warnings: string[] = [];
  const kindsOf = (n: TopicNode) => new Set(n.material_ids.map((id) => input.materialKinds.get(id)).filter(Boolean) as MaterialKind[]);
  const imp = (n: TopicNode) => Math.min(3, Math.max(1, n.importance));
  const start = (u: StudyUnit) => startDepth(u.node.effective_mastery, target, u.node.achieved_depth);

  // 1. Lay out the spiral.
  const slots: Slot[] = [];
  let iterations = 0;
  for (let k = 1; k <= target; k++) {
    let pass = units.filter((u) => start(u) <= k);
    const diagnostics =
      k === 1 && target > 1 ? units.filter((u) => u.node.effective_mastery === "know" && start(u) > 1 && u.node.achieved_depth === 0) : [];
    if (!pass.length && !diagnostics.length) continue;
    iterations++;
    if (k > 1) pass = interleave(pass);

    const lastOfBranch = new Map<string, number>();
    pass.forEach((u, i) => lastOfBranch.set(u.branch.id, i));
    const opened = new Set<string>();

    // Diagnostics for "know" topics come first, while there's still time to react.
    for (const u of diagnostics) {
      slots.push({
        kind: "diagnostic",
        iteration: k,
        depth: target,
        minutes: 10,
        topic: u.node,
        title: u.node.title,
        activities: [
          "Answer the 'Check yourself' questions from the lesson without notes",
          "All easy? Keep it as Know. Stuck on any? Mark it Familiar and reschedule the plan",
        ],
        priority: 25,
      });
    }

    pass.forEach((u, i) => {
      const hasBranch = u.branch.id !== u.node.id;
      if (k === 1 && hasBranch && !opened.has(u.branch.id)) {
        opened.add(u.branch.id);
        slots.push({
          kind: "overview",
          iteration: k,
          depth: 1,
          minutes: 15,
          topic: u.branch,
          title: u.branch.title,
          activities: [
            "Read the branch overview and look at how its subtopics connect in the brainmap",
            "Write one sentence on what each subtopic is for",
          ],
          priority: 22,
        });
      }
      const depth = k;
      slots.push({
        kind: "study",
        iteration: k,
        depth,
        minutes: Math.round(BASE_MINUTES[depth] * IMPORTANCE_FACTOR[imp(u.node)]),
        topic: u.node,
        title: u.node.title,
        activities: activitiesFor(depth, kindsOf(u.node), u.node.effective_mastery),
        priority: (depth === target ? 30 : depth === start(u) ? 20 : 10) + imp(u.node),
      });
      if (k === target && hasBranch && lastOfBranch.get(u.branch.id) === i) {
        slots.push({
          kind: "synthesis",
          iteration: k,
          depth,
          minutes: 20,
          topic: u.branch,
          title: u.branch.title,
          activities: [
            "Draw the branch from memory: its subtopics and how they depend on each other",
            "Answer one exam question that needs several subtopics together",
          ],
          priority: 24,
        });
      }
    });

    if (pass.length) {
      slots.push({
        kind: "checkpoint",
        iteration: k,
        depth: k,
        minutes: Math.min(45, 10 + pass.length * 2),
        topic: null,
        title: `Checkpoint: end of pass ${k} (${DEPTH_LEVELS[k - 1].name})`,
        activities: checkpointActivities(k, pass.length),
        priority: k === target ? 100 : 5,
      });
    }
  }

  if (!units.length) warnings.push("Build the brainmap first: there are no topics to plan yet.");
  else if (!slots.length) warnings.push("Every topic is already at the target level. Raise the target level or mark topics you want to revisit.");

  // 2. Calendar. The exam day itself is not a study day.
  const parsedStart = parseDate(input.startDate);
  const startDate = Number.isNaN(parsedStart.getTime()) ? parseDate(fmtDate(new Date())) : parsedStart;
  const exam = input.examDate ? parseDate(input.examDate) : null;
  const hasExam = exam !== null && !Number.isNaN(exam.getTime());
  let end = hasExam ? exam : addDays(startDate, DEFAULT_SPAN_DAYS);
  let studyDays = daysBetween(startDate, end);
  if (studyDays < 1) {
    warnings.push(
      hasExam && studyDays < 0
        ? "The exam date has passed. Update it in the plan settings; for now the plan covers one day."
        : "The exam is today, so the plan fits into a single day. Focus on the checkpoints and core topics.",
    );
    studyDays = 1;
    end = addDays(startDate, 1);
  }
  const dailyMinutes = Math.max(15, Math.round(input.hoursPerDay * 60));
  // Keep the last day before the exam for a final mock exam when there's room.
  const finalDay = hasExam && studyDays >= 4 && slots.length > 0;
  const spiralDays = finalDay ? studyDays - 1 : studyDays;
  const reserve = spiralDays > 1 ? Math.min(RECALL_RESERVE, Math.floor(dailyMinutes / 6)) : 0;
  const capacity = spiralDays * (dailyMinutes - reserve);
  const totalStudy = slots.reduce((sum, x) => sum + x.minutes, 0);

  // When even minimum-length sessions can't fit, drop the least valuable ones.
  let kept = slots;
  if (slots.length * MIN_ITEM_MINUTES > capacity) {
    const maxSlots = Math.max(1, Math.floor(capacity / MIN_ITEM_MINUTES));
    const keep = new Set(
      slots
        .map((x, i) => ({ i, p: x.priority }))
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
  const keptTotal = kept.reduce((sum, x) => sum + x.minutes, 0);
  const fitted = (scale: number) => kept.map((x) => Math.max(MIN_ITEM_MINUTES, Math.round(x.minutes * scale)));
  let scale = keptTotal > capacity ? capacity / keptTotal : 1;
  let minutesList = fitted(scale);
  while (scale > 0.01 && minutesList.reduce((a, m) => a + m, 0) > capacity) {
    scale *= 0.95;
    minutesList = fitted(scale);
  }
  if (scale < 1 && kept.length === slots.length) {
    const needDays = Math.ceil(totalStudy / (dailyMinutes - reserve));
    warnings.push(
      `The full plan needs about ${hours(totalStudy)} but only ${hours(capacity)} fit before ${hasExam ? "the exam" : "the end date"}. ` +
        `Sessions were shortened by about ${Math.round((1 - scale) * 100)}%. Studying ${Math.ceil((totalStudy / spiralDays + reserve) / 6) / 10}h/day or starting ${needDays - spiralDays} day(s) earlier would avoid that.`,
    );
  }

  // Spread sessions evenly over the spiral days, never beyond the daily budget.
  const placed: { slot: Slot; minutes: number; day: number }[] = [];
  const budget = dailyMinutes - reserve;
  let day = 0;
  let used = 0;
  let remaining = minutesList.reduce((a, m) => a + m, 0);
  let todayTarget = Math.min(budget, Math.ceil(remaining / spiralDays) + 10);
  kept.forEach((s, idx) => {
    const minutes = minutesList[idx];
    if (used > 0 && used + minutes > todayTarget && day < spiralDays - 1) {
      day++;
      used = 0;
      todayTarget = Math.min(budget, Math.ceil(remaining / (spiralDays - day)) + 10);
    }
    used += minutes;
    remaining -= minutes;
    placed.push({ slot: s, minutes, day });
  });

  // Spaced recall: a short warm-up revisiting topics studied 1, 3 and 7 days earlier.
  const studiedOn = new Map<number, string[]>();
  for (const p of placed) if (p.slot.kind === "study") studiedOn.set(p.day, [...(studiedOn.get(p.day) ?? []), p.slot.title]);
  const lastDay = finalDay ? spiralDays : spiralDays - 1;
  const items: DraftItem[] = [];
  const push = (d: number, it: Omit<DraftItem, "day" | "date" | "done" | "position">) =>
    items.push({ ...it, day: d + 1, date: fmtDate(addDays(startDate, d)), done: false, position: items.length });

  for (let d = 0; d <= lastDay; d++) {
    if (reserve > 0) {
      const due = [...new Set(RECALL_GAPS.flatMap((g) => studiedOn.get(d - g) ?? []))];
      if (due.length) {
        push(d, {
          iteration: placed.find((p) => p.day === d)?.slot.iteration ?? iterations,
          kind: "recall",
          topic_id: null,
          topic_title: `Recall warm-up (${due.length} topic${due.length === 1 ? "" : "s"})`,
          depth: 1,
          minutes: reserve,
          activities: [`From memory, jot down the key ideas of: ${due.slice(0, 8).join(", ")}${due.length > 8 ? ` and ${due.length - 8} more` : ""}`, "Then check against your notes and fix what you missed", "Clear today's due flashcards"],
        });
      }
    }
    for (const p of placed.filter((x) => x.day === d)) {
      push(d, {
        iteration: p.slot.iteration,
        kind: p.slot.kind,
        topic_id: p.slot.topic?.id ?? null,
        topic_title: p.slot.title,
        depth: p.slot.depth,
        minutes: p.minutes,
        activities: p.slot.activities,
      });
    }
  }

  if (finalDay) {
    const d = studyDays - 1;
    push(d, {
      iteration: iterations,
      kind: "final",
      topic_id: null,
      topic_title: "Final mock exam",
      depth: target,
      minutes: Math.min(120, Math.round(dailyMinutes * 0.6)),
      activities: ["Generate a full mock exam for the whole course and sit it under exam conditions", "Mark it honestly and note every topic you lost marks on"],
    });
    push(d, {
      iteration: iterations,
      kind: "final",
      topic_id: null,
      topic_title: "Review weak topics",
      depth: target,
      minutes: Math.max(15, dailyMinutes - Math.min(120, Math.round(dailyMinutes * 0.6))),
      activities: ["Generate cheat-sheet review notes for weak topics and read them twice", "Get a good night's sleep: no new material tonight"],
    });
  }

  return {
    start_date: fmtDate(startDate),
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
      a.push("Read the level 1 lesson and skim the source material");
      if (kinds.has("slides")) a.push("Flip through the slides, noting headings and diagrams");
      if (kinds.has("youtube") || kinds.has("video") || kinds.has("audio_memo")) a.push("Watch or listen to the recording at 1.5x for orientation");
      a.push("Write down 3-5 key terms and a one-line definition of each");
      break;
    case 2:
      a.push("Start with the lesson's recall questions on level 1, then study the level 2 lesson");
      if (kinds.has("lecture_notes") || kinds.has("reading") || kinds.has("pdf")) a.push("Make structured notes: definitions, how parts connect, why it works");
      a.push("Explain the topic aloud without notes (Feynman technique)");
      a.push("Create 3-5 flashcards for the ideas you found hardest");
      break;
    case 3:
      if (kinds.has("tutorial") || kinds.has("workshop")) a.push("Redo the related tutorial / workshop problems without looking at solutions");
      if (kinds.has("sample_exam")) a.push("Attempt the matching sample exam questions under time pressure");
      a.push("Work through the lesson's worked examples, then solve the practice problems yourself");
      a.push("Review your flashcards");
      break;
    default:
      a.push("Answer exam-style questions from memory, including tricky edge cases");
      a.push("Compare this topic with related ones: similarities, differences, when to use which");
      if (kinds.has("sample_exam")) a.push("Do a timed sample-exam section and mark it strictly");
      a.push("Teach it back: write a half-page summary from memory, then check gaps");
  }
  if (mastery === "know") a.unshift("Confirm you still know it: if the lesson questions feel hard, mark it Familiar and reschedule");
  return a;
}

function checkpointActivities(iteration: number, count: number): string[] {
  return [
    `Take the checkpoint quiz on this pass (${count} topic${count === 1 ? "" : "s"}, ${DEPTH_LEVELS[iteration - 1].name.toLowerCase()}-level questions)`,
    "Apply the results to your brainmap marks, then reschedule so weak topics are repeated",
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
