import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { openDb, setDb } from "@/lib/db";
import { addCards, buildTree, createCourse, listCards, listTopics, replaceTopics, updateCard } from "@/lib/store";
import { clozeAnswer, clozeNumbers, clozePlain, renderCloze } from "@/lib/cloze";
import { answerQuestion, checkCitations, listChat, retrieve } from "@/lib/ask";
import { cardsApkg, cardsCsv, diagramAsList, toAnkiHtml } from "@/lib/cardExport";
import { cardFront, markTyped, shortAnswer, topicGivesAway } from "@/lib/cardView";
import { answer, nextQuestion, progress, startLearn, type LearnCard } from "@/lib/learn";
import { generateCards, labelCards } from "@/lib/generate";
import { dynamicsCourse } from "./fixtures/dynamics";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

beforeEach(() => setDb(openDb(":memory:")));

describe("cloze deletions", () => {
  const note = "The {{c1::mitochondrion}} makes {{c2::ATP::a molecule}} from {{c1::glucose}}.";

  it("hides one number at a time and shows the rest", () => {
    expect(clozeNumbers(note)).toEqual([1, 2]);
    expect(renderCloze(note, 1, false)).toBe("The **[…]** makes ATP from **[…]**.");
    expect(renderCloze(note, 2, false)).toBe("The mitochondrion makes **[a molecule]** from glucose.");
    expect(renderCloze(note, 2, true)).toBe("The mitochondrion makes **[ATP]** from glucose.");
    expect(clozeAnswer(note, 1)).toBe("mitochondrion, glucose");
    expect(clozePlain(note)).toBe("The mitochondrion makes ATP from glucose.");
  });

  it("keeps braces in maths and boxes the gap so KaTeX still renders", () => {
    const m = "Natural frequency: $\\omega_n = {{c1::\\sqrt{k/m}}}$.";
    expect(clozeAnswer(m, 1)).toBe("\\sqrt{k/m}");
    expect(renderCloze(m, 1, false)).toBe("Natural frequency: $\\omega_n = \\boxed{?}$.");
    expect(renderCloze(m, 1, true)).toBe("Natural frequency: $\\omega_n = \\boxed{\\sqrt{k/m}}$.");
  });

  it("stores a note as one card per number, and edits them together", () => {
    const c = createCourse({ name: "Bio" });
    expect(addCards(c.id, [{ front: note, back: "", topic_id: null }], "manual", "student")).toBe(2);
    expect(addCards(c.id, [{ front: note, back: "", topic_id: null }], "manual", "student")).toBe(0);
    const cards = listCards(c.id);
    expect(cards.map((x) => [x.kind, x.ord]).sort()).toEqual([["cloze", 1], ["cloze", 2]]);
    // Adding a third deletion adds a card; dropping the second removes its card.
    const first = cards.find((x) => x.ord === 1)!;
    updateCard(first.id, { front: "The {{c1::mitochondrion}} makes ATP in {{c3::cells}}." });
    expect(listCards(c.id).map((x) => x.ord).sort()).toEqual([1, 3]);
    expect(listCards(c.id).find((x) => x.ord === 1)!.id).toBe(first.id);
  });
});

