import type { LessonBlock, LessonDoc } from "./lesson";

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
  return m.replace(UNSAFE, "");
}

/** One line or paragraph of Markdown (bold, italics, code, links) with maths kept as LaTeX. */
export function inline(md: string): string {
  return md
    .split(MATH)
    .map((part, i) => {
      if (i % 2 === 1) return safeMath(part.startsWith("$$") ? `\\[${part.slice(2, -2)}\\]` : part);
      const codes: string[] = [];
      let s = part.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
      const links: string[] = [];
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `\u0001${links.push(`${tex(t)}\\footnote{\\url{${u.replace(/[{}\\]/g, "").replace(/[%#]/g, "\\$&")}}}`) - 1}\u0001`);
      s = tex(s.replace(/<\/?[a-z][^>]*>/gi, ""))
        .replace(/\*\*(.+?)\*\*/g, "\\textbf{$1}")
        .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, "$1\\emph{$2}")
        .replace(/(^|\W)\\_(?!\s)(.+?)(?<!\s)\\_(?=\W|$)/g, "$1\\emph{$2}")
        .replace(/"([^"]+)"/g, "``$1''");
      return s
        .replace(/\u0000(\d+)\u0000/g, (_, n) => `\\texttt{${tex(codes[+n])}}`)
        .replace(/\u0001(\d+)\u0001/g, (_, n) => links[+n]);
    })
    .join("");
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

function list(lines: string[], start: number, done: (next: number) => void): string {
  const re = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const first = lines[start].match(re)!;
  const indent = first[1].length;
  const env = /\d/.test(first[2]) ? "enumerate" : "itemize";
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(re);
    if (m && m[1].length === indent) {
      items.push(inline(m[3]));
      i++;
    } else if (m && m[1].length > indent) {
      items[items.length - 1] += "\n" + list(lines, i, (n) => (i = n));
    } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
      items[items.length - 1] += " " + inline(lines[i].trim());
      i++;
    } else break;
  }
  done(i);
  return `\\begin{${env}}\n${items.map((x) => `\\item ${x}`).join("\n")}\n\\end{${env}}`;
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

function blockToTex(b: LessonBlock): string {
  const body = blockTex(b.body) + (b.solution ? `\n\n\\textbf{Solution.} ${blockTex(b.solution)}` : "");
  const env = THEOREM_ENV[b.kind];
  if (env) return `\\begin{${env}}[${inline(b.title)}]\n${body}\n\\end{${env}}`;
  const [box, label] = BOX[b.kind] ?? ["blbox", "Note"];
  return `\\begin{${box}}[${label}: ${inline(b.title)}]\n${body}\n\\end{${box}}`;
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

export function lessonToTex(doc: LessonDoc): string {
  const s: string[] = [];
  const sec = (title: string, body: string) => body.trim() && s.push(`\\section{${title}}\n${body.trim()}\n`);
  const answers = [
    ...(doc.recall.length ? [`\\paragraph{Warm-up}\n\\begin{enumerate}\n${items(doc.recall.map((r) => r.answer))}\n\\end{enumerate}`] : []),
    ...(doc.check_yourself.length ? [`\\paragraph{Check yourself}\n\\begin{enumerate}\n${items(doc.check_yourself.map((r) => r.answer))}\n\\end{enumerate}`] : []),
  ];

  sec("Where this fits", `${blockTex(doc.where_it_fits)}\n\n${mapTikz(doc)}`);
  if (doc.recall.length) sec("Warm-up", `\\begin{enbox}[Recall]\n${items(doc.recall.map((r) => r.question))}\n\\end{enbox}`);
  sec("Lesson", doc.blocks.map(blockToTex).join("\n\n"));
  if (doc.key_points.length) sec("Key points", `\\begin{chbox}[Key points]\n${items(doc.key_points)}\n\\end{chbox}`);
  if (doc.common_mistakes.length) sec("Common mistakes", `\\begin{crbox}[Avoid]\n${items(doc.common_mistakes)}\n\\end{crbox}`);
  if (doc.connections.length) sec("Connections", `\\begin{itbox}[Connections]\n${items(doc.connections.map((c) => `**${c.topic}**: ${c.relation}`))}\n\\end{itbox}`);
  if (doc.check_yourself.length) sec("Check yourself", `\\begin{enbox}[Questions]\n${items(doc.check_yourself.map((r) => r.question))}\n\\end{enbox}`);
  if (doc.takeaways.length) sec("Takeaways", `\\begin{subox}[Critical Takeaways]\n\\begin{itemize}\n${items(doc.takeaways)}\n\\end{itemize}\n\\end{subox}`);
  if (doc.read.length) s.push(`\\paragraph{Read next} ${doc.read.map(inline).join("; ")}.\n`);
  if (answers.length) s.push(`\\clearpage\n\\section{Answers}\n${answers.join("\n\n")}\n`);

  return zDocument(doc, s.join("\n"));
}

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
\\usetikzlibrary{mindmap}

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
