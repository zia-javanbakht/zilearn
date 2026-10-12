import { z } from "zod";
import { parseExpr, toPgf } from "./expr";

/**
 * Figures in lessons, described as data rather than drawn: a plot of functions of x, or a diagram of
 * labelled boxes and arrows. The app draws plots as SVG and diagrams with Mermaid; the Z export draws
 * both natively with pgfplots and TikZ, so a figure looks right in both and can't have syntax errors.
 */

export interface Curve {
  expr: string; // in x, e.g. "exp(-0.5*x)*cos(10*x)"
  label: string;
  style?: "solid" | "dashed" | "dotted" | null;
}

export interface PlotSpec {
  x_label: string;
  y_label: string;
  x_min: number;
  x_max: number;
  y_min: number | null;
  y_max: number | null;
  curves: Curve[];
}

export interface DiagramSpec {
  direction: "LR" | "TD";
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label: string | null }[];
}

export interface Figure {
  type: "plot" | "diagram";
  caption: string;
  plot: PlotSpec | null;
  diagram: DiagramSpec | null;
}

export const FigureSchema = z
  .object({
    type: z.enum(["plot", "diagram"]),
    caption: z.string().describe("One sentence saying what to notice in the figure"),
    plot: z
      .object({
        x_label: z.string().describe("Axis label with units, e.g. 'time $t$ (s)'; $...$ for symbols"),
        y_label: z.string(),
        x_min: z.number(),
        x_max: z.number(),
        y_min: z.number().nullable(),
        y_max: z.number().nullable(),
        curves: z
          .array(
            z.object({
              expr: z.string().describe("y as a function of x with numbers substituted: + - * / ^ ( ), pi, e, sin cos tan exp ln log sqrt abs min max. Trig in radians. E.g. exp(-0.5*x)*cos(10*x)"),
              label: z.string().describe("Legend entry, e.g. '$\\zeta = 0.05$'"),
              style: z.enum(["solid", "dashed", "dotted"]).nullable().describe("Line style, when the caption or text tells the curves apart by it (e.g. an envelope dashed); null for solid"),
            }),
          )
          .describe("1-4 curves"),
      })
      .nullable()
      .describe("For type plot, otherwise null"),
    diagram: z
      .object({
        direction: z.enum(["LR", "TD"]).describe("Left to right, or top down"),
        nodes: z.array(z.object({ id: z.string().describe("Short id: letters and digits"), label: z.string().describe("Up to ~6 words; $...$ for symbols") })).describe("3-10 nodes"),
        edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().nullable() })),
      })
      .nullable()
      .describe("For type diagram (a process, cause and effect, classification or decision), otherwise null"),
  })
  .nullable()
  .describe("A plot or diagram when it genuinely helps this block (a response curve, a process, a classification); otherwise null");

/** Problems that would stop a figure from drawing; an empty list means it's fine. */
export function figureProblems(f: Figure): string[] {
  const out: string[] = [];
  if (f.type === "plot") {
    const p = f.plot;
    if (!p) return ["a plot figure needs plot"];
    if (!(p.x_max > p.x_min)) out.push("x_max must be greater than x_min");
    if (p.y_min !== null && p.y_max !== null && !(p.y_max > p.y_min)) out.push("y_max must be greater than y_min");
    if (!p.curves.length) out.push("a plot needs at least one curve");
    for (const c of p.curves)
      try {
        parseExpr(c.expr);
      } catch (e) {
        out.push(`curve "${c.label}": ${(e as Error).message} in "${c.expr}"`);
      }
  } else {
    const d = f.diagram;
    if (!d) return ["a diagram figure needs diagram"];
    const ids = new Set(d.nodes.map((n) => n.id));
    if (d.nodes.length < 2) out.push("a diagram needs at least two nodes");
    for (const e of d.edges) if (!ids.has(e.from) || !ids.has(e.to)) out.push(`edge ${e.from} -> ${e.to} names a node that doesn't exist`);
  }
  return out;
}

/* ---------------- Mermaid and SVG (the app) ---------------- */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ",
  omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  infty: "∞", cdot: "·", times: "×", le: "≤", leq: "≤", ge: "≥", geq: "≥", approx: "≈", ne: "≠", neq: "≠", pm: "±",
};
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", n: "ₙ", i: "ᵢ", j: "ⱼ", k: "ₖ", x: "ₓ", a: "ₐ", e: "ₑ", o: "ₒ", r: "ᵣ", t: "ₜ", "+": "₊", "-": "₋", "=": "₌" };
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", n: "ⁿ" };

