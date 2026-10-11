"use client";

import { useMemo } from "react";
import { parseExpr, sample } from "@/lib/expr";
import { plainLabel, type PlotSpec } from "@/lib/figure";

const COLORS = ["#1c7ed6", "#e03131", "#2f9e44", "#f08c00"];
const W = 640;
const H = 300;
const M = { l: 56, r: 16, t: 14, b: 44 };

/** Round, readable tick values covering [a, b]. */
function ticks(a: number, b: number, n = 6): number[] {
  const span = b - a || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= n) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(10));
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : String(+v.toPrecision(4)));

/** A plot from a lesson figure: the curves sampled from their expressions, with axes, grid and legend. */
export function Plot({ spec }: { spec: PlotSpec }) {
  const drawn = useMemo(() => {
    const curves = spec.curves.flatMap((c, i) => {
      try {
        return [{ label: plainLabel(c.label), color: COLORS[i % COLORS.length], pts: sample(parseExpr(c.expr), spec.x_min, spec.x_max, 400) }];
      } catch {
        return [];
      }
    });
    const ys = curves.flatMap((c) => c.pts.map((p) => p.y).filter((y): y is number => y !== null && Math.abs(y) < 1e6));
    let y0 = spec.y_min ?? Math.min(...ys, 0);
    let y1 = spec.y_max ?? Math.max(...ys, 0);
    if (!(y1 > y0)) [y0, y1] = [y0 - 1, y0 + 1];
    if (spec.y_min === null || spec.y_max === null) {
      const pad = (y1 - y0) * 0.06;
      if (spec.y_min === null) y0 -= pad;
      if (spec.y_max === null) y1 += pad;
    }
    const sx = (x: number) => M.l + ((x - spec.x_min) / (spec.x_max - spec.x_min)) * (W - M.l - M.r);
    const sy = (y: number) => H - M.b - ((y - y0) / (y1 - y0)) * (H - M.t - M.b);
    const paths = curves.map((c) => {
      let d = "";
      let pen = false;
      for (const p of c.pts) {
        if (p.y === null || p.y < y0 - (y1 - y0) || p.y > y1 + (y1 - y0)) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(Math.min(Math.max(p.y, y0), y1)).toFixed(1)}`;
        pen = true;
      }
      return { ...c, d };
    });
    return { paths, xt: ticks(spec.x_min, spec.x_max), yt: ticks(y0, y1, 5), sx, sy, y0, y1 };
  }, [spec]);

  const { paths, xt, yt, sx, sy, y0, y1 } = drawn;
  if (!paths.length) return null;
  const zeroY = y0 < 0 && y1 > 0 ? sy(0) : null;
  return (
    <figure className="plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${plainLabel(spec.y_label)} against ${plainLabel(spec.x_label)}`}>
        <g className="plot-grid">
          {xt.map((v) => (
            <line key={`x${v}`} x1={sx(v)} x2={sx(v)} y1={M.t} y2={H - M.b} />
          ))}
          {yt.map((v) => (
            <line key={`y${v}`} x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} />
          ))}
        </g>
        {zeroY !== null && <line className="plot-zero" x1={M.l} x2={W - M.r} y1={zeroY} y2={zeroY} />}
        <g className="plot-axis">
          <line x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} />
          <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
          {xt.map((v) => (
            <text key={`xl${v}`} x={sx(v)} y={H - M.b + 16} textAnchor="middle">
              {fmt(v)}
            </text>
          ))}
          {yt.map((v) => (
            <text key={`yl${v}`} x={M.l - 6} y={sy(v) + 4} textAnchor="end">
              {fmt(v)}
            </text>
          ))}
          <text x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle" className="plot-label">
            {plainLabel(spec.x_label)}
          </text>
          <text transform={`translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" className="plot-label">
            {plainLabel(spec.y_label)}
          </text>
        </g>
        {paths.map((p) => (
          <path key={p.label} d={p.d} fill="none" stroke={p.color} strokeWidth={2} />
        ))}
      </svg>
      {paths.length > 1 && (
        <figcaption className="plot-legend">
          {paths.map((p) => (
            <span key={p.label}>
              <i style={{ background: p.color }} /> {p.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
