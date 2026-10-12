import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { db } from "./db";

/*
 * Compiling ziLearn's LaTeX (lessons, review notes, summaries) to PDF on the computer that runs it.
 * Uses the first TeX engine it finds (XeLaTeX, then LuaLaTeX, Tectonic, pdfLaTeX) and Zia's Z class when
 * it can find it: installed in TeX, in the folder saved in Settings, in Z_TEX_DIR, or in a z/tex/latex
 * folder next to the home folder or the app. Without the Z class (or when the Z build fails) it compiles
 * with a small stand-in class that has the same boxes, so there is always a PDF when TeX is installed.
 */

export type Engine = "xelatex" | "lualatex" | "tectonic" | "pdflatex";
const ENGINES: Engine[] = ["xelatex", "lualatex", "tectonic", "pdflatex"];

export interface TexSetup {
  /** The engine PDFs are made with, or null when no TeX is installed. */
  engine: Engine | null;
  engines: Engine[];
  /** Where the Z class comes from: TeX's own tree, a folder, or nowhere (the stand-in is used). */
  z: {
    found: boolean;
    dir: string | null;
    from: "tex" | "settings" | "env" | "nearby" | null;
  };
  /** The folder saved in Settings, if any (even when it doesn't hold Z.cls). */
  saved: string | null;
}

export class TexError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const SETTING = "tex.zDir";

export function savedZDir(): string | null {
  try {
    return (db().prepare("SELECT value FROM settings WHERE key = ?").get(SETTING) as { value: string } | undefined)?.value || null;
  } catch {
    return null;
  }
}

export function saveZDir(dir: string | null) {
  if (dir) db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTING, dir);
  else db().prepare("DELETE FROM settings WHERE key = ?").run(SETTING);
  cached = null;
}

/** Run a program; code is null when it isn't installed (or was killed for taking too long). */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let p;
    try {
      p = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return resolve({ code: null, out: "" });
    }
    const keep = (b: Buffer) => (out = (out + b.toString()).slice(-20_000));
    p.stdout.on("data", keep);
    p.stderr.on("data", keep);
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 120_000);
    p.on("error", () => (clearTimeout(timer), resolve({ code: null, out })));
    p.on("close", (code) => (clearTimeout(timer), resolve({ code, out })));
  });
}

function command(e: Engine): string {
  const fromEnv = {
    xelatex: process.env.XELATEX,
    lualatex: process.env.LUALATEX,
    tectonic: process.env.TECTONIC,
    pdflatex: process.env.PDFLATEX,
  }[e];
  return fromEnv || e;
}

/** A folder holding Z.cls (itself or up to three levels down), as TEXINPUTS will find it. */
async function holdsZ(dir: string, depth = 3): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return false;
  if (entries.some((e) => e.isFile() && e.name === "Z.cls")) return true;
  if (depth === 0) return false;
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".") && (await holdsZ(path.join(dir, e.name), depth - 1))) return true;
  return false;
}

let cached: { at: number; setup: TexSetup } | null = null;

/** What this computer has for making PDFs. Looked up once a minute at most. */
export async function texSetup(fresh = false): Promise<TexSetup> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.setup;
  const found = await Promise.all(ENGINES.map(async (e) => ((await run(command(e), ["--version"], { timeoutMs: 15_000 })).code === 0 ? e : null)));
  const engines = found.filter((e): e is Engine => !!e);
  const saved = savedZDir();
  let z: TexSetup["z"] = { found: false, dir: null, from: null };
  const candidates: [string | null | undefined, NonNullable<TexSetup["z"]["from"]>][] = [
    [saved, "settings"],
    [process.env.Z_TEX_DIR, "env"],
    [path.join(homedir(), "z", "tex", "latex"), "nearby"],
    [path.join(homedir(), "Z", "tex", "latex"), "nearby"],
    [path.resolve(process.cwd(), "..", "z", "tex", "latex"), "nearby"],
  ];
  for (const [dir, from] of candidates)
    if (dir && (await holdsZ(dir))) {
      z = { found: true, dir, from };
      break;
    }
  if (!z.found && engines.some((e) => e !== "tectonic")) {
    const k = await run("kpsewhich", ["Z.cls"], { timeoutMs: 15_000 });
    if (k.code === 0 && k.out.trim()) z = { found: true, dir: null, from: "tex" };
  }
  const setup: TexSetup = { engine: engines[0] ?? null, engines, z, saved };
  cached = { at: Date.now(), setup };
  return setup;
}

/** The first error in a LaTeX log, with a few lines of context. */
export function firstError(log: string): string {
  const lines = log.split("\n");
  const at = lines.findIndex((l) => l.startsWith("!") || /^[^:\s]+:\d+: /.test(l));
  return (at < 0 ? lines.slice(-8) : lines.slice(at, at + 6)).join("\n").trim();
}