/** Sub- or superscript characters when all exist, else the plain form (x_(ab)), or for HTML a marked span. */
function script(x: string, map: Record<string, string>, mark: string, html: boolean): string {
  if (html) return mark === "_" ? `\u0001${x}\u0002` : `\u0003${x}\u0004`;
  return [...x].every((c) => map[c]) ? [...x].map((c) => map[c]).join("") : `${mark}${x.length > 1 && !/^\w+$/.test(x) ? `(${x})` : x}`;
}

/** Turns the sub- and superscripts marked by plainLabel(s, true) into <sub> and <sup>, after escaping. */
export function htmlScripts(s: string): string {
  return s.replace(/\u0001([^\u0002]*)\u0002/g, "<sub>$1</sub>").replace(/\u0003([^\u0004]*)\u0004/g, "<sup>$1</sup>").replace(/[\u0001-\u0004]/g, "");
}

/** A label with simple $...$ maths as Unicode text, for SVG and Mermaid (ζ = 0.05, ω_n → ωₙ). */
const OPS: Record<string, string> = { pm: "±", mp: "∓", cdot: "·", times: "×", approx: "≈", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", to: "→", infty: "∞", partial: "∂", circ: "°" };

export function plainLabel(s: string, html = false): string {
  return s.replace(/\$([^$]+)\$/g, (_, m: string) =>
    m
      // Roots, fractions and common operators first, while their braces still mark what they apply to.
      .replace(/\\sqrt\{([^{}]*)\}/g, (_, x: string) => (/^\\?\w+$/.test(x) ? `√${x}` : `√(${x})`))
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => `${/^\w+$/.test(a) ? a : `(${a})`}/${/^([A-Za-z]|\d+(\.\d+)?)$/.test(b) ? b : `(${b})`}`)
      .replace(/\\(pm|mp|cdot|times|approx|leq|le|geq|ge|neq|ne|to|infty|partial|circ)(?![A-Za-z])/g, (_, op: string) => OPS[op])
      .replace(/\\([A-Za-z]+)/g, (w, name) => GREEK[name] ?? (["mathrm", "text", "mathit", "mathbf", "operatorname"].includes(name) ? "" : w))
      .replace(/_\{([^{}]*)\}|_([0-9a-z])/gi, (w, a: string | undefined, b: string | undefined) => script(a ?? b!, SUB, "_", html))
      .replace(/\^\{([^{}]*)\}|\^([0-9n])/g, (w, a: string | undefined, b: string | undefined) => script(a ?? b!, SUP, "^", html))
      .replace(/[{}]/g, "")
      .replace(/\\,|\\;|\\ /g, " "),
  );
}


// Mermaid labels: quoted, with < > " as Mermaid entity codes and its syntax characters dropped.
export const mq = (s: string, max = 60) =>
  `"${htmlScripts(
    plainLabel(s, true)
      .replace(/[#;`[\]{}|$\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
      .replace(/"/g, "#quot;")
      .replace(/</g, "#lt;")
      .replace(/>/g, "#gt;"),
  )}"`;
const mid = (s: string) => "n_" + s.replace(/[^A-Za-z0-9_]/g, "_");

export function diagramMermaid(d: DiagramSpec): string {
  return [
    `flowchart ${d.direction === "TD" ? "TD" : "LR"}`,
    ...d.nodes.map((n) => `  ${mid(n.id)}[${mq(n.label)}]`),
    ...d.edges.map((e) => `  ${mid(e.from)} -->${e.label ? `|${mq(e.label)}|` : ""} ${mid(e.to)}`),
  ].join("\n");
}

/* ---------------- TikZ and pgfplots (the Z export) ---------------- */

/** Layers by longest path from the sources (back edges of cycles ignored), for a tidy layered drawing. */
export function layers(d: DiagramSpec): Map<string, number> {
  const out = new Map<string, number>();
  const next = new Map<string, string[]>(d.nodes.map((n) => [n.id, []]));
  for (const e of d.edges) next.get(e.from)?.push(e.to);
  const state = new Map<string, number>(); // 1 visiting, 2 done
  const forward: [string, string][] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of next.get(id) ?? []) {
      if (state.get(to) === 1) continue; // back edge
      forward.push([id, to]);
      if (!state.get(to)) visit(to);
    }
    state.set(id, 2);
  };
  const hasIn = new Set(d.edges.map((e) => e.to));
  for (const n of d.nodes) if (!hasIn.has(n.id) && !state.get(n.id)) visit(n.id);
  for (const n of d.nodes) if (!state.get(n.id)) visit(n.id);
  for (const n of d.nodes) out.set(n.id, 0);
  for (let pass = 0; pass < d.nodes.length; pass++)
    for (const [a, b] of forward) if (out.get(b)! < out.get(a)! + 1) out.set(b, out.get(a)! + 1);
  return out;
}

