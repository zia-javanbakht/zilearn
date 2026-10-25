// The offline evaluation (eval/score.py): runs with EVAL_OUT=dir set, else it is skipped. For each fixture
// paper it writes the extracted text, the keyword digest and the course brainmap built from it offline.
import { test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractFile, guessKind } from "@/lib/extract";
import { buildTree, createCourse, flattenTree, insertMaterial, listMaterials, listTopics, replaceTopics } from "@/lib/store";
import { digestNow } from "@/lib/digest";
import { structureCourse } from "@/lib/brainmap";

const OUT = process.env.EVAL_OUT ?? "";
const DOCS = (process.env.DOCS ?? "abs2024,simo1990,Thompson_nlcm,bal,csd_l7").split(",");

const run = process.env.EVAL_OUT ? test : test.skip;
for (const DOC of DOCS)
  run(DOC, async () => {
    mkdirSync(OUT, { recursive: true });
    const course = createCourse({ name: DOC });
    const r = await extractFile(readFileSync(`tests/fixtures/papers/${DOC}.pdf`), `${DOC}.pdf`, "application/pdf");
    writeFileSync(`${OUT}/${DOC}.txt`, r.text);
    insertMaterial({ course_id: course.id, kind: guessKind(`${DOC}.pdf`), title: DOC, source_type: "file", filename: `${DOC}.pdf`, mime: "application/pdf", path: null, url: null, text: r.text, status: r.status, note: r.note } as any);
    const mats = digestNow(listMaterials(course.id, true));
    const d = mats[0].digest!;
    writeFileSync(`${OUT}/${DOC}.digest.json`, JSON.stringify(d, null, 1));
    const s = await structureCourse(course, listMaterials(course.id, true));
    replaceTopics(course.id, s.topics);
    const nodes = flattenTree(buildTree(listTopics(course.id)));
    writeFileSync(`${OUT}/${DOC}.brainmap.json`, JSON.stringify({ summary: s.summary, nodes: nodes.map((n) => ({ depth: n.depth ?? 0, title: n.title, summary: n.summary, keywords: n.keywords, importance: n.importance })) }, null, 1));
    writeFileSync(`${OUT}/${DOC}.brainmap.md`, `Course summary: ${s.summary}\n\n` + nodes.map((n) => `${"  ".repeat(n.depth ?? 0)}- ${n.title} (imp ${n.importance}) :: ${n.summary}`).join("\n"));
  }, 300000);