export const NO_TEX =
  "No TeX is installed on the computer that runs ziLearn, so it can't make the PDF itself. Install TeX Live or MiKTeX (or the single-program Tectonic), or download the .tex and compile it elsewhere. Settings shows what ziLearn finds.";

/** Whether a document asks for the Z class. */
export function usesZ(source: string): boolean {
  return /\\documentclass\s*(\[[^\]]*\])?\s*\{Z\}/.test(source);
}

/**
 * Compile LaTeX to PDF. Errors in the body don't stop it (nonstopmode): a formula the AI got wrong
 * costs that formula, not the whole PDF, so a PDF that comes out is used even after errors. `note`
 * says when the stand-in class was used instead of Z.
 */
export async function compileTex(
  source: string,
  name: string,
  opts: { standIn?: boolean } = {},
): Promise<{ pdf: Buffer; note: string | null; engine: Engine }> {
  const setup = await texSetup();
  const engine = setup.engine;
  if (!engine) throw new TexError(NO_TEX, 501);
  // pdfLaTeX can't run the Z class (it is written for XeLaTeX), and Tectonic doesn't read TEXINPUTS.
  const zUsable = !opts.standIn && setup.z.found && engine !== "pdflatex" && !(engine === "tectonic" && setup.z.from === "tex");
  const wantsZ = usesZ(source);
  if (wantsZ && zUsable) {
    const r = await attempt(source, name, engine, setup, false);
    if (r.pdf) return { pdf: r.pdf, note: null, engine };
    // The Z build failed outright: try the stand-in, so there is still something to print.
    const s = await attempt(source, name, engine, setup, true);
    if (s.pdf)
      return {
        pdf: s.pdf,
        note: `The Z class couldn't compile this (${oneLine(r.error)}), so the PDF uses ziLearn's simpler stand-in layout.`,
        engine,
      };
    throw new TexError(`${engine} couldn't compile it:\n${r.error}`, 500);
  }
  const r = await attempt(source, name, engine, setup, wantsZ);
  if (!r.pdf) throw new TexError(`${engine} couldn't compile it:\n${r.error}`, 500);
  const note = !wantsZ
    ? null
    : opts.standIn
      ? "Made with ziLearn's simpler stand-in layout."
      : setup.z.found
        ? `Made with ${engine}, which can't use the Z class, so the PDF uses ziLearn's simpler stand-in layout.`
        : "The Z class wasn't found, so the PDF uses ziLearn's simpler stand-in layout. Point Settings at your Z folder to print with Z.";
  return { pdf: r.pdf, note, engine };
}

function oneLine(s: string) {
  return s.replace(/\s+/g, " ").slice(0, 160);
}

async function attempt(source: string, name: string, engine: Engine, setup: TexSetup, standIn: boolean): Promise<{ pdf?: Buffer; error: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "zilearn-tex-"));
  try {
    const file = `${name}.tex`;
    await writeFile(path.join(dir, file), source);
    // The stand-in sits beside the document, where TeX looks first.
    if (standIn) await writeFile(path.join(dir, "Z.cls"), STAND_IN_CLASS);
    const zDir = !standIn && setup.z.dir;
    if (engine === "tectonic") {
      if (zDir) await copyZ(zDir, dir);
      await run(command(engine), ["--keep-logs", "--outdir", dir, file], {
        cwd: dir,
        timeoutMs: 240_000,
      });
    } else {
      const env = {
        ...process.env,
        ...(zDir
          ? {
              TEXINPUTS: `.${path.delimiter}${zDir}//${path.delimiter}${process.env.TEXINPUTS ?? ""}`,
            }
          : {}),
      };
      const args = ["-no-shell-escape", "-interaction=nonstopmode", "-file-line-error", file];
      // Twice, so the page references settle.
      const first = await run(command(engine), args, { cwd: dir, env });
      if (first.code === null)
        return {
          error: `${engine} stopped (it took too long or couldn't start).`,
        };
      if (await exists(path.join(dir, `${name}.pdf`))) await run(command(engine), args, { cwd: dir, env });
    }
    const pdf = await readFile(path.join(dir, `${name}.pdf`)).catch(() => null);
    if (pdf?.length) return { pdf, error: "" };
    const log = await readFile(path.join(dir, `${name}.log`), "utf8").catch(() => "");
    return {
      error: firstError(log) || "No PDF came out, and TeX left no log.",
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function exists(p: string) {
  return !!(await stat(p).catch(() => null))?.size;
}

/** Tectonic only reads files beside the document, so the Z class's files are copied there. */
async function copyZ(from: string, to: string, depth = 3) {
  const entries = await readdir(from, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(from, e.name);
    if (e.isFile() && /\.(cls|sty|tex|def|cfg|clo|otf|ttf|png|pdf|jpg)$/i.test(e.name) && !(await exists(path.join(to, e.name))))
      await writeFile(path.join(to, e.name), await readFile(p));
    else if (e.isDirectory() && depth > 0 && !e.name.startsWith(".")) await copyZ(p, to, depth - 1);
  }
}

/** File name from a title: letters, digits and dashes. */
export function texFileName(title: string, suffix = ""): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "document";
  return base + suffix;
}

/** The .tex (format "tex") or the compiled PDF (format "pdf") as a download. */
export async function texDownload(source: string, name: string, format: string | null): Promise<Response> {
  if (format !== "pdf")
    return new Response(source, {
      headers: {
        "content-type": "application/x-tex; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.tex"`,
      },
    });
  try {
    const { pdf, note } = await compileTex(source, name);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}.pdf"`,
        ...(note ? { "x-zilearn-note": encodeURIComponent(note) } : {}),
      },
    });
  } catch (e) {
    if (e instanceof TexError) return Response.json({ error: e.message, tex: e.status === 501 ? false : undefined }, { status: e.status });
    throw e;
  }
}