export function diagramTikz(d: DiagramSpec, tex: (s: string) => string): string {
  const layer = layers(d);
  const cols = new Map<number, string[]>();
  for (const n of d.nodes) cols.set(layer.get(n.id)!, [...(cols.get(layer.get(n.id)!) ?? []), n.id]);
  const lr = d.direction !== "TD";
  const pos = new Map<string, [number, number]>();
  for (const [l, ids] of cols)
    ids.forEach((id, k) => {
      const across = (k - (ids.length - 1) / 2) * (lr ? -1.5 : 3.4);
      pos.set(id, lr ? [l * 3.4, across] : [across, -l * 1.6]);
    });
  const name = (id: string) => "n" + id.replace(/[^A-Za-z0-9]/g, "");
  const nodes = d.nodes.map((n) => {
    const [x, y] = pos.get(n.id)!;
    return `  \\node[zbox] (${name(n.id)}) at (${x.toFixed(2)},${y.toFixed(2)}) {${tex(n.label)}};`;
  });
  const edges = d.edges.map((e) => {
    const back = layer.get(e.to)! <= layer.get(e.from)!;
    const lbl = e.label ? ` node[midway, ${lr ? "above" : "right"}, font=\\scriptsize\\sffamily] {${tex(e.label)}}` : "";
    return `  \\draw[zarrow] (${name(e.from)}) ${back ? `to[bend ${lr ? "left" : "right"}=35]` : "--"}${lbl} (${name(e.to)});`;
  });
  return [
    "\\begin{center}",
    // Wide or tall diagrams shrink to fit the page (adjustbox is loaded by Z).
    "\\begin{adjustbox}{max width=\\linewidth, max totalheight=0.45\\textheight}",
    "\\begin{tikzpicture}[font=\\sffamily\\footnotesize,",
    "  zbox/.style={draw=SteelBlue4, fill=SteelBlue1!12, rounded corners=2pt, align=center, text width=2.5cm, minimum height=0.8cm, inner sep=3pt, execute at begin node=\\hyphenpenalty10000\\relax},",
    "  zarrow/.style={-{Stealth[length=2mm]}, thick, SteelBlue4}]",
    ...nodes,
    ...edges,
    "\\end{tikzpicture}",
    "\\end{adjustbox}",
    "\\end{center}",
  ].join("\n");
}

const PLOT_COLORS = ["DodgerBlue3", "Firebrick3", "SeaGreen4", "DarkOrange2"];

export function plotTikz(p: PlotSpec, tex: (s: string) => string): string {
  const curves = p.curves.flatMap((c, i) => {
    try {
      return [`  \\addplot[${PLOT_COLORS[i % 4]}, thick,${c.style && c.style !== "solid" ? ` ${c.style},` : ""} samples=300, domain=${p.x_min}:${p.x_max}] {${toPgf(parseExpr(c.expr))}};`, `  \\addlegendentry{${tex(c.label)}}`];
    } catch {
      return [];
    }
  });
  const ylim = [p.y_min !== null ? `ymin=${p.y_min}` : "", p.y_max !== null ? `ymax=${p.y_max}` : ""].filter(Boolean).join(", ");
  return [
    "\\begin{center}",
    "\\begin{tikzpicture}",
    `\\begin{axis}[width=0.8\\linewidth, height=5.2cm, trig format plots=rad, grid=major, grid style={gray!25}, axis lines=left, xlabel={${tex(p.x_label)}}, ylabel={${tex(p.y_label)}}, legend style={at={(0.5,-0.28)}, anchor=north, legend columns=-1, font=\\scriptsize, draw=none, /tikz/every even column/.append style={column sep=8pt}}, tick label style={font=\\footnotesize, /pgf/number format/fixed}, scaled ticks=false, label style={font=\\footnotesize}, unbounded coords=jump, restrict y to domain=-1e4:1e4${ylim ? `, ${ylim}` : ""}]`,
    ...curves,
    "\\end{axis}",
    "\\end{tikzpicture}",
    "\\end{center}",
  ].join("\n");
}
