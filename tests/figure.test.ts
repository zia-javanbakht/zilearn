import { describe, expect, it } from "vitest";
import { evalExpr, parseExpr, toPgf } from "@/lib/expr";
import { diagramMermaid, diagramTikz, figureProblems, layers, plotTikz, type DiagramSpec } from "@/lib/figure";
import { tex } from "@/lib/latex";

describe("plot expressions", () => {
  it("parses and evaluates with the usual precedence", () => {
    const f = (s: string, x = 2) => evalExpr(parseExpr(s), x);
    expect(f("1 + 2*3")).toBe(7);
    expect(f("-x^2")).toBe(-4);
    expect(f("2^3^2")).toBe(512);
    expect(f("2x + 1")).toBe(5);
    expect(f("3sin(0)+cos(0)")).toBe(1);
    expect(f("exp(-0.5*x)*cos(10*x)", 0)).toBe(1);
    expect(f("max(x, 3) / min(4, 8)")).toBe(0.75);
    expect(f("pi")).toBeCloseTo(Math.PI);
    expect(f("e^x", 1)).toBeCloseTo(Math.E);
    expect(f("x**2 · 3")).toBe(12);
  });

  it("rejects anything that isn't maths in x", () => {
    expect(() => parseExpr("alert(1)")).toThrow(/unknown name/);
    expect(() => parseExpr("sin(x")).toThrow(/expected/);
    expect(() => parseExpr("max(1)")).toThrow(/2 argument/);
    expect(() => parseExpr("")).toThrow();
  });

  it("writes pgfplots maths, fully bracketed", () => {
    expect(toPgf(parseExpr("-x^2 + log(x)"))).toBe("((-(\\x^2))+log10(\\x))");
    expect(toPgf(parseExpr("exp(-0.25*x)"))).toBe("exp(((-0.25)*\\x))");
  });
});

describe("figures", () => {
  const d: DiagramSpec = {
    direction: "LR",
    nodes: [
      { id: "a", label: "Release" },
      { id: "b", label: "Oscillate" },
      { id: "c", label: "Rest" },
    ],
    edges: [
      { from: "a", to: "b", label: "zeta < 1" },
      { from: "b", to: "c", label: null },
      { from: "b", to: "b", label: "each cycle" },
    ],
  };

  it("checks figures before they are drawn", () => {
    expect(figureProblems({ type: "diagram", caption: "", plot: null, diagram: d })).toEqual([]);
    expect(figureProblems({ type: "diagram", caption: "", plot: null, diagram: { ...d, edges: [{ from: "a", to: "z", label: null }] } })).toEqual(["edge a -> z names a node that doesn't exist"]);
    expect(figureProblems({ type: "plot", caption: "", diagram: null, plot: { x_label: "t", y_label: "u", x_min: 1, x_max: 0, y_min: null, y_max: null, curves: [{ expr: "foo(x)", label: "a" }] } })).toEqual([
      "x_max must be greater than x_min",
      'curve "a": unknown name "foo" in "foo(x)"',
    ]);
  });

  it("draws diagrams as Mermaid and as layered TikZ", () => {
    expect(diagramMermaid(d)).toBe('flowchart LR\n  n_a["Release"]\n  n_b["Oscillate"]\n  n_c["Rest"]\n  n_a -->|"zeta #lt; 1"| n_b\n  n_b --> n_c\n  n_b -->|"each cycle"| n_b');
    expect([...layers(d)]).toEqual([["a", 0], ["b", 1], ["c", 2]]);
    const t = diagramTikz(d, tex);
    expect(t).toContain("\\node[zbox] (nc) at (6.80,0.00) {Rest};");
    expect(t).toContain("\\draw[zarrow] (nb) to[bend left=35] node[midway, above, font=\\scriptsize\\sffamily] {each cycle} (nb);");
  });

  it("draws plots with pgfplots in radians", () => {
    const t = plotTikz({ x_label: "t (s)", y_label: "u (mm)", x_min: 0, x_max: 5, y_min: null, y_max: null, curves: [{ expr: "exp(-0.5x)", label: "envelope" }] }, tex);
    expect(t).toContain("trig format plots=rad");
    expect(t).toContain("\\addplot[DodgerBlue3, thick, samples=300, domain=0:5] {exp(((-0.5)*\\x))};");
  });
});

describe("plots", () => {
  const plot = (expr: string, x_min: number, x_max: number) => ({ type: "plot" as const, caption: "", diagram: null, plot: { x_label: "x", y_label: "y", x_min, x_max, y_min: null, y_max: null, curves: [{ expr, label: "f" }] } });

  it("rejects a curve with a pole or a negative root inside its range", () => {
    expect(figureProblems(plot("1/(x - 0.4537)", 0, 1))[0]).toMatch(/undefined or infinite near x = 0\.45/);
    expect(figureProblems(plot("sqrt(x - 2)", 0, 4))[0]).toMatch(/near x = 0 /);
    expect(figureProblems(plot("1/(x - 0.4537)", 0.5, 1))).toEqual([]);
    expect(figureProblems(plot("exp(-0.1*x)*cos(2*x)", 0, 30))).toEqual([]);
  });
});

describe("labels", () => {
  it("turns simple maths into Unicode for SVG and Mermaid", async () => {
    const { plainLabel } = await import("@/lib/figure");
    expect(plainLabel("$\\zeta = 0.05$")).toBe("ζ = 0.05");
    expect(plainLabel("$c_{cr}$ and $e^{-st}$")).toBe("c_cr and e^(-st)");
    expect(plainLabel("$\\omega_n\\sqrt{\\zeta^2-1}$, $\\sqrt{k/m}$, $\\frac{c}{2m}$, $\\pm 1$")).toBe("ωₙ√(ζ²-1), √(k/m), c/(2m), ± 1");
    expect(plainLabel("time $t$ (s), $\\omega_n$, $u_{i+1}$, $x^2$")).toBe("time t (s), ωₙ, uᵢ₊₁, x²");
  });

  it("handles the letter styles, accents and operators of continuum mechanics, and drops unknown commands", async () => {
    const { plainLabel, mq } = await import("@/lib/figure");
    expect(plainLabel("$\\mathcal{B}_0$ in $\\mathbb{R}^3$, $\\mathcal{C}$")).toBe("ℬ₀ in ℝ³, 𝒞");
    expect(plainLabel("$\\boldsymbol{\\sigma} = \\bm{F}\\mathbf{S}\\mathbf{F}^T$")).toBe("σ = FSFᵀ");
    expect(plainLabel("$\\hat{\\mathbf{n}}$, $\\bar{\\boldsymbol\\sigma}$, $\\tilde u$")).toBe("n\u0302, σ\u0304, u\u0303");
    expect(plainLabel("$\\nabla_X \\cdot \\mathbf{P}$, $\\partial \\Psi / \\partial \\mathbf{E}$")).toBe("∇_X · P, ∂ Ψ / ∂ E");
    expect(plainLabel("$\\operatorname{Div}\\mathbf{P} + \\mathbf{f}_0 = \\mathbf{0}$, $\\det \\mathbf F > 0$")).toBe("DivP + f₀ = 0, det F > 0");
    expect(plainLabel("$\\left( \\int_{\\Omega} \\delta W \\right)$, $\\left\\{ a \\right\\}$, $\\mathsf{K}\\unknowncmd{x}$")).toBe("( ∫_Ω δ W ), { a }, Kx");
    expect(mq("$\\mathbb{R}$".repeat(40), 5)).toBe('"ℝℝℝℝ…"');
    expect(mq("load shared between the high-strain plies", 36)).toBe('"load shared between the high-strain…"');
  });
});