/**
 * A stand-in for the Z class with the environments ziLearn's LaTeX uses: Z's theorem-style boxes
 * (definition, keypoint, intuition, example), its titled boxes (blbox, nobox, qubox, subox, each with
 * an optional subtitle) and its list boxes, which take \item directly (chbox, crbox, itbox, enbox).
 * Works with XeLaTeX, LuaLaTeX and Tectonic, and with pdfLaTeX for mostly-Latin text.
 */
export const STAND_IN_CLASS = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{Z}[2026/10/12 ziLearn stand-in for the Z class]
\DeclareOption*{}
\ProcessOptions\relax
% Z's options (stix, minimal...) mean other things to packages, so they aren't passed on.
\gdef\@classoptionslist{}
\LoadClass[10pt,a4paper]{article}
\RequirePackage{iftex}
\RequirePackage{amsmath}
\ifPDFTeX
  \RequirePackage[utf8]{inputenc}
  \RequirePackage[T1]{fontenc}
  \RequirePackage{lmodern,amssymb,bm}
  \providecommand\symbf[1]{\bm{#1}}
\else
  \RequirePackage{unicode-math}
  % STIX Two, as Z's stix option uses, when TeX has it; otherwise Latin Modern.
  \IfFontExistsTF{STIXTwoText-Regular.otf}{\setmainfont{STIXTwoText}[Extension=.otf,UprightFont=*-Regular,
    BoldFont=*-Bold,ItalicFont=*-Italic,BoldItalicFont=*-BoldItalic]}{}
  \IfFontExistsTF{STIXTwoMath-Regular.otf}{\setmathfont{STIXTwoMath-Regular.otf}}{}
\fi
% Symbols text fonts often lack (STIX Two Text has no arrows) are set as maths, and for pdfLaTeX,
% which only reads Latin text, Greek too. Unicode engines take the character itself in maths
% (^^60 is a backquote: its character code).
\IfFileExists{newunicodechar.sty}{\RequirePackage{newunicodechar}}{}
\ifPDFTeX
  \def\Z@sym#1#2{\ifdefined\newunicodechar\newunicodechar{#1}{\ensuremath{#2}}\fi}
\else
  \def\Z@sym#1#2{\ifdefined\newunicodechar\newunicodechar{#1}{\ensuremath{\Uchar^^60#1}}\fi}
\fi
\Z@sym{→}{\rightarrow}\Z@sym{←}{\leftarrow}\Z@sym{↔}{\leftrightarrow}\Z@sym{⇒}{\Rightarrow}
\Z@sym{⇐}{\Leftarrow}\Z@sym{⇔}{\Leftrightarrow}\Z@sym{≈}{\approx}\Z@sym{≤}{\leq}\Z@sym{≥}{\geq}
\Z@sym{≠}{\neq}\Z@sym{≡}{\equiv}\Z@sym{∞}{\infty}
\Z@sym{±}{\pm}\Z@sym{×}{\times}\Z@sym{÷}{\div}\Z@sym{√}{\surd}\Z@sym{∂}{\partial}\Z@sym{∇}{\nabla}
\Z@sym{∈}{\in}\Z@sym{∉}{\notin}\Z@sym{∀}{\forall}\Z@sym{∃}{\exists}\Z@sym{∝}{\propto}\Z@sym{∘}{\circ}
\Z@sym{⊂}{\subset}\Z@sym{⊆}{\subseteq}\Z@sym{∪}{\cup}\Z@sym{∩}{\cap}\Z@sym{∅}{\emptyset}\Z@sym{⋅}{\cdot}
% unicode-math defines the big operators through their own characters, so only pdfLaTeX maps them.
\ifPDFTeX
  \Z@sym{∑}{\sum}\Z@sym{∏}{\prod}\Z@sym{∫}{\int}
  \Z@sym{α}{\alpha}\Z@sym{β}{\beta}\Z@sym{γ}{\gamma}\Z@sym{δ}{\delta}\Z@sym{ε}{\varepsilon}\Z@sym{ζ}{\zeta}
  \Z@sym{η}{\eta}\Z@sym{θ}{\theta}\Z@sym{κ}{\kappa}\Z@sym{λ}{\lambda}\Z@sym{μ}{\mu}\Z@sym{ν}{\nu}
  \Z@sym{ξ}{\xi}\Z@sym{π}{\pi}\Z@sym{ρ}{\rho}\Z@sym{σ}{\sigma}\Z@sym{τ}{\tau}\Z@sym{φ}{\varphi}
  \Z@sym{χ}{\chi}\Z@sym{ψ}{\psi}\Z@sym{ω}{\omega}\Z@sym{Γ}{\Gamma}\Z@sym{Δ}{\Delta}\Z@sym{Θ}{\Theta}
  \Z@sym{Λ}{\Lambda}\Z@sym{Π}{\Pi}\Z@sym{Σ}{\Sigma}\Z@sym{Φ}{\Phi}\Z@sym{Ψ}{\Psi}\Z@sym{Ω}{\Omega}
\fi
\RequirePackage[margin=2.2cm]{geometry}
\RequirePackage[x11names]{xcolor}
\RequirePackage{graphicx,tikz,adjustbox,array,tabularx,booktabs,enumitem,url}
\RequirePackage[skins,breakable]{tcolorbox}
\RequirePackage[colorlinks,linkcolor=SteelBlue4,urlcolor=SteelBlue4]{hyperref}
\setlength\parindent{0pt}
\setlength\parskip{4pt plus 1pt}
\setlist{itemsep=2pt,topsep=3pt}
\tcbset{zbox/.style={enhanced,breakable,colframe=#1,colback=#1!4!white,colbacktitle=#1,coltitle=white,
  fonttitle=\sffamily\bfseries\small,boxrule=0.6pt,arc=2pt,left=6pt,right=6pt,top=4pt,bottom=4pt,
  before skip=8pt plus 2pt,after skip=8pt plus 2pt}}
\newcommand\Z@begin[2]{\if\relax\detokenize{#2}\relax\expandafter\@firstoftwo\else\expandafter\@secondoftwo\fi
  {\begin{tcolorbox}[zbox=#1]}{\begin{tcolorbox}[zbox=#1,title={#2}]}}
\newcommand\Z@theorem[3]{% name, label, colour
  \NewDocumentEnvironment{#1}{o}{\IfValueTF{##1}{\Z@begin{#3}{#2: ##1}}{\Z@begin{#3}{#2}}}{\end{tcolorbox}}}
\newcommand\Z@titled[2]{% name, colour
  \NewDocumentEnvironment{#1}{o o}{\IfValueTF{##1}{\IfValueTF{##2}{\Z@begin{#2}{##1\hfill{\mdseries\itshape ##2}}}{\Z@begin{#2}{##1}}}{\Z@begin{#2}{}}}{\end{tcolorbox}}}
\newcommand\Z@listbox[3]{% name, colour, list
  \NewDocumentEnvironment{#1}{o}{\IfValueTF{##1}{\Z@begin{#2}{##1}}{\Z@begin{#2}{}}\begin{#3}[leftmargin=1.5em]}{\end{#3}\end{tcolorbox}}}
\Z@theorem{definition}{Definition}{SteelBlue4}
\Z@theorem{keypoint}{Key point}{Firebrick3}
\Z@theorem{intuition}{Intuition}{DarkOrchid4}
\Z@theorem{example}{Example}{SeaGreen4}
\Z@titled{blbox}{DodgerBlue4}
\Z@titled{nobox}{OrangeRed3}
\Z@titled{qubox}{Goldenrod4}
\Z@titled{subox}{DarkGoldenrod4}
\Z@listbox{chbox}{SeaGreen4}{itemize}
\Z@listbox{crbox}{Firebrick3}{itemize}
\Z@listbox{itbox}{DodgerBlue3}{itemize}
\Z@listbox{enbox}{SlateBlue4}{enumerate}
\endinput
`;
