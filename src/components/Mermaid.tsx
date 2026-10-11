"use client";

import { useEffect, useId, useRef, useState } from "react";

let initialized = false;

/**
 * Renders Mermaid code client-side. `onNodeClick` receives the Mermaid node id
 * (e.g. "n3") when a node in a flowchart is clicked.
 */
export function Mermaid({ code, onNodeClick, fit = false, zoom = false }: { code: string; onNodeClick?: (nodeId: string) => void; fit?: boolean; zoom?: boolean }) {
  const [scale, setScale] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState<string | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    if (ref.current) applyScale(ref.current, scale);
  }, [scale]);
  const clickRef = useRef(onNodeClick);
  clickRef.current = onNodeClick;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import("mermaid")).default;
      if (!initialized) {
        const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", flowchart: { htmlLabels: true, curve: "basis" }, maxTextSize: 200000, maxEdges: 2000 });
        initialized = true;
      }
      try {
        const { svg } = await mermaid.render(`m${id}${Date.now()}`, code);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        applyScale(ref.current, scaleRef.current);
        setError(null);
        if (clickRef.current) {
          ref.current.querySelectorAll<SVGGElement>("g.node").forEach((g) => {
            // Flowchart node ids look like "<svgid>-flowchart-n3-12".
            const m = g.id.match(/flowchart-([A-Za-z0-9_]+)-\d+$/);
            if (!m) return;
            g.addEventListener("click", () => clickRef.current?.(m[1]));
            // Keyboard access: Tab to a node, Enter or Space to select it.
            g.setAttribute("tabindex", "0");
            g.setAttribute("role", "button");
            g.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                clickRef.current?.(m[1]);
              }
            });
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  return (
    <div>
      {error && <div className="alert error small" role="alert">Diagram could not be rendered: {error}</div>}
      {zoom && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 6, gap: 4 }}>
          <button className="sm" onClick={() => setScale((s) => Math.max(0.3, s / 1.25))} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <button className="sm" onClick={() => setScale(1)} title="Actual size">
            {scale === 0 ? "Fit" : `${Math.round(scale * 100)}%`}
          </button>
          <button className="sm" onClick={() => setScale((s) => Math.min(4, s * 1.25))} title="Zoom in" aria-label="Zoom in">
            +
          </button>
          <button className="sm" onClick={() => setScale(0)} title="Fit to width">
            Fit
          </button>
        </div>
      )}
      <div ref={ref} className={`mermaid-box${fit ? " fit" : ""}`} />
    </div>
  );
}

/** Scale the rendered SVG; 0 means fit to the container width. */
function applyScale(box: HTMLElement, scale: number) {
  const svg = box.querySelector("svg");
  if (!svg) return;
  const vb = svg.viewBox?.baseVal;
  const natural = vb && vb.width ? vb.width : svg.getBoundingClientRect().width;
  svg.style.maxWidth = "none";
  svg.style.width = scale === 0 ? "100%" : `${Math.round(natural * scale)}px`;
  svg.style.height = "auto";
}
