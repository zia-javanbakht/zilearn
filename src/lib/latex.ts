import { diagramTikz, plotTikz, type Figure } from "./figure";
import { conceptLayout, homes } from "./lessonTerms";
import { markProvenance, normalizeDoc, type LessonBlock, type LessonDoc, type QA } from "./lesson";

/**
 * LaTeX for printing lessons with Zia's Z class (XeLaTeX): Z's theorem-style environments for
 * definitions, key points, intuitions and examples, and its tcolorbox boxes for the rest
 * (chbox key points, crbox mistakes, itbox connections, enbox questions, subox takeaways).
 */

/* ---------------- Markdown → LaTeX ---------------- */

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  "%": "\\%",
  "&": "\\&",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  _: "\\_",
  $: "\\$",
  // Braced so they can't be read as an optional argument (a box title, or \\item's label).
  "[": "{[}",
  "]": "{]}",
};

/** Escape plain text for LaTeX. */
export function tex(s: string): string {
  return s.replace(/[\\{}#%&~^_$[\]]/g, (c) => SPECIAL[c]);
}

// Maths is passed through untouched: $$...$$, $...$, \[...\], \(...\).
const MATH = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$)/g;

// Maths comes from AI output and the student's materials, so it may not touch files or redefine anything.
const UNSAFE = /\\(write\d*|immediate|input|include|openin|openout|read|catcode|csname|directlua|special|def|edef|gdef|xdef|let|newwrite|newread|usepackage|documentclass|lstinputlisting|verbatiminput|inputminted|ShellEscape)(?![a-zA-Z])/g;

/** Maths with file and definition commands removed. */
export function safeMath(m: string): string {
  return katexOnly(m.replace(UNSAFE, ""));
}

/** KaTeX shorthands that LaTeX (amsmath and unicode-math, as Z loads them) doesn't define. */
function katexOnly(m: string): string {
  return m
    .replace(/\\([RNZ])(?![A-Za-z])/g, "\\mathbb{$1}")
    .replace(/\\bm(?![A-Za-z])/g, "\\symbf")
    .replace(/\\degree(?![A-Za-z])/g, "^{\\circ}")
    .replace(/\\tag\*?\{([^{}]*)\}/g, "\\qquad($1)");
}

/** One line or paragraph of Markdown (bold, italics, code, links) with maths kept as LaTeX. */
export function inline(md: string): string {
  // Maths, code and links are set aside first, so emphasis can wrap them (**$T_n$ = 0.31 s**).
  const kept: string[] = [];
  const keep = (x: string) => `\u0000${kept.push(x) - 1}\u0000`;
  let s = md
    .replace(MATH, (m) => keep(safeMath(m.startsWith("$$") ? `\\[${m.slice(2, -2)}\\]` : m)))
    .replace(/`([^`]+)`/g, (_, c) => keep(`\\texttt{${tex(c)}}`))
    // Markdown's escaped dollar is a literal dollar sign.
    .replace(/\\\$/g, () => keep("\\$"))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => keep(`${tex(t)}\\footnote{\\url{${u.replace(/[{}\\]/g, "").replace(/[%#]/g, "\\$&")}}}`));
  s = tex(s.replace(/<\/?[a-z][^>]*>/gi, ""))
    .replace(/\*\*(.+?)\*\*/g, "\\textbf{$1}")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, "$1\\emph{$2}")
    .replace(/(^|\W)\\_(?!\s)(.+?)(?<!\s)\\_(?=\W|$)/g, "$1\\emph{$2}")
    .replace(/"([^"]+)"/g, "``$1''");
  // Restored last to first, since a link's text may hold a kept code span.
  for (let k = kept.length - 1; k >= 0; k--) s = s.split(`\u0000${k}\u0000`).join(kept[k]);
  return s;
}

/** A block of Markdown: paragraphs, lists (one level of nesting), display maths, tables, quotes, code. */
export function blockTex(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t || /^<\/?(details|div)[^>]*>$/i.test(t)) {
      out.push("");
      i++;
      continue;
    }
    if (t.startsWith("```")) {
      const lang = t.slice(3).trim();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) body.push(lines[i]);
      i++;
      if (lang !== "mermaid") out.push("\\begin{verbatim}", ...body.map((l) => l.replace(/\\end\s*\{verbatim\}/g, "\\end {verbatim}")), "\\end{verbatim}");
      continue;
    }
    if (t.startsWith("$$") && !(t.length > 4 && t.endsWith("$$"))) {
      const body = [t.slice(2)];
      for (i++; i < lines.length && !lines[i].includes("$$"); i++) body.push(lines[i]);
      body.push((lines[i] ?? "").replace("$$", ""));
      i++;
      out.push("\\[", safeMath(body.join("\n").trim()), "\\]");
      continue;
    }
    if (/^#{1,6}\s/.test(t)) {
      out.push(`\\paragraph{${inline(t.replace(/^#+\s*/, ""))}}`);
      i++;
      continue;
    }
    if (/^<summary>/i.test(t)) {
      out.push(`\\textbf{${inline(t.replace(/<\/?summary>/gi, ""))}}\\par`);
      i++;
      continue;
    }
    if (t.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
      }
      const n = Math.max(...rows.map((r) => r.length));
      // Short tables keep natural widths; wide ones wrap their long columns to the line width.
      const widths = [...Array(n).keys()].map((c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
      const wide = widths.reduce((a, b) => a + b, 0) > 70;
      const cut = Math.min(18, Math.max(...widths) - 1);
      const spec = widths.map((w) => (wide && w > cut ? ">{\\raggedright\\arraybackslash}X" : "l")).join("");
      out.push(wide ? `\\begin{tabularx}{\\linewidth}{${spec}}` : `\\begin{center}\\begin{tabular}{${spec}}`, "\\toprule");
      rows.forEach((r, k) => out.push(r.map(inline).join(" & ") + " \\\\", k === 0 ? "\\midrule" : ""));
      out.push("\\bottomrule", wide ? "\\end{tabularx}" : "\\end{tabular}\\end{center}");
      continue;
    }
    if (t.startsWith(">")) {
      const body: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith(">"); i++) body.push(lines[i].trim().replace(/^>\s?/, ""));
      out.push("\\begin{quote}", blockTex(body.join("\n")), "\\end{quote}");
      continue;
    }
    if (listRe.test(line)) {
      out.push(list(lines, i, (next) => (i = next)));
      continue;
    }
    // Paragraph: consecutive plain lines.
    // The first line always belongs to it (e.g. a one-line $$...$$), so the loop can't stall.
    const para: string[] = [t];
    for (i++; i < lines.length && lines[i].trim() && !listRe.test(lines[i]) && !/^(#{1,6}\s|```|\$\$|\||>|<\/?(details|summary|div))/i.test(lines[i].trim()); i++) para.push(lines[i].trim());
    out.push(inline(para.join(" ")));
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A list starting at lines[start]. An item is its marker line plus every following line that is blank or
 * indented past the marker, so display maths, paragraphs and nested lists inside items stay in them.
 */
function list(lines: string[], start: number, done: (next: number) => void): string {
  const re = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const first = lines[start].match(re)!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(re);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const body = [m[3]];
    const pad = indent + m[2].length + 1;
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) {
        // A blank line continues the item only if the next text is indented under it.
        const nxt = lines.slice(i + 1).find((x) => x.trim());
        if (nxt === undefined || nxt.length - nxt.trimStart().length <= indent) break;
        body.push("");
      } else if (l.length - l.trimStart().length > indent) body.push(l.slice(Math.min(pad, l.length - l.trimStart().length)));
      else if (!re.test(l) && body[body.length - 1] !== "") body.push(l.trim()); // lazy continuation
      else break;
    }
    items.push(blockTex(body.join("\n")));
    // A loose list: blank lines between items of the same list.
    let j = i;
    while (j < lines.length && !lines[j].trim()) j++;
    const n = lines[j]?.match(re);
    if (j > i && n && n[1].length === indent && /\d/.test(n[2]) === ordered) i = j;
  }
  done(i);
  const env = ordered ? "enumerate" : "itemize";
  const from = ordered ? parseInt(first[2], 10) : 1;
  return `\\begin{${env}}${from > 1 ? `[start=${from}]` : ""}\n${items.map((x) => `\\item ${x}`).join("\n")}\n\\end{${env}}`;
}

/* ---------------- Lesson → Z document ---------------- */

const THEOREM_ENV: Partial<Record<LessonBlock["kind"], string>> = {
  definition: "definition",
  keypoint: "keypoint",
  intuition: "intuition",
  example: "example",
};
const BOX: Record<string, [env: string, label: string]> = {
  formula: ["blbox", "Formula"],
  procedure: ["blbox", "Procedure"],
  comparison: ["blbox", "Comparison"],
  pitfall: ["nobox", "Pitfall"],
  note: ["qubox", "Note"],
};

function figureTex(f: Figure): string {
  const art = f.type === "plot" && f.plot ? plotTikz(f.plot, inline) : f.diagram ? diagramTikz(f.diagram, inline) : "";
  // In a minipage so the figure and its caption stay on one page.
  return art ? `\n\n\\par\\noindent\\begin{minipage}{\\linewidth}\n${art}\n{\\centering\\footnotesize\\itshape ${inline(f.caption)}\\par}\n\\end{minipage}\\par` : "";
}

function blockToTex(b: LessonBlock): string {
  const fig = b.figure ? figureTex(b.figure) : "";
  // A faded example prints its given steps and the student's turn; the rest of the working goes to the Answers.
  const sol = b.try_steps
    ? `${b.solution ? `\n\n\\textbf{Worked so far.}\n\n${blockTex(b.solution)}` : ""}\n\n\\textbf{Your turn.}\n\n${blockTex(b.try_steps)}${b.try_answer ? `\n\n{\\footnotesize\\itshape The working is in the Answers.}` : ""}`
    : b.solution
      ? `\n\n\\textbf{Solution.}\n\n${blockTex(b.solution)}`
      : "";
  const env = THEOREM_ENV[b.kind];
  if (env) {
    const src = b.source ? `\n\n{\\hfill\\footnotesize\\itshape Source: ${inline(b.source)}\\par}` : "";
    return `\\begin{${env}}[${inline(b.title)}]\n${blockTex(b.body)}${fig}${sol}${src}\n\\end{${env}}`;
  }
  const [box, label] = BOX[b.kind] ?? ["blbox", "Note"];
  // Z's boxes take a subtitle, shown beside the title: the source, when there is one.
  return `\\begin{${box}}[${label}: ${inline(b.title)}]${b.source ? `[${inline(b.source)}]` : ""}\n${blockTex(b.body)}${fig}${sol}\n\\end{${box}}`;
}

/** Plain text for PDF bookmarks: maths and Markdown markers dropped. */
function plain(md: string): string {
  return tex(md.replace(/\$[^$]*\$/g, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim());
}

/** A heading that is safe in \\section (a moving argument) and in the PDF bookmarks. */
function heading(md: string): string {
  const t = inline(md);
  return /[\\$]/.test(t) ? `\\texorpdfstring{${t}}{${plain(md)}}` : t;
}

/** Items for Z's list boxes, which take \item directly. */
function items(xs: string[]): string {
  return xs.map((x) => `\\item ${blockTex(x)}`).join("\n");
}

/**
 * The lesson's concept map in TikZ, laid out like the app's: a column per section (numbered as the
 * sections are), the key terms stacked in it and the main key terms in bold. On paper the links are
 * lettered on the arrows and read out in full below, so no label sits on a box or another label.
 */
export function conceptTikz(doc: LessonDoc): string {
  const m = conceptLayout(doc);
  if (!m) return "";
  const col = new Map<string, number>();
  const term = new Map<string, string>();
  const lines: string[] = [];
  const GAP = 4.6;
  // Order each section's terms by where their links lead (a few barycentre sweeps), so arrows cross less.
  const row = new Map(m.groups.flatMap((g) => g.terms.map((t, k) => [t.id, k] as const)));
  const colOf = new Map(m.groups.flatMap((g, c) => g.terms.map((t) => [t.id, c] as const)));
  for (let sweep = 0; sweep < 4; sweep++)
    for (const g of m.groups) {
      const at = (id: string) => {
        const ys = m.links.flatMap((l) => (l.from === id ? [l.to] : l.to === id ? [l.from] : [])).filter((o) => colOf.get(o) !== colOf.get(id)).map((o) => row.get(o)!);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : row.get(id)!;
      };
      g.terms = [...g.terms].sort((a, b) => at(a.id) - at(b.id) || row.get(a.id)! - row.get(b.id)!);
      g.terms.forEach((t, k) => row.set(t.id, k));
    }
  m.groups.forEach((g, c) => {
    g.terms.forEach((t, k) => {
      col.set(t.id, c);
      term.set(t.id, t.term);
      lines.push(`  \\node[${t.main ? "zmain" : "zterm"}] (${t.id}) at (${(c * GAP).toFixed(1)},${(-k * 1.5).toFixed(2)}) {${inline(t.term)}};`);
    });
    lines.push(
      `  \\node[zgroup, fit=${g.terms.map((t) => `(${t.id})`).join("")}] (g${c}) {};`,
      `  \\node[zgtitle, anchor=south west] at (g${c}.north west) {\\textbf{${g.section + 1}}\\enspace ${tex(g.heading)}};`,
    );
  });
  const letter = (i: number) => String.fromCharCode(97 + i);
  const rows = Math.max(...m.groups.map((g) => g.terms.length));
  let lane = 0;
  m.links.forEach((l, i) => {
    const a = col.get(l.from)!;
    const b = col.get(l.to)!;
    // Letters sit off-centre, alternating, so two arrows meeting at a box don't stack theirs.
    const tag = `node[zletter, pos=${[0.5, 0.32, 0.68][i % 3]}] {${letter(i)}}`;
    let draw: string;
    // Within a section the arrow loops out to the left, clear of the boxes between.
    if (a === b) draw = `(${l.from}.west) to[out=180, in=180, looseness=1.4] ${tag} (${l.to}.west)`;
    else if (Math.abs(a - b) === 1) draw = `(${l.from}) -- ${tag} (${l.to})`;
    else {
      // Across a section: down the gap beside the start, along a lane under the map, and up beside the end.
      const dir = Math.sign(b - a);
      const x1 = (a * GAP + (dir * GAP) / 2).toFixed(2);
      const x2 = (b * GAP - (dir * GAP) / 2).toFixed(2);
      const y = (-(rows - 1) * 1.5 - 1.1 - 0.3 * lane++).toFixed(2);
      draw = `(${l.from}.${dir > 0 ? "east" : "west"}) -| (${x1},${y}) -- ${tag} (${x2},${y}) |- (${l.to}.${dir > 0 ? "west" : "east"})`;
    }
    lines.push(`  \\draw[zlink] ${draw};`);
  });
  const legend = m.links.map((l, i) => `\\item[\\textbf{${letter(i)}}] ${inline(term.get(l.from)!)} \\emph{${inline(l.label)}} ${inline(term.get(l.to)!)}`);
  return [
    "\\begin{center}",
    "\\begin{adjustbox}{max width=\\linewidth, max totalheight=0.4\\textheight}",
    "\\begin{tikzpicture}[font=\\sffamily\\footnotesize,",
    "  zterm/.style={draw=SteelBlue4, fill=SteelBlue1!12, rounded corners=2pt, align=center, text width=2.6cm, minimum height=0.8cm, inner sep=3pt, execute at begin node=\\hyphenpenalty10000\\relax},",
    "  zmain/.style={zterm, line width=1.2pt, fill=SteelBlue1!30, font=\\sffamily\\footnotesize\\bfseries},",
    "  zgroup/.style={draw=gray!60, dashed, rounded corners=4pt, inner xsep=6pt, inner ysep=8pt},",
    "  zgtitle/.style={font=\\sffamily\\scriptsize, text=gray!70!black, inner sep=1pt, text width=3.2cm, align=left, execute at begin node=\\hyphenpenalty10000\\relax},",
    "  zlink/.style={-{Stealth[length=2mm]}, thick, SteelBlue4!80, rounded corners=4pt},",
    "  zletter/.style={midway, circle, fill=white, draw=SteelBlue4!80, inner sep=0.6pt, minimum size=3.6mm, font=\\sffamily\\scriptsize\\bfseries, text=SteelBlue4}]",
    ...lines,
    "\\end{tikzpicture}",
    "\\end{adjustbox}",
    "\\end{center}",
    `{\\centering\\footnotesize\\itshape Each box is a key term, inside the numbered section that teaches it${m.groups.some((g) => g.terms.some((t) => t.main)) ? " (the topic's main terms in bold)" : ""}${legend.length ? "; each lettered arrow is a link the lesson explains:" : "."}\\par}`,
    legend.length ? `{\\small\\begin{itemize}[nosep, leftmargin=1.6em, labelsep=0.5em]\n${legend.join("\n")}\n\\end{itemize}}` : "",
  ].join("\n");
}

export function lessonToTex(raw: LessonDoc): string {
  const doc = markProvenance(normalizeDoc(raw));
  const s: string[] = [];
  // The teaching sections are numbered 1, 2, 3 (as on the concept map); the rest are not.
  const sec = (title: string, body: string, numbered = false) =>
    body.trim() &&
    s.push(`\\Needspace{14\\baselineskip}\n${numbered ? `\\section{${heading(title)}}` : `\\section*{${heading(title)}}\\addcontentsline{toc}{section}{${heading(title)}}`}\n${body.trim()}\n`);
  const ask = (q: QA) => `${q.kind ? `\\textit{${KIND[q.kind]}.} ` : ""}${blockTex(q.question)}${q.hint ? ` \\hfill{\\footnotesize\\itshape Hint: ${inline(q.hint)}}` : ""}`;
  const answers = [
    ...(doc.recall.length ? [`\\subsection*{Warm-up}\n\\begin{enumerate}\n${doc.recall.map((r) => `\\item ${blockTex(r.answer)}`).join("\n")}\n\\end{enumerate}`] : []),
    ...doc.sections.flatMap((x) => x.blocks.filter((b) => b.try_steps && b.try_answer).map((b) => `\\subsection*{Your turn: ${inline(b.title)}}\n${blockTex(b.try_answer!)}`)),
    ...(doc.check_yourself.length ? [`\\subsection*{Check yourself}\n\\begin{enumerate}\n${doc.check_yourself.map((r) => `\\item ${blockTex(r.answer)}`).join("\n")}\n\\end{enumerate}`] : []),
  ];

  if (doc.objectives.length) s.push(`\\begin{chbox}[By the end of this lesson you can]\n${items(doc.objectives)}\n\\end{chbox}\n`);
  // The concept map: the key terms, each marked with the section that teaches it, and the links the text explains.
  const concept = conceptTikz(doc);
  if (concept) sec("Map of this lesson", concept);
  sec("Where this fits", blockTex(doc.where_it_fits));
  if (doc.recall.length) sec("Warm-up", `\\begin{enbox}[Recall]\n${doc.recall.map((q) => `\\item ${ask(q)}`).join("\n")}\n\\end{enbox}`);
  const home = homes(doc);
  for (const [i, x] of doc.sections.entries()) {
    const mine = [...home].filter(([, at]) => at === i).map(([t]) => `\\textbf{${inline(t)}}`);
    const terms = mine.length ? `{\\small\\sffamily\\color{SteelBlue4}Key terms: ${mine.join(" \\textperiodcentered{} ")}\\par}\\medskip\n\n` : "";
    sec(x.heading, `\\label{sec:lesson-${i}}\n${terms}${x.blocks.map(blockToTex).join("\n\n")}`, true);
  }
  // A two-column table rather than Z's dsbox, whose description list breaks on \\item[...] labels.
  if (doc.glossary.length)
    sec(
      "Key terms",
      `\\begin{blbox}[Glossary]\n\\begin{tabularx}{\\linewidth}{@{}>{\\bfseries\\raggedright\\arraybackslash}p{0.28\\linewidth}X@{}}\n${doc.glossary.map((g) => `${inline(g.term)} & ${inline(g.meaning)} \\\\[2pt]`).join("\n")}\n\\end{tabularx}\n\\end{blbox}`,
    );
  if (doc.key_points?.length) sec("Key points", `\\begin{chbox}[Key points]\n${items(doc.key_points)}\n\\end{chbox}`);
  if (doc.common_mistakes.length)
    sec("Common mistakes", `\\begin{crbox}[Avoid]\n${doc.common_mistakes.map((m) => `\\item ${inline(m.mistake)}${m.correction ? `\\newline\\textit{Instead:} ${inline(m.correction)}` : ""}`).join("\n")}\n\\end{crbox}`);
  if (doc.connections.length) sec("Connections", `\\begin{itbox}[Connections]\n${items(doc.connections.map((c) => `**${c.topic}**: ${c.relation}`))}\n\\end{itbox}`);
  if (doc.check_yourself.length) sec("Check yourself", `\\begin{enbox}[Questions]\n${doc.check_yourself.map((q) => `\\item ${ask(q)}`).join("\n")}\n\\end{enbox}`);
  if (doc.takeaways.length) sec("Takeaways", `\\begin{subox}[Critical Takeaways]\n\\begin{itemize}\n${items(doc.takeaways)}\n\\end{itemize}\n\\end{subox}`);
  if (doc.read.length) s.push(`\\paragraph{Go back to} ${doc.read.map((r) => `\\textbf{${inline(r.title)}}${r.focus ? ` (${inline(r.focus.trim().replace(/[.;:,]+$/, ""))})` : ""}`).join("; ")}.\n`);
  if (answers.length) s.push(`\\clearpage\n\\section*{Answers}\\addcontentsline{toc}{section}{Answers}\n${answers.join("\n\n")}\n`);

  return zDocument(doc, s.join("\n"));
}

const KIND: Record<string, string> = { recall: "Recall", explain: "Explain", apply: "Apply", predict: "Predict", transfer: "Transfer" };

type Head = Pick<LessonDoc, "title" | "depth" | "level" | "goal"> & { map: Pick<LessonDoc["map"], "course" | "path"> };

/** The preamble, a compact title in the style of Z's cover page, the goal box, and the body. */
function zDocument(doc: Head, body: string): string {
  const where = [doc.map.course, ...doc.map.path].map(tex).join(" \\textperiodcentered{} ");
  return `% ══════════════════════════════════════════════════════════════════════════════════════════════════
% !TeX TS-program = xelatex
% !TeX spellcheck = en_GB
% Lesson exported from ziLearn. Needs the Z class; compile with XeLaTeX. (The minimal option leaves out
% minted, so -shell-escape isn't needed.)
% ══════════════════════════════════════════════════════════════════════════════════════════════════
\\documentclass[10pt,stix,minimal]{Z}
\\usetikzlibrary{arrows.meta,fit}
\\usepackage{pgfplots}
\\usepackage{cancel}
\\usepackage{needspace}
\\raggedbottom
\\setlength{\\emergencystretch}{2em}
\\pgfplotsset{compat=1.18}

\\title{${tex(doc.title)}}
\\author{ziLearn}
\\hypersetup{pdftitle={${tex(doc.title)}}, pdfsubject={${tex(doc.map.course)}}}

\\begin{document}
% Z's \\maketitle is a full cover page, too much for one lesson.
\\begin{center}
\\rule{\\linewidth}{1.5pt}\\par\\smallskip
{\\LARGE\\bfseries ${tex(doc.title)}\\par}\\smallskip
{\\large\\bfseries ${where}\\par}
{\\normalsize Level ${doc.depth}: ${tex(doc.level)} \\quad\\textbullet\\quad \\today\\par}\\smallskip
\\rule{\\linewidth}{1.5pt}
\\end{center}

\\begin{blbox}[Goal of this lesson]
${inline(doc.goal)}
\\end{blbox}

${body}
\\end{document}
`;
}

/** A lesson saved before lessons were structured: its Markdown, converted as it is. */
export function markdownLessonToTex(head: Head, md: string): string {
  return zDocument(head, blockTex(md.replace(/<\/?(div|details)[^>]*>/gi, "")));
}
