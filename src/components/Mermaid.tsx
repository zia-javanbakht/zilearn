"use client";

import { useEffect, useId, useRef, useState } from "react";
import { startDrag } from "./pointerDrag";

const SVG = "http://www.w3.org/2000/svg";

let initialized = false;

export interface NodeClick {
  /** Ctrl, Cmd or Shift was held: add to the selection instead of replacing it. */
  extend: boolean;
  shift: boolean;
}

/**
 * Renders Mermaid code client-side. In a flowchart, `onNodeClick` receives the Mermaid node id
 * (e.g. "n3") of a clicked node; `toggles` draws a plus or minus on nodes that can open or close;
 * `marks` adds CSS classes to nodes without drawing the diagram again; `onNodeDrop` lets a node be
 * dragged onto another (or onto "root").
 */
export function Mermaid({
  code,
  onNodeClick,
  toggles,
  onToggle,
  marks,
  onNodeDrop,
  dragLabel,
  fit = false,
  zoom = false,
}: {
  code: string;
  onNodeClick?: (nodeId: string, how: NodeClick) => void;
  toggles?: Record<string, "open" | "closed">;
  onToggle?: (nodeId: string) => void;
  marks?: Record<string, string>;
  /** `canDrop` says whether dropping `from` on `to` makes sense; `drop` does it. */
  onNodeDrop?: { canDrop: (from: string, to: string) => boolean; drop: (from: string, to: string, copy: boolean) => void };
  /** The label shown while dragging a node, e.g. "3 topics" when it is part of a selection. */
  dragLabel?: (nodeId: string) => string;
  fit?: boolean;
  zoom?: boolean;
}) {
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
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const dropRef = useRef(onNodeDrop);
  dropRef.current = onNodeDrop;
  const labelRef = useRef(dragLabel);
  labelRef.current = dragLabel;
  const togglesRef = useRef(toggles);
  togglesRef.current = toggles;
  const [rendered, setRendered] = useState(0);

  /** Clicks, keys, plus/minus signs and dragging for each flowchart node. */
  function wireNodes(box: HTMLElement) {
    const svg = box.querySelector("svg");
    let grow = 0;
    box.querySelectorAll<SVGGElement>("g.node").forEach((g) => {
      // Flowchart node ids look like "<svgid>-flowchart-n3-12".
      const m = g.id.match(/flowchart-([A-Za-z0-9_]+)-\d+$/);
      if (!m) return;
      const nid = m[1];
      g.dataset.nid = nid;
      const how = (e: MouseEvent | KeyboardEvent): NodeClick => ({ extend: e.ctrlKey || e.metaKey || e.shiftKey, shift: e.shiftKey });
      g.addEventListener("click", (e) => clickRef.current?.(nid, how(e)));
      // Keyboard access: Tab to a node, Enter or Space to select it, + and - (or arrows) to open and close it.
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          clickRef.current?.(nid, how(e));
        } else if (togglesRef.current?.[nid] && ["+", "=", "-", "ArrowRight", "ArrowLeft"].includes(e.key)) {
          const opening = e.key === "+" || e.key === "=" || e.key === "ArrowRight";
          if (opening !== (togglesRef.current[nid] === "open")) {
            e.preventDefault();
            toggleRef.current?.(nid);
          }
        }
      });
      g.addEventListener("pointerdown", (e) => {
        const d = dropRef.current;
        if (!d || nid === "root") return;
        startDrag(e, {
          label: labelRef.current?.(nid) ?? g.textContent?.trim() ?? "",
          target: (x, y) => {
            const hit = document.elementFromPoint(x, y)?.closest<SVGGElement>("g.node");
            const to = hit?.dataset.nid;
            return hit && to && box.contains(hit) && d.canDrop(nid, to) ? { el: hit, id: to, zone: "inside" } : null;
          },
          drop: (t, copy) => t.id && dropRef.current?.drop(nid, t.id, copy),
        });
      });
      // The plus or minus sign sits on the node's right edge, where its subtopics join.
      const state = togglesRef.current?.[nid];
      if (!state || !toggleRef.current) return;
      const box2 = g.getBBox();
      const t = document.createElementNS(SVG, "g");
      t.setAttribute("class", `node-toggle ${state}`);
      t.setAttribute("transform", `translate(${box2.x + box2.width}, ${box2.y + box2.height / 2})`);
      t.setAttribute("role", "button");
      t.setAttribute("aria-label", state === "open" ? "Hide subtopics" : "Show subtopics");
      const c = document.createElementNS(SVG, "circle");
      c.setAttribute("r", "9");
      const tx = document.createElementNS(SVG, "text");
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("dominant-baseline", "central");
      tx.textContent = state === "open" ? "−" : "+";
      const title = document.createElementNS(SVG, "title");
      title.textContent = state === "open" ? "Hide subtopics" : "Show subtopics";
      t.append(title, c, tx);
      t.addEventListener("pointerdown", (e) => e.stopPropagation());
      t.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleRef.current?.(nid);
      });
      g.appendChild(t);
      grow = 12;
    });
    // Room for the signs on the right-most nodes.
    const vb = svg?.viewBox?.baseVal;
    if (svg && vb && grow) svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.width + grow} ${vb.height}`);
  }

  // Selection and cut marks change often; set them as classes instead of drawing the diagram again.
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.querySelectorAll<SVGGElement>("g.node[data-nid]").forEach((g) => {
      g.classList.remove("picked", "cut", "current");
      const cls = marks?.[g.dataset.nid!];
      if (cls) g.classList.add(...cls.split(" ").filter(Boolean));
    });
  }, [marks, rendered]);

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
        if (clickRef.current) wireNodes(ref.current);
        setRendered((r) => r + 1);
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
