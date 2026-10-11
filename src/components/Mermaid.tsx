"use client";

import { useEffect, useId, useRef, useState } from "react";

let initialized = false;

/**
 * Renders Mermaid code client-side. `onNodeClick` receives the Mermaid node id
 * (e.g. "n3") when a node in a flowchart is clicked.
 */
export function Mermaid({ code, onNodeClick, fit = false }: { code: string; onNodeClick?: (nodeId: string) => void; fit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState<string | null>(null);
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
        setError(null);
        if (clickRef.current) {
          ref.current.querySelectorAll<SVGGElement>("g.node").forEach((g) => {
            // Flowchart node ids look like "<svgid>-flowchart-n3-12".
            const m = g.id.match(/flowchart-([A-Za-z0-9_]+)-\d+$/);
            if (!m) return;
            g.addEventListener("click", () => clickRef.current?.(m[1]));
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
      {error && <div className="alert error small">Diagram could not be rendered: {error}</div>}
      <div ref={ref} className={`mermaid-box${fit ? " fit" : ""}`} />
    </div>
  );
}
