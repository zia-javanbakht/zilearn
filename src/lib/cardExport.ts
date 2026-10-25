import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { marked } from "marked";
import type { Card } from "./types";

/**
 * Flashcards out of ziLearn: a CSV for spreadsheets and Quizlet, and an Anki package (.apkg) with
 * Basic and Cloze notes, maths in Anki's MathJax delimiters, and the topic as a tag.
 */

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per card, as stored: cloze fronts keep their {{c1::...}} markup. */
export function cardsCsv(cards: Card[]): string {
  const head = ["front", "back", "type", "cloze", "topic", "due", "stability_days", "difficulty", "reviews", "lapses"];
  const rows = cards.map((c) => [c.front, c.back, c.kind, c.kind === "cloze" ? c.ord : "", c.topic_title ?? "", c.due ?? "new", c.stability ?? "", c.difficulty ?? "", c.reps, c.lapses]);
  // The byte-order mark makes Excel read it as UTF-8 (maths symbols, accents).
  return "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** A Mermaid flowchart as an indented list of its boxes (Anki can't draw Mermaid). */
export function diagramAsList(code: string): string {
  const labels = new Map<string, string>();
  for (const m of code.matchAll(/(\w+)\s*[[({]+"?([^"\])}]*)"?[\])}]+/g)) labels.set(m[1], m[2]);
  const edges = [...code.matchAll(/(\w+)(?:\s*[[({]+[^\])}]*[\])}]+)?\s*-[-.]*>\s*(\w+)/g)].map((m) => [m[1], m[2]] as const);
  const children = new Map<string, string[]>();
  for (const [a, b] of edges) children.set(a, [...(children.get(a) ?? []), b]);
  const roots = [...labels.keys()].filter((k) => !edges.some(([, b]) => b === k));
  const render = (id: string, seen: Set<string>): string => {
    if (seen.has(id)) return "";
    seen.add(id);
    const kids = (children.get(id) ?? []).map((k) => render(k, seen)).filter(Boolean);
    return `<li>${escapeHtml(labels.get(id) ?? id)}${kids.length ? `<ul>${kids.join("")}</ul>` : ""}</li>`;
  };
  const seen = new Set<string>();
  return `<ul>${roots.map((r) => render(r, seen)).join("")}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Card Markdown as HTML for Anki. Maths becomes \(...\) and \[...\]; cloze markup passes through
 * untouched, since Anki reads {{c1::...}} itself.
 */
export function toAnkiHtml(md: string): string {
  const keep: string[] = [];
  const hold = (s: string) => `\uE000${keep.push(s) - 1}\uE000`;
  let s = md.replace(/```mermaid\n([\s\S]*?)```/g, (_a, code: string) => hold(diagramAsList(code)));
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_a, m: string) => hold(`\\[${escapeHtml(m.trim())}\\]`));
  s = s.replace(/(?<![\\$])\$([^$\n]+?)\$/g, (_a, m: string) => hold(`\\(${escapeHtml(m.trim())}\\)`));
  s = s.replace(/\{\{c\d+::/g, (m) => hold(m)).replace(/\}\}/g, (m) => hold(m));
  let html = (marked.parse(s, { async: false, gfm: true, breaks: false }) as string).trim();
  // A single paragraph needs no <p> around it.
  const single = /^<p>([\s\S]*)<\/p>$/.exec(html);
  if (single && !single[1].includes("<p>")) html = single[1];
  return html.replace(/\uE000(\d+)\uE000/g, (_a, i: string) => keep[Number(i)]);
}

const CSS = `.card { font-family: system-ui, sans-serif; font-size: 20px; text-align: left; color: black; background: white; line-height: 1.5; }
.cloze { font-weight: bold; color: #3b5bdb; }
.nightMode .cloze { color: #7c93ff; }
.topic { font-size: 14px; color: #888; }`;

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function checksum(sortField: string): number {
  return parseInt(crypto.createHash("sha1").update(stripHtml(sortField)).digest("hex").slice(0, 8), 16);
}

function guid(): string {
  // Anki's guids are short random strings; any unique printable string works.
  return crypto.randomBytes(8).toString("base64url");
}

/** An Anki package (.apkg) with the cards as new cards in one deck named after the course. */
export async function cardsApkg(deckName: string, cards: Card[]): Promise<Buffer> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zilearn-apkg-"));
  const file = path.join(tmp, "collection.anki2");
  try {
    const d = new Database(file);
    d.exec(`
      CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
      CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
      CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
      CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
      CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
      CREATE INDEX ix_notes_usn on notes (usn);
      CREATE INDEX ix_cards_usn on cards (usn);
      CREATE INDEX ix_revlog_usn on revlog (usn);
      CREATE INDEX ix_cards_nid on cards (nid);
      CREATE INDEX ix_cards_sched on cards (did, queue, due);
      CREATE INDEX ix_revlog_cid on revlog (cid);
      CREATE INDEX ix_notes_csum on notes (csum);
    `);
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const did = now;
    const basicId = now + 1;
    const clozeId = now + 2;
    const field = (name: string, ord: number) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] });
    const model = (id: number, name: string, type: 0 | 1, flds: string[], qfmt: string, afmt: string) => ({
      id,
      name,
      type,
      mod: sec,
      usn: -1,
      sortf: 0,
      did,
      tmpls: [{ name: type === 1 ? "Cloze" : "Card 1", ord: 0, qfmt, afmt, did: null, bqfmt: "", bafmt: "" }],
      flds: flds.map(field),
      css: CSS,
      latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}",
      ...(type === 0 ? { req: [[0, "any", [0]]] } : {}),
      tags: [],
      vers: [],
    });
    const models = {
      [basicId]: model(basicId, "ziLearn Basic", 0, ["Front", "Back", "Topic"], "{{Front}}", '{{FrontSide}}<hr id="answer">{{Back}}{{#Topic}}<p class="topic">{{Topic}}</p>{{/Topic}}'),
      [clozeId]: model(clozeId, "ziLearn Cloze", 1, ["Text", "Back Extra", "Topic"], "{{cloze:Text}}", "{{cloze:Text}}<br>{{Back Extra}}{{#Topic}}<p class=\"topic\">{{Topic}}</p>{{/Topic}}"),
    };
    const deck = (id: number, name: string) => ({ id, name, mod: sec, usn: -1, desc: "", dyn: 0, conf: 1, collapsed: false, extendNew: 10, extendRev: 50, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0] });
    const decks = { 1: deck(1, "Default"), [did]: deck(did, deckName.replace(/::/g, ":") || "ziLearn") };
    const dconf = {
      1: {
        id: 1, name: "Default", mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
        new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, separate: true, order: 1, perDay: 20, bury: true },
        lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
        rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: true },
      },
    };
    const conf = { nextPos: 1, estTimes: true, activeDecks: [1], sortType: "noteFld", timeLim: 0, sortBackwards: false, addToCur: true, curDeck: 1, newSpread: 0, dueCounts: true, curModel: String(basicId), collapseTime: 1200 };
    d.prepare("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')").run(sec - (sec % 86400), now, now, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf));

    const insNote = d.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
    const insCard = d.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");
    // Cloze cards that share a front are one note with a card per deletion.
    const notes = new Map<string, Card[]>();
    for (const c of [...cards].reverse()) {
      const key = c.kind === "cloze" ? `cloze:${c.front}` : `card:${c.id}`;
      notes.set(key, [...(notes.get(key) ?? []), c]);
    }
    let id = now;
    let pos = 0;
    d.transaction(() => {
      for (const group of notes.values()) {
        const c = group[0];
        const cloze = c.kind === "cloze";
        const topic = c.topic_title ?? "";
        const fields = [toAnkiHtml(c.front), toAnkiHtml(c.back), escapeHtml(topic)];
        const tags = topic ? ` ${topic.replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "")} ` : "";
        const nid = ++id;
        insNote.run(nid, guid(), cloze ? clozeId : basicId, sec, tags, fields.join("\x1f"), stripHtml(fields[0]), checksum(fields[0]));
        for (const g of cloze ? group.sort((a, b) => a.ord - b.ord) : group) insCard.run(++id, nid, did, cloze ? Math.max(0, g.ord - 1) : 0, sec, ++pos);
      }
    })();
    d.close();
    const zip = new JSZip();
    zip.file("collection.anki2", fs.readFileSync(file));
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
