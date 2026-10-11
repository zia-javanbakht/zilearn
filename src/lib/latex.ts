import { diagramTikz, plotTikz, type Figure } from "./figure";
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
      out.push(`\\begin{center}\\begin{tabular}{${"l".repeat(n)}}`, "\\toprule");
      rows.forEach((r, k) => out.push(r.map(inline).join(" & ") + " \\\\", k === 0 ? "\\midrule" : ""));
      out.push("\\bottomrule", "\\end{tabular}\\end{center}");
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
  return art ? `\n\n${art}\n{\\centering\\footnotesize\\itshape ${inline(f.caption)}\\par}` : "";
}

function blockToTex(b: LessonBlock): string {
  const fig = b.figure ? figureTex(b.figure) : "";
  const sol = `${b.try_steps ? `\n\n\\textbf{Your turn.} ${blockTex(b.try_steps)}` : ""}${b.solution ? `\n\n\\textbf{Solution.}\n\n${blockTex(b.solution)}` : ""}`;
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

/** The topic's neighbourhood in the brainmap as a TikZ mindmap. */
export function mapTikz(doc: LessonDoc): string {
  const nodes: { label: string; color: string }[] = [
    ...doc.map.path.slice(-1).map((p) => ({ label: p, color: "Thistle3" })),
    ...doc.map.before.slice(-2).map((p) => ({ label: p, color: "LightSteelBlue3" })),
    ...doc.map.children.slice(0, 5).map((c) => ({ label: c.title, color: "SeaGreen3" })),
    ...doc.map.after.slice(0, 2).map((p) => ({ label: p, color: "LightSteelBlue3" })),
    ...doc.map.related.slice(0, 3).map((r) => ({ label: `${r.title} (${r.course})`, color: "DarkOrange1" })),
  ].slice(0, 10);
  if (!nodes.length) return "";
  const used = new Set(nodes.map((n) => n.color));
  const legend = (
    [
      ["Thistle3", "Purple: parent branch"],
      ["LightSteelBlue3", "Blue: before and after"],
      ["SeaGreen3", "Green: subtopics"],
      ["DarkOrange1", "Orange: other courses"],
    ] as const
  )
    .filter(([c]) => used.has(c))
    .map(([, label]) => label);
  const short = (s: string) => tex(s.length > 40 ? s.slice(0, 39) + "…" : s);
  return [
    "\\begin{center}",
    `\\begin{tikzpicture}[mindmap, grow cyclic, every node/.style={concept, font=\\sffamily\\scriptsize, text width=2.2cm, align=center}, concept color=DodgerBlue3!70, text=black,`,
    `  level 1/.append style={level distance=3.3cm, sibling angle=${Math.round(360 / nodes.length)}}]`,
    `\\node[concept, font=\\sffamily\\small\\bfseries, text width=2.6cm] {${short(doc.title)}}`,
    ...nodes.map((n) => `  child[concept color=${n.color}!70] { node {${short(n.label)}} }`),
    ";",
    "\\end{tikzpicture}",
    "\\end{center}",
    `{\\centering\\footnotesize\\sffamily ${legend.join(" \\quad ")}\\par}`,
  ].join("\n");
}

export function lessonToTex(raw: LessonDoc): string {
  const doc = markProvenance(normalizeDoc(raw));
  const s: string[] = [];
  const sec = (title: string, body: string) => body.trim() && s.push(`\\Needspace{14\\baselineskip}\n\\section{${heading(title)}}\n${body.trim()}\n`);
  const ask = (q: QA) => `${q.kind ? `\\textit{${KIND[q.kind]}.} ` : ""}${blockTex(q.question)}${q.hint ? ` \\hfill{\\footnotesize\\itshape Hint: ${inline(q.hint)}}` : ""}`;
  const answers = [
    ...(doc.recall.length ? [`\\subsection*{Warm-up}\n\\begin{enumerate}\n${doc.recall.map((r) => `\\item ${blockTex(r.answer)}`).join("\n")}\n\\end{enumerate}`] : []),
    ...(doc.check_yourself.length ? [`\\subsection*{Check yourself}\n\\begin{enumerate}\n${doc.check_yourself.map((r) => `\\item ${blockTex(r.answer)}`).join("\n")}\n\\end{enumerate}`] : []),
  ];

  if (doc.objectives.length) s.push(`\\begin{chbox}[By the end of this pass you can]\n${items(doc.objectives)}\n\\end{chbox}\n`);
  sec("Where this fits", `${blockTex(doc.where_it_fits)}\n\n${mapTikz(doc)}`);
  if (doc.recall.length) sec("Warm-up", `\\begin{enbox}[Recall]\n${doc.recall.map((q) => `\\item ${ask(q)}`).join("\n")}\n\\end{enbox}`);
  for (const x of doc.sections) sec(x.heading, x.blocks.map(blockToTex).join("\n\n"));
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
  if (doc.read.length) s.push(`\\paragraph{Go back to} ${doc.read.map((r) => `\\textbf{${inline(r.title)}}${r.focus ? ` (${inline(r.focus)})` : ""}`).join("; ")}.\n`);
  if (answers.length) s.push(`\\clearpage\n\\section{Answers}\n${answers.join("\n\n")}\n`);

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
\\usetikzlibrary{mindmap,arrows.meta}
\\usepackage{pgfplots}
\\usepackage{cancel}
\\usepackage{needspace}
\\raggedbottom
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

\\begin{blbox}[Goal of this pass]
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
