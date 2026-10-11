/**
 * A small, safe expression language for plotted curves: numbers, x, pi, e, + - * / ^, parentheses and
 * sin cos tan exp ln log sqrt abs min max. The same expression is sampled for the app's SVG and written
 * as pgfplots maths for the Z export, so lessons can carry real graphs without running any code.
 */

export type Expr =
  | { t: "num"; v: number }
  | { t: "x" }
  | { t: "neg"; a: Expr }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { t: "fn"; name: Fn; args: Expr[] };

const FNS = {
  sin: [1, Math.sin],
  cos: [1, Math.cos],
  tan: [1, Math.tan],
  exp: [1, Math.exp],
  ln: [1, Math.log],
  log: [1, Math.log10],
  sqrt: [1, Math.sqrt],
  abs: [1, Math.abs],
  min: [2, Math.min],
  max: [2, Math.max],
} as const;
type Fn = keyof typeof FNS;

export class ExprError extends Error {}

/** Parses an expression in x; throws ExprError with a short reason when it isn't valid. */
export function parseExpr(src: string): Expr {
  const toks = src
    .replace(/\*\*/g, "^")
    .replace(/·|×/g, "*")
    .replace(/−/g, "-")
    .match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-zA-Z_]+|[-+*/^(),]|\S/g);
  if (!toks) throw new ExprError("empty expression");
  let i = 0;
  const peek = () => toks[i];
  const take = (want?: string) => {
    const t = toks[i++];
    if (want && t !== want) throw new ExprError(`expected "${want}"`);
    return t;
  };

  // sum := product (('+'|'-') product)*
  function sum(): Expr {
    let a = product();
    while (peek() === "+" || peek() === "-") {
      const op = take() as "+" | "-";
      a = { t: "bin", op, a, b: product() };
    }
    return a;
  }
  // product := unary (('*'|'/'|implicit) unary)*
  function product(): Expr {
    let a = unary();
    for (;;) {
      const p = peek();
      if (p === "*" || p === "/") {
        take();
        a = { t: "bin", op: p, a, b: unary() };
      } else if (p !== undefined && (p === "(" || /^[a-zA-Z_.\d]/.test(p))) {
        a = { t: "bin", op: "*", a, b: unary() }; // 2x, 2(x+1), 3sin(x)
      } else return a;
    }
  }
  // unary := '-' unary | power
  function unary(): Expr {
    if (peek() === "-") {
      take();
      return { t: "neg", a: unary() };
    }
    if (peek() === "+") take();
    return power();
  }
  // power := atom ('^' unary)?   (right-associative, binds tighter than unary minus on its left)
  function power(): Expr {
    const a = atom();
    if (peek() === "^") {
      take();
      return { t: "bin", op: "^", a, b: unary() };
    }
    return a;
  }
  function atom(): Expr {
    const tok = take();
    if (tok === undefined) throw new ExprError("unexpected end");
    if (tok === "(") {
      const e = sum();
      take(")");
      return e;
    }
    if (/^[\d.]/.test(tok)) {
      const v = Number(tok);
      if (!Number.isFinite(v)) throw new ExprError(`bad number "${tok}"`);
      return { t: "num", v };
    }
    const id = tok.toLowerCase();
    if (id === "x" || id === "t") return { t: "x" };
    if (id === "pi") return { t: "num", v: Math.PI };
    if (id === "e" && peek() !== "(") return { t: "num", v: Math.E };
    if (id in FNS) {
      const name = id as Fn;
      take("(");
      const args = [sum()];
      while (peek() === ",") {
        take();
        args.push(sum());
      }
      take(")");
      if (args.length !== FNS[name][0]) throw new ExprError(`${name} takes ${FNS[name][0]} argument(s)`);
      return { t: "fn", name, args };
    }
    throw new ExprError(`unknown name "${tok}"`);
  }

  const e = sum();
  if (i < toks.length) throw new ExprError(`unexpected "${toks[i]}"`);
  return e;
}

export function evalExpr(e: Expr, x: number): number {
  switch (e.t) {
    case "num":
      return e.v;
    case "x":
      return x;
    case "neg":
      return -evalExpr(e.a, x);
    case "bin": {
      const a = evalExpr(e.a, x);
      const b = evalExpr(e.b, x);
      return e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : e.op === "/" ? a / b : Math.pow(a, b);
    }
    case "fn": {
      const f = FNS[e.name][1] as (...n: number[]) => number;
      return f(...e.args.map((a) => evalExpr(a, x)));
    }
  }
}

/** The expression as pgfplots maths in the variable \x, fully bracketed (trig in radians). */
export function toPgf(e: Expr): string {
  switch (e.t) {
    case "num":
      return Number.isInteger(e.v) ? String(e.v) : e.v.toPrecision(12).replace(/\.?0+$/, "");
    case "x":
      return "\\x";
    case "neg":
      return `(-${toPgf(e.a)})`;
    case "bin":
      return `(${toPgf(e.a)}${e.op}${toPgf(e.b)})`;
    case "fn":
      return `${e.name === "log" ? "log10" : e.name}(${e.args.map(toPgf).join(",")})`;
  }
}

/** Samples y = f(x) on [a, b]; non-finite values become null (gaps). */
export function sample(e: Expr, a: number, b: number, n = 240): { x: number; y: number | null }[] {
  return Array.from({ length: n + 1 }, (_, k) => {
    const x = a + ((b - a) * k) / n;
    const y = evalExpr(e, x);
    return { x, y: Number.isFinite(y) ? y : null };
  });
}