describe("Ask this course", () => {
  it("finds the passages about the question, a short follow-up included", () => {
    const { course } = dynamicsCourse();
    const hits = retrieve(course.id, "What is the logarithmic decrement?", null);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].n).toBe(1);
    expect(hits.some((h) => /logarithmic decrement/i.test(h.text))).toBe(true);
    expect(retrieve(course.id, "why?", "How is the logarithmic decrement measured?").length).toBeGreaterThan(0);
  });

  it("answers offline with cited sentences from the materials", async () => {
    const { course } = dynamicsCourse();
    const a = await answerQuestion(course.id, "What is the logarithmic decrement?");
    expect(a.by).toBe("heuristic");
    expect(a.text).toMatch(/logarithmic decrement/i);
    expect(a.text).toMatch(/\[\d\]/);
    // Every [n] in the answer has its passage.
    const used = [...a.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    for (const n of used) expect(a.citations.some((c) => c.n === n)).toBe(true);
    expect(a.citations[0].title).toBeTruthy();
  });

  it("says so when the materials don't cover the question", async () => {
    const { course } = dynamicsCourse();
    const a = await answerQuestion(course.id, "Who won the 1966 football world cup?");
    expect(a.citations).toEqual([]);
    expect(a.text).toMatch(/couldn't find/);
  });

  it("drops citations to passages that don't exist, and leaves maths alone", () => {
    expect(checkCitations("A [1]. B [7]. C [2, 3]. D $x \\in [0, 1]$.", 3)).toEqual({ text: "A [1]. B [7]. C [2][3]. D $x \\in [0, 1]$.", used: [1, 2, 3] });
  });

  it("keeps the conversation per course", async () => {
    const { addChat } = await import("@/lib/ask");
    const c = createCourse({ name: "X" });
    addChat(c.id, { role: "user", content: "Q", citations: [], generated_by: "student" });
    addChat(c.id, { role: "assistant", content: "A [1]", citations: [{ n: 1, material_id: "m", title: "T", chunk_index: 0, text: "t" }], generated_by: "heuristic" });
    expect(listChat(c.id).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(listChat(c.id)[1].citations[0].title).toBe("T");
  });
});

describe("card export", () => {
  function deck() {
    const c = createCourse({ name: "Dynamics", code: "CIV301" });
    addCards(
      c.id,
      [
        { front: "What is $\\omega_n$?", back: "$$\\omega_n = \\sqrt{k/m}$$\n\nThe **natural** frequency.", topic_id: null },
        { front: "Damping is {{c1::viscous}}, with ratio {{c2::$\\zeta$}}.", back: "", topic_id: null },
        { front: 'Name the box:\n\n```mermaid\nflowchart TD\n  p["SDOF"]\n  p --> c0["?"]\n  p --> c1["Damping"]\n```', back: "**Mass**", topic_id: null, kind: "label" },
      ],
      "manual",
      "student",
    );
    return c;
  }

  it("writes Anki's maths delimiters and HTML", () => {
    expect(toAnkiHtml("What is $\\omega_n$?")).toBe("What is \\(\\omega_n\\)?");
    expect(toAnkiHtml("$$a<b$$\n\n**x**")).toBe("<p>\\[a&lt;b\\]</p>\n<p><strong>x</strong></p>");
    expect(toAnkiHtml("A {{c1::*b*}}")).toBe("A {{c1::<em>b</em>}}");
    expect(diagramAsList('flowchart TD\n  p["SDOF"]\n  p --> c0["?"]\n  p --> c1["Damping"]')).toBe("<ul><li>SDOF<ul><li>?</li><li>Damping</li></ul></li></ul>");
  });

  it("makes a CSV with one row per card", () => {
    const c = deck();
    const csv = cardsCsv(listCards(c.id));
    expect(csv.startsWith("\uFEFFfront,back,type")).toBe(true);
    // Rows end in \r\n; line breaks inside a quoted card are plain \n.
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(1 + 4);
    expect(rows.slice(1).filter((r) => r.includes(",cloze,"))).toHaveLength(2);
  });

  it("builds an Anki package: one note per cloze note, a card per deletion", async () => {
    const c = deck();
    const buf = await cardsApkg("CIV301 Dynamics", listCards(c.id));
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(["collection.anki2", "media"]);
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apkg-")), "c.anki2");
    fs.writeFileSync(file, await zip.file("collection.anki2")!.async("nodebuffer"));
    const d = new Database(file, { readonly: true });
    const col = d.prepare("SELECT models, decks FROM col").get() as { models: string; decks: string };
    const models = Object.values(JSON.parse(col.models)) as { id: number; type: number }[];
    const cloze = models.find((m) => m.type === 1)!;
    expect(Object.values(JSON.parse(col.decks)).map((x) => (x as { name: string }).name)).toContain("CIV301 Dynamics");
    const notes = d.prepare("SELECT id, mid, flds FROM notes").all() as { id: number; mid: number; flds: string }[];
    expect(notes).toHaveLength(3);
    const clozeNote = notes.find((n) => n.mid === cloze.id)!;
    expect(clozeNote.flds.split("\x1f")[0]).toBe("Damping is {{c1::viscous}}, with ratio {{c2::\\(\\zeta\\)}}.");
    expect((d.prepare("SELECT ord FROM cards WHERE nid = ? ORDER BY ord").all(clozeNote.id) as { ord: number }[]).map((r) => r.ord)).toEqual([0, 1]);
    expect(d.prepare("SELECT COUNT(*) AS n FROM cards").get()).toEqual({ n: 4 });
    d.close();
  });
});

describe("how cards show", () => {
  const base = { topic_title: "Mitochondrion", back: "", ord: 1 };
  it("hides a topic name that would answer the card", () => {
    expect(topicGivesAway({ ...base, kind: "cloze", front: "The {{c1::mitochondrion}} makes ATP." })).toBe(true);
    expect(topicGivesAway({ ...base, kind: "basic", front: "What does the mitochondrion make?" })).toBe(false);
    expect(cardFront({ ...base, kind: "cloze", front: "The {{c1::mitochondrion}} makes ATP." })).toBe("The **[…]** makes ATP.");
  });

  it("marks typed answers, forgiving a typo but not a different word", () => {
    expect(markTyped("The Mitochondria", "mitochondria")).toBe("right");
    expect(markTyped("mitochondira", "mitochondria")).toBe("close");
    expect(markTyped("ribosome", "mitochondria")).toBe("wrong");
    expect(shortAnswer({ kind: "basic", ord: 0, front: "Q", back: "**Damping ratio**\n\nThe ratio c/c_cr." })).toBe("Damping ratio");
    expect(shortAnswer({ kind: "basic", ord: 0, front: "Q", back: "$\\omega = \\sqrt{k/m}$" })).toBeNull();
  });
});

describe("Learn mode", () => {
  const cards: LearnCard[] = ["alpha", "beta", "gamma", "delta", "epsilon"].map((w, i) => ({
    id: `c${i}`,
    kind: "basic",
    ord: 0,
    front: `Which letter is number ${i + 1}?`,
    back: w,
    topic_id: null,
    topic_title: null,
  }));

  it("asks multiple choice, then typed, until every card is mastered; a miss starts the card over", () => {
    let s = startLearn(cards);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const q = nextQuestion(s, rnd)!;
    expect(q.mode).toBe("choice");
    expect(q.options).toHaveLength(4);
    expect(q.options).toContain(q.answer);
    expect(new Set(q.options).size).toBe(4);
    s = answer(s, q, false);
    expect(s.items.find((i) => i.card.id === q.id)!.misses).toBe(1);
    let guard = 0;
    for (let next = nextQuestion(s, rnd); next; next = nextQuestion(s, rnd)) {
      if (s.items.find((i) => i.card.id === next!.id)!.stage === 1) expect(next.mode).toBe("typed");
      s = answer(s, next, true);
      expect(s.lastId).toBe(next.id);
      if (++guard > 50) throw new Error("never finished");
    }
    expect(progress(s)).toMatchObject({ total: 5, mastered: 5, done: true });
    expect(s.asked).toBe(11); // one miss, then two right answers per card
  });
});

describe("diagram-label and offline cloze cards", () => {
  it("hides one subtopic of a branch, and the generator mixes them in", async () => {
    const { course } = dynamicsCourse();
    const tree = buildTree(listTopics(course.id));
    const flat = (ns: typeof tree): typeof tree => ns.flatMap((n) => [n, ...flat(n.children)]);
    const labels = labelCards(flat(tree), 3);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(l.kind).toBe("label");
      expect(l.front).toContain('["?"]');
      const hidden = /\*\*(.+?)\*\*/.exec(l.back)![1];
      expect(l.front).not.toContain(hidden);
    }
    const out = await generateCards(course.id, { kind: "course" }, 20);
    expect(out.cards.some((c) => c.kind === "label")).toBe(true);
    expect(out.cards.filter((c) => c.kind === "cloze").every((c) => clozeNumbers(c.front).length === 1)).toBe(true);
  });

  it("doesn't make a diagram from a branch with too few subtopics", () => {
    const c = createCourse({ name: "Y" });
    replaceTopics(c.id, [
      { ref: "1", parent_ref: null, title: "A", summary: "", keywords: [], material_ids: [], importance: 2 },
      { ref: "1.1", parent_ref: "1", title: "B", summary: "", keywords: [], material_ids: [], importance: 2 },
    ]);
    expect(labelCards(buildTree(listTopics(c.id)), 5)).toEqual([]);
  });
});
