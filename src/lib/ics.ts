import { DEPTH_LEVELS, type Course, type PlanItem } from "./types";

/**
 * iCalendar (RFC 5545) export of a study plan. Times are "floating" (no time zone), so every calendar
 * app shows them at the chosen local time wherever the student is. Event UIDs are stable per plan item,
 * so importing again or a subscribed calendar refreshing updates events instead of duplicating them.
 */

export interface IcsOptions {
  start: string; // "HH:MM" local start time of each day's study block
  mode: "sessions" | "days"; // one event per session, or one event per day
  breakMinutes: number; // gap between sessions in "sessions" mode
  includeDone: boolean;
  from?: string; // YYYY-MM-DD: leave out earlier days
  appUrl?: string; // link back to the plan in ziLearn
  reminderMinutes: number | null; // alert before each day's first event
  now?: Date; // for DTSTAMP (tests)
}

const KIND: Record<PlanItem["kind"], string> = {
  study: "📘",
  checkpoint: "✅ Checkpoint",
  diagnostic: "🔎 Quick check",
  overview: "🗺 Overview",
  synthesis: "🔗 Synthesis",
  recall: "🧠 Recall warm-up",
  final: "🎯",
};

export function itemSummary(it: PlanItem, courseName: string): string {
  const level = DEPTH_LEVELS[Math.min(4, Math.max(1, it.depth)) - 1]?.name;
  const what =
    it.kind === "study"
      ? `${KIND.study} ${it.topic_title} (pass ${it.iteration}: ${level})`
      : it.kind === "final" || it.kind === "recall"
        ? `${KIND[it.kind]} ${it.topic_title}`
        : `${KIND[it.kind]}: ${it.topic_title}`;
  return `${what} · ${courseName}`;
}

/** Escape a TEXT value (RFC 5545 §3.3.11). */
export function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1), never splitting a UTF-8 character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const ymd = (date: string) => date.replace(/-/g, "");

function localStamp(date: string, minutesFromMidnight: number): string {
  const day = Math.floor(minutesFromMidnight / 1440);
  const m = minutesFromMidnight % 1440;
  const d = day ? new Date(Date.parse(date) + day * 86400000).toISOString().slice(0, 10) : date;
  return `${ymd(d)}T${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}00`;
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function describe(it: PlanItem, appUrl?: string): string {
  return [...it.activities.map((a) => `• ${a}`), ...(appUrl ? ["", `Open in ziLearn: ${appUrl}`] : [])].join("\n");
}

export function buildIcs(course: Course, items: PlanItem[], o: IcsOptions): string {
  const [h, m] = o.start.split(":").map(Number);
  const startMin = (Number.isFinite(h) ? h : 18) * 60 + (Number.isFinite(m) ? m : 0);
  const stamp = utcStamp(o.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ziLearn//Study plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`${course.name} study plan`)}`,
    "X-PUBLISHED-TTL:PT6H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  ];
  const alarm = (title: string) =>
    o.reminderMinutes == null
      ? []
      : ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, `TRIGGER:-PT${Math.max(0, Math.round(o.reminderMinutes))}M`, "END:VALARM"];
  const event = (uid: string, start: string, end: string, summary: string, description: string, withAlarm: boolean, done = false) => [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(summary)}`,
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    "CATEGORIES:Study",
    "TRANSP:OPAQUE",
    ...(done ? ["STATUS:CONFIRMED", "X-ZILEARN-DONE:TRUE"] : []),
    ...(withAlarm ? alarm(summary) : []),
    "END:VEVENT",
  ];

  const byDay = new Map<string, PlanItem[]>();
  for (const it of items) {
    if (!o.includeDone && it.done) continue;
    if (o.from && it.date < o.from) continue;
    byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
  }
  for (const [date, dayItems] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (o.mode === "days") {
      const total = dayItems.reduce((s, it) => s + it.minutes, 0);
      const summary = `📚 ${course.name}: ${dayItems.length} session${dayItems.length === 1 ? "" : "s"} (${Math.round(total / 6) / 10}h)`;
      const description = dayItems.map((it) => `${itemSummary(it, course.name).replace(` · ${course.name}`, "")} · ${it.minutes} min${it.done ? " ✓" : ""}`).join("\n");
      lines.push(...event(`day-${date}-${course.id}@zilearn`, localStamp(date, startMin), localStamp(date, startMin + total), summary, description + (o.appUrl ? `\n\nOpen in ziLearn: ${o.appUrl}` : ""), true));
    } else {
      let t = startMin;
      dayItems.forEach((it, i) => {
        lines.push(...event(`${it.id}@zilearn`, localStamp(date, t), localStamp(date, t + it.minutes), itemSummary(it, course.name), describe(it, o.appUrl), i === 0, it.done));
        t += it.minutes + o.breakMinutes;
      });
    }
  }
  if (course.exam_date) {
    const next = new Date(Date.parse(course.exam_date) + 86400000).toISOString().slice(0, 10);
    lines.push(
      "BEGIN:VEVENT",
      `UID:exam-${course.id}@zilearn`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(course.exam_date)}`,
      `DTEND;VALUE=DATE:${ymd(next)}`,
      `SUMMARY:${esc(`🎓 Exam: ${course.name}`)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
