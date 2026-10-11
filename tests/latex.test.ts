import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { blockTex, inline, lessonToTex, safeMath, tex } from "@/lib/latex";
import { lessonToMarkdown, type LessonDoc } from "@/lib/lesson";

export const SAMPLE: LessonDoc = {
  title: "Gradient descent & step sizes",
  depth: 2,
  level: "Understand",
  goal: "Explain why it works and how the parts fit together.",
  where_it_fits: "It builds on **derivatives** and leads to *stochastic* methods.",
  map: {
    course: "Machine Learning 101",
    path: ["Optimisation"],
    children: [{ title: "Learning rate", mastery: "familiar" }, { title: "Momentum", mastery: null }],
    before: ["Derivatives"],
    after: ["Stochastic gradient descent"],
    related: [{ course: "Numerical Methods", title: "Newton's method", relation: "second-order cousin" }],
  },
  recall: [{ question: "What is a gradient?", answer: "The vector of partial derivatives, $\\nabla f$." }],
  blocks: [
    { kind: "definition", title: "Update rule", body: "Each step moves against the gradient:\n\n$$\\theta_{k+1} = \\theta_k - \\eta \\nabla f(\\theta_k)$$\n\nwhere $\\eta > 0$ is the step size." },
    { kind: "intuition", title: "Walking downhill", body: "Like walking down a foggy hill: feel the slope, take a step." },
    { kind: "formula", title: "Convergence for $L$-smooth $f$", body: "If $\\eta \\le 1/L$ then $f(\\theta_{k+1}) \\le f(\\theta_k)$." },
    { kind: "procedure", title: "Algorithm", body: "1. Pick $\\theta_0$.\n2. Repeat:\n   - compute $g = \\nabla f(\\theta)$\n   - set $\\theta \\leftarrow \\theta - \\eta g$\n3. Stop when $\\|g\\| < 10^{-6}$." },
    { kind: "example", title: "A quadratic", body: "Minimise $f(x) = x^2$ from $x_0 = 1$ with $\\eta = 0.25$.", solution: "$x_{k+1} = x_k - 0.25 \\cdot 2x_k = 0.5 x_k$, so $x_k = 0.5^k \\to 0$." },
    { kind: "pitfall", title: "Too large a step", body: "With $\\eta > 2/L$ the iterates diverge (100% of the time on $x^2$)." },
    { kind: "comparison", title: "GD vs Newton", body: "| Method | Cost per step | Rate |\n|---|---|---|\n| GD | $O(n)$ | linear |\n| Newton | $O(n^3)$ | quadratic |" },
    { kind: "keypoint", title: "Scale matters", body: "Rescale features so one `eta` suits every direction." },
    { kind: "note", title: "Further reading", body: "See [Boyd & Vandenberghe](https://web.stanford.edu/~boyd/cvxbook/#book) ch. 9." },
  ],
  key_points: ["Step against the gradient.", "Step size $\\eta$ trades speed for stability."],
  common_mistakes: ["Forgetting the minus sign.", "Using one learning rate for badly scaled features_like_this."],
  connections: [{ topic: "Newton's method", relation: "uses curvature as well as slope" }],
  check_yourself: [
    { question: "Why must $\\eta$ be small enough?", answer: "Otherwise the step overshoots and $f$ can increase." },
    { question: "What happens on $f(x)=x^2$ with $\\eta = 1$?", answer: "$x_{k+1} = -x_k$: it oscillates forever." },
  ],
  takeaways: ["Gradient descent is local and first-order.", "Tune $\\eta$ against the smoothness $L$."],
  read: ["Lecture 3 slides", "Week 2 notes #1"],
  by: "claude",
};

describe("LaTeX export", () => {
  it("escapes text but keeps maths", () => {
    expect(tex("50% & #1_a")).toBe("50\\% \\& \\#1\\_a");
    expect(tex("[Lecture 7] [17:00]")).toBe("{[}Lecture 7{]} {[}17:00{]}");
    expect(inline("cost is $O(n_1)$ for 5% of **all** `x_y` cases")).toBe("cost is $O(n_1)$ for 5\\% of \\textbf{all} \\texttt{x\\_y} cases");
    expect(inline("say \"hi\" *now*")).toBe("say ``hi'' \\emph{now}");
    expect(inline("see [docs](https://a.b/c#d)")).toBe("see docs\\footnote{\\url{https://a.b/c\\#d}}");
  });

  it("converts lists, tables, display maths and drops Mermaid", () => {
    const out = blockTex("1. one\n2. two\n   - nested\n\n$$\na^2\n$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\ngraph LR\n```");
    expect(out).toContain("\\begin{enumerate}\n\\item one\n\\item two\n\\begin{itemize}\n\\item nested\n\\end{itemize}\n\\end{enumerate}");
    expect(out).toContain("\\[\na^2\n\\]");
    expect(out).toContain("\\begin{tabular}{ll}");
    expect(out).not.toContain("graph LR");
  });

  it("keeps one-line display maths and strips file commands from maths", () => {
    expect(blockTex("$$a = b$$\ntext")).toBe("\\[a = b\\] text");
    expect(safeMath("$\\input{/etc/passwd} \\immediate\\write18{x} \\inputs$")).toBe("${/etc/passwd} {x} \\inputs$");
    expect(blockTex("```\n\\end{verbatim}\\input{x}\n```")).not.toContain("\\end{verbatim}\\input");
  });

  it("builds a Z document with the categorised boxes and the map", () => {
    const t = lessonToTex(SAMPLE);
    expect(t).toContain("\\documentclass[10pt,stix,minimal]{Z}");
    expect(t).toContain("\\begin{definition}[Update rule]");
    expect(t).toContain("\\begin{intuition}[Walking downhill]");
    expect(t).toContain("\\begin{nobox}[Pitfall: Too large a step]");
    expect(t).toContain("\\begin{chbox}[Key points]");
    expect(t).toContain("\\begin{subox}[Critical Takeaways]");
    expect(t).toContain("child[concept color=DarkOrange1!70] { node {Newton's method (Numerical Methods)} }");
    expect(t).toContain("\\title{Gradient descent \\& step sizes}");
    expect(t).not.toMatch(/---/);
    // Balanced environments.
    const begins = t.match(/\\begin\{(\w+)\}/g)!.length;
    expect(t.match(/\\end\{(\w+)\}/g)!.length).toBe(begins);
    if (process.env.WRITE_SAMPLE) writeFileSync(process.env.WRITE_SAMPLE, t);
  });

  it("renders the same lesson as Markdown for the app", () => {
    const md = lessonToMarkdown(SAMPLE);
    expect(md).toContain('<div class="lb lb-definition">');
    expect(md).toContain("```mermaid\nflowchart LR");
    expect(md).toContain("<details><summary>Solution</summary>");
    expect(md).toContain("- **Newton's method**: uses curvature as well as slope");
  });
});
