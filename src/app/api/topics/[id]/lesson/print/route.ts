import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lessonToTex, markdownLessonToTex } from "@/lib/latex";
import { getCourse, getLesson, getTopic } from "@/lib/store";
import { DEPTH_LEVELS } from "@/lib/types";
import { fail, handle, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** File name from the topic title: letters, digits and dashes. */
function fileName(title: string, depth: number) {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "lesson";
  return `${base}-level-${depth}`;
}

/** Run XeLaTeX on a file; resolves with its exit code, or null when it isn't installed. */
function xelatex(dir: string, file: string): Promise<number | null> {
  // Z_TEX_DIR points at the Z class's tex/latex folder when it isn't installed in the TeX tree.
  const z = process.env.Z_TEX_DIR;
  const env = { ...process.env, ...(z ? { TEXINPUTS: `${z}//${path.delimiter}${process.env.TEXINPUTS ?? ""}` } : {}) };
  return new Promise((resolve) => {
    const p = spawn(process.env.XELATEX ?? "xelatex", ["-no-shell-escape", "-interaction=nonstopmode", file], { cwd: dir, env, stdio: "ignore" });
    const timer = setTimeout(() => p.kill("SIGKILL"), 120_000);
    p.on("error", () => (clearTimeout(timer), resolve(null)));
    p.on("close", (code) => (clearTimeout(timer), resolve(code ?? 1)));
  });
}

/** The first error in a LaTeX log, with a few lines of context. */
function firstError(log: string): string {
  const lines = log.split("\n");
  const at = lines.findIndex((l) => l.startsWith("!") || /^[^:]+:\d+: /.test(l));
  return at < 0 ? lines.slice(-8).join("\n") : lines.slice(at, at + 6).join("\n");
}

/**
 * The lesson as a LaTeX document using the Z class (`?format=tex`, the default), or compiled to PDF
 * with XeLaTeX (`?format=pdf`) when TeX and the Z class are installed on this computer.
 */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const url = new URL(req.url);
  const depth = Math.min(4, Math.max(1, Math.round(Number(url.searchParams.get("depth")) || 1)));
  const topic = getTopic(id);
  if (!topic) return fail("This topic no longer exists.", 404);
  const lesson = getLesson(id, depth);
  if (!lesson) return fail("Open the lesson first, so there is something to print.", 404);
  const level = DEPTH_LEVELS[depth - 1];
  const source = lesson.doc
    ? lessonToTex(lesson.doc)
    : markdownLessonToTex({ title: topic.title, depth, level: level.name, goal: level.goal, map: { course: getCourse(topic.course_id)?.name ?? "", path: [] } }, lesson.content);
  const name = fileName(topic.title, depth);

  if (url.searchParams.get("format") !== "pdf")
    return new Response(source, {
      headers: { "content-type": "application/x-tex; charset=utf-8", "content-disposition": `attachment; filename="${name}.tex"` },
    });

  const dir = await mkdtemp(path.join(tmpdir(), "zilearn-tex-"));
  try {
    await writeFile(path.join(dir, `${name}.tex`), source);
    // Twice, so the page references settle. Errors don't stop it (nonstopmode): a formula the AI got
    // wrong costs that formula, not the whole PDF, so a PDF that came out is used even after errors.
    const code = await xelatex(dir, `${name}.tex`);
    if (code === null)
      return fail("XeLaTeX isn't installed on this computer, so the PDF can't be made here. Download the .tex instead and compile it where TeX and the Z class are installed.", 501);
    const log = async () => readFile(path.join(dir, `${name}.log`), "utf8").catch(() => "");
    if (/File `Z\.cls' not found/.test(await log()))
      return fail("The Z class isn't installed in TeX here. Install it in your TeX tree, or set Z_TEX_DIR in .env.local to the Z repository's tex/latex folder.", 500);
    await xelatex(dir, `${name}.tex`);
    const made = await stat(path.join(dir, `${name}.pdf`)).catch(() => null);
    if (!made?.size) return fail(`XeLaTeX couldn't compile the lesson:\n${firstError(await log())}`, 500);
    const pdf = await readFile(path.join(dir, `${name}.pdf`));
    return new Response(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}.pdf"` },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
