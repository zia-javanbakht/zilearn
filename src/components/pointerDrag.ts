/*
 * Drag and drop with pointer events, so it works the same with a mouse, a pen and a finger.
 * A mouse drag starts after a small move; a touch drag starts after holding still for a moment,
 * so a plain swipe still scrolls the page.
 */

export type DropZone = "before" | "inside" | "after";

export interface DropTarget {
  /** The element to highlight. */
  el: Element;
  /** The topic dropped on; null for the top level. */
  id: string | null;
  zone: DropZone;
}

export interface DragOptions {
  /** Shown next to the pointer, e.g. the topic's name or "3 topics". */
  label: string;
  /** The drop target under a point, or null where nothing can be dropped. */
  target: (x: number, y: number) => DropTarget | null;
  /** Holding Alt (Option) or Ctrl while dropping asks for a copy. */
  drop: (t: DropTarget, copy: boolean) => void;
  onStart?: () => void;
}

const MOVE = 6;
const HOLD = 450;

let busy = false;

export function startDrag(e: PointerEvent, o: DragOptions) {
  if (busy || e.button !== 0 || e.isPrimary === false) return;
  const touch = e.pointerType !== "mouse";
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;
  let ghost: HTMLDivElement | null = null;
  let over: DropTarget | null = null;
  let copy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  busy = true;

  const highlight = (t: DropTarget | null) => {
    if (over?.el !== t?.el || over?.zone !== t?.zone) {
      over?.el.classList.remove("drop-before", "drop-inside", "drop-after");
      t?.el.classList.add(`drop-${t.zone}`);
    }
    over = t;
  };

  const activate = (x: number, y: number) => {
    active = true;
    ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = o.label;
    document.body.appendChild(ghost);
    document.body.classList.add("dragging");
    o.onStart?.();
    move(x, y);
    navigator.vibrate?.(15);
  };

  // Near the edge of the window (or of a scrolling box such as a wide map), scroll towards it.
  let last = { x: x0, y: y0 };
  let scrolling = 0;
  const edgeScroll = () => {
    scrolling = 0;
    if (!active) return;
    const { x, y } = last;
    const step = (d: number, size: number) => (d < 48 ? -Math.ceil((48 - d) / 3) : d > size - 48 ? Math.ceil((d - size + 48) / 3) : 0);
    let moved = false;
    const dy = step(y, window.innerHeight);
    if (dy) (window.scrollBy(0, dy), (moved = true));
    const box = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(".mermaid-box");
    if (box) {
      const r = box.getBoundingClientRect();
      const dx = step(x - r.left, r.width);
      if (dx && box.scrollWidth > box.clientWidth) (box.scrollBy(dx, 0), (moved = true));
    }
    if (moved) {
      highlight(o.target(x, y));
      scrolling = requestAnimationFrame(edgeScroll);
    }
  };

  const move = (x: number, y: number) => {
    last = { x, y };
    if (!ghost) return;
    if (!scrolling) scrolling = requestAnimationFrame(edgeScroll);
    ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    ghost.dataset.copy = copy ? "1" : "";
    highlight(o.target(x, y));
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const far = Math.hypot(ev.clientX - x0, ev.clientY - y0) > MOVE;
    copy = ev.altKey || ev.ctrlKey;
    if (active) return move(ev.clientX, ev.clientY);
    if (!far) return;
    if (touch) return stop(); // moved before the hold: it's a scroll
    activate(ev.clientX, ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const t = active ? o.target(ev.clientX, ev.clientY) : null;
    const wasActive = active;
    stop();
    if (!wasActive) return;
    // The drop ends with a click on whatever is under the pointer; swallow it.
    const swallow = (c: Event) => (c.stopPropagation(), c.preventDefault());
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 50);
    if (t) o.drop(t, ev.altKey || ev.ctrlKey);
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") stop();
    else if (ev.key === "Alt" || ev.key === "Control") ((copy = ev.type === "keydown"), ghost && (ghost.dataset.copy = copy ? "1" : ""));
  };
  // Once a touch drag has started, keep the page from scrolling under the finger.
  const onTouchMove = (ev: TouchEvent) => active && ev.cancelable && ev.preventDefault();
  const onCancel = (ev: PointerEvent) => ev.pointerId === e.pointerId && stop();

  function stop() {
    if (timer) clearTimeout(timer);
    if (scrolling) cancelAnimationFrame(scrolling);
    scrolling = 0;
    highlight(null);
    ghost?.remove();
    document.body.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
    window.removeEventListener("touchmove", onTouchMove);
    active = false;
    busy = false;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  if (touch) timer = setTimeout(() => activate(x0, y0), HOLD);
}
