"use client";

import { useEffect, useId, useRef, useState } from "react";
import { startDrag } from "./pointerDrag";
import { codeHash, curveBetween, hangingFrom, readGraph, type Box, type Graph } from "./diagramGraph";

const SVG = "http://www.w3.org/2000/svg";

let initialized = false;

export interface NodeClick {
  /** Ctrl, Cmd or Shift was held: add to the selection instead of replacing it. */
  extend: boolean;
  shift: boolean;
}

type Offsets = Record<string, [number, number]>;

const storeKey = (code: string) => `zilearn:diagram:${codeHash(code)}`;
function loadOffsets(code: string): Offsets {
  try {
    return JSON.parse(localStorage.getItem(storeKey(code)) ?? "{}") as Offsets;
  } catch {
    return {};
  }
}
function saveOffsets(code: string, o: Offsets) {
  try {
    if (Object.keys(o).length) localStorage.setItem(storeKey(code), JSON.stringify(o));
    else localStorage.removeItem(storeKey(code));
  } catch {
    /* storage may be off; the arrangement then lasts until the page reloads */
  }
}

/**
 * Renders Mermaid code (flowcharts and mindmaps) client-side, and makes it interactive:
 * - `onNodeClick` receives the Mermaid node name (e.g. "n3") of a clicked node.
 * - `toggles`/`onToggle` draw a plus or minus on nodes whose branch the caller opens and closes.
 *   Without them, every node with a branch hanging from it gets a sign that folds it in place.
 * - `onNodeDrop` lets a node be dragged onto another (or onto "root") to change the structure.
 *   Without it, dragging a node rearranges the drawing (edges follow); the arrangement is remembered.
 * - `marks` adds CSS classes to nodes without drawing the diagram again.
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
  interactive = true,
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
  /** False for a static picture: no folding or rearranging. */
  interactive?: boolean;
}) {
  const [scale, setScale] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState<string | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    if (ref.current && !(fit && !zoom)) applyScale(ref.current, scale);
  }, [scale, fit, zoom]);
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
  const graph = useRef<Graph | null>(null);
  const offsets = useRef<Offsets>({});
  const folded = useRef<Set<string>>(new Set());
  const hanging = useRef<Map<string, Set<string>>>(new Map());
  const [moved, setMoved] = useState(false);
  const [foldedCount, setFoldedCount] = useState(0);

  /** Centre and size of a node as drawn now (with any offset). */
  function boxOf(nid: string): Box | null {
    const n = graph.current?.nodes.get(nid);
    if (!n) return null;
    const bb = n.el.getBBox();
    const [dx, dy] = offsets.current[nid] ?? [0, 0];
    return { cx: n.x + dx + bb.x + bb.width / 2, cy: n.y + dy + bb.y + bb.height / 2, w: bb.width, h: bb.height };
  }

  /** Put moved nodes where the student dragged them and re-route their edges. */
  function layout(only?: string) {
    const g = graph.current;
    if (!g) return;
    for (const n of g.nodes.values()) {
      if (only && n.id !== only) continue;
      const [dx, dy] = offsets.current[n.id] ?? [0, 0];
      n.el.setAttribute("transform", `translate(${n.x + dx}, ${n.y + dy})`);
    }
    for (const e of g.edges) {
      if (only && e.from !== only && e.to !== only) continue;
      const movedEnd = offsets.current[e.from] || offsets.current[e.to];
      const a = movedEnd && boxOf(e.from);
      const b = movedEnd && boxOf(e.to);
      e.el.setAttribute("d", a && b ? curveBetween(a, b) : e.d0);
      if (e.label) {
        if (a && b) {
          const len = e.el.getTotalLength();
          const p = e.el.getPointAtLength(len / 2);
          e.label.setAttribute("transform", `translate(${p.x}, ${p.y})`);
        } else if (e.label0) e.label.setAttribute("transform", e.label0);
      }
    }
    growViewBox();
  }

  /** Make room when a node is dragged past the edge of the drawing. */
  function growViewBox() {
    const box = ref.current;
    const svg = box?.querySelector("svg");
    const vb = svg?.viewBox?.baseVal;
    const g = graph.current;
    if (!svg || !vb || !g) return;
    let [x0, y0, x1, y1] = [vb.x, vb.y, vb.x + vb.width, vb.y + vb.height];
    for (const n of g.nodes.keys()) {
      const b = boxOf(n);
      if (!b) continue;
      x0 = Math.min(x0, b.cx - b.w / 2 - 16);
      y0 = Math.min(y0, b.cy - b.h / 2 - 16);
      x1 = Math.max(x1, b.cx + b.w / 2 + 16);
      y1 = Math.max(y1, b.cy + b.h / 2 + 16);
    }
    if (x0 < vb.x || y0 < vb.y || x1 > vb.x + vb.width || y1 > vb.y + vb.height) {
      svg.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
      if (!(fit && !zoom)) applyScale(box!, scaleRef.current);
    }
  }

  /** Hide what hangs from folded nodes. */
  function applyFolds(branches: Map<string, Set<string>>) {
    const g = graph.current;
    if (!g) return;
    const hidden = new Set<string>();
    for (const f of folded.current) for (const h of branches.get(f) ?? []) hidden.add(h);
    for (const n of g.nodes.values()) n.el.style.display = hidden.has(n.id) ? "none" : "";
    for (const e of g.edges) {
      const off = hidden.has(e.from) || hidden.has(e.to);
      e.el.style.display = off ? "none" : "";
      if (e.label) e.label.style.display = off ? "none" : "";
    }
    setFoldedCount(folded.current.size);
  }

  function drawToggle(g: SVGGElement, state: "open" | "closed", hidden: number | null, onClick: () => void) {
    g.querySelector(":scope > .node-toggle")?.remove();
    const bb = g.getBBox();
    const t = document.createElementNS(SVG, "g");
    t.setAttribute("class", `node-toggle ${state}`);
    t.setAttribute("transform", `translate(${bb.x + bb.width}, ${bb.y + bb.height / 2})`);
    t.setAttribute("role", "button");
    const what = state === "open" ? "Hide what hangs from this" : `Show ${hidden ? `${hidden} more` : "what hangs from this"}`;
    t.setAttribute("aria-label", what);
    const c = document.createElementNS(SVG, "circle");
    c.setAttribute("r", "9");
    const tx = document.createElementNS(SVG, "text");
    tx.setAttribute("text-anchor", "middle");
    tx.setAttribute("dominant-baseline", "central");
    tx.textContent = state === "open" ? "−" : "+";
    const title = document.createElementNS(SVG, "title");
    title.textContent = what;
    t.append(title, c, tx);
    t.addEventListener("pointerdown", (e) => e.stopPropagation());
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    g.appendChild(t);
  }

  /** Clicks, keys, plus/minus signs and dragging for each node. */
  function wireNodes(box: HTMLElement) {
    const g = graph.current;
    const svg = box.querySelector("svg");
    if (!g || !svg) return;
    let grow = 0;
    const controlled = !!togglesRef.current && !!toggleRef.current;
    hanging.current = controlled ? new Map() : hangingFrom([...g.nodes.keys()], g.edges);
    const branch = hanging.current;
    let justDragged = false;

    for (const n of g.nodes.values()) {
      const el = n.el;
      const nid = n.id;
      const how = (e: MouseEvent | KeyboardEvent): NodeClick => ({ extend: e.ctrlKey || e.metaKey || e.shiftKey, shift: e.shiftKey });
      const foldable = controlled ? !!togglesRef.current?.[nid] : branch.has(nid);
      const flip = () => {
        if (controlled) return toggleRef.current?.(nid);
        if (folded.current.has(nid)) folded.current.delete(nid);
        else folded.current.add(nid);
        drawToggle(el, folded.current.has(nid) ? "closed" : "open", branch.get(nid)?.size ?? null, flip);
        applyFolds(branch);
      };
      el.addEventListener("click", (e) => {
        if (justDragged) return void (justDragged = false);
        clickRef.current?.(nid, how(e));
      });
      // Keyboard access: Tab to a node, Enter or Space to select it, + and - (or arrows) to open and close it.
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
      el.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && clickRef.current) {
          e.preventDefault();
          clickRef.current(nid, how(e));
        } else if (foldable && ["+", "=", "-", "ArrowRight", "ArrowLeft"].includes(e.key)) {
          const opening = e.key === "+" || e.key === "=" || e.key === "ArrowRight";
          const isOpen = controlled ? togglesRef.current?.[nid] === "open" : !folded.current.has(nid);
          if (opening !== isOpen) {
            e.preventDefault();
            flip();
          }
        }
      });
      el.addEventListener("pointerdown", (e) => {
        const d = dropRef.current;
        if (d) {
          if (nid === "root") return;
          startDrag(e, {
            label: labelRef.current?.(nid) ?? el.textContent?.trim() ?? "",
            target: (x, y) => {
              const hit = document.elementFromPoint(x, y)?.closest<SVGGElement>("g.node");
              const to = hit?.dataset.nid;
              return hit && to && box.contains(hit) && d.canDrop(nid, to) ? { el: hit, id: to, zone: "inside" } : null;
            },
            drop: (t, copy) => t.id && dropRef.current?.drop(nid, t.id, copy),
          });
        } else if (interactive && e.pointerType !== "touch" && e.button === 0) {
          // Rearranging: the node follows the pointer and its edges re-route.
          const ctm = svg.getScreenCTM();
          if (!ctm) return;
          const inv = ctm.inverse();
          const at = (cx: number, cy: number) => new DOMPoint(cx, cy).matrixTransform(inv);
          const p0 = at(e.clientX, e.clientY);
          const [ox, oy] = offsets.current[nid] ?? [0, 0];
          let active = false;
          const move = (ev: PointerEvent) => {
            if (!active && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
            active = true;
            el.classList.add("moving");
            const p = at(ev.clientX, ev.clientY);
            offsets.current[nid] = [ox + p.x - p0.x, oy + p.y - p0.y];
            layout(nid);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            el.classList.remove("moving");
            if (!active) return;
            justDragged = true;
            setTimeout(() => (justDragged = false), 0);
            saveOffsets(code, offsets.current);
            setMoved(true);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }
      });
      // The plus or minus sign sits on the node's right edge, where its branch joins.
      if (foldable && (controlled || interactive)) {
        const state = controlled ? togglesRef.current![nid] : folded.current.has(nid) ? "closed" : "open";
        drawToggle(el, state, branch.get(nid)?.size ?? null, flip);
        grow = 12;
      }
    }
    if (!controlled) applyFolds(branch);
    // Room for the signs on the right-most nodes.
    const vb = svg.viewBox?.baseVal;
    if (vb && grow) svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.width + grow} ${vb.height}`);
  }

  function resetLayout() {
    offsets.current = {};
    saveOffsets(code, {});
    layout();
    setMoved(false);
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
        // A diagram that fits its column keeps the SVG's own max-width: 100%.
        if (!(fit && !zoom)) applyScale(ref.current, scaleRef.current);
        setError(null);
        graph.current = readGraph(ref.current, code);
        // A static diagram (e.g. a lesson's concept map) keeps the arrangement the student gave it.
        offsets.current = dropRef.current || !interactive ? {} : loadOffsets(code);
        const known = new Set(graph.current?.nodes.keys() ?? []);
        for (const k of Object.keys(offsets.current)) if (!known.has(k)) delete offsets.current[k];
        folded.current = new Set([...folded.current].filter((k) => known.has(k)));
        setMoved(Object.keys(offsets.current).length > 0);
        if (Object.keys(offsets.current).length) layout();
        if (clickRef.current || dropRef.current || interactive) wireNodes(ref.current);
        setRendered((r) => r + 1);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, id]);

  function unfoldAll() {
    folded.current.clear();
    ref.current?.querySelectorAll(".node-toggle.closed").forEach((t) => {
      t.classList.replace("closed", "open");
      t.querySelector("text")!.textContent = "−";
    });
    applyFolds(hanging.current);
  }

  const extras = (moved || foldedCount > 0) && (
    <>
      {foldedCount > 0 && (
        <button className="sm" onClick={unfoldAll} title="Show every folded branch again">
          Unfold all
        </button>
      )}
      {moved && (
        <button className="sm" onClick={resetLayout} title="Put the nodes you dragged back where they were drawn">
          Reset layout
        </button>
      )}
    </>
  );

  return (
    <div>
      {error && <div className="alert error small" role="alert">Diagram could not be rendered: {error}</div>}
      {(zoom || extras) && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 6, gap: 4 }}>
          {extras}
          {zoom && (
            <>
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
            </>
          )}
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
