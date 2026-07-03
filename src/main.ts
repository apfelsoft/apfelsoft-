import "./style.css";
import type { Corner, EdgeAxis, Point } from "./geometry";
import { radiusFromPointer } from "./geometry";
import type { ActiveDrag, Edge } from "./render";
import { createView } from "./render";
import type { AppState } from "./state";
import {
  MIN_SIZE,
  clampLinkedRadius,
  clampPadding,
  initialState,
  innerRadius,
  outerRadius,
  refRect,
} from "./state";

const stage = document.getElementById("stage") as unknown as SVGSVGElement;
const stageWrap = document.getElementById("stage-wrap") as HTMLElement;
const toggleBtn = document.getElementById("refToggle") as HTMLButtonElement;
const cssCode = document.getElementById("cssCode") as HTMLElement;

const render = createView(stage);
const state = initialState(stageWrap.clientWidth, stageWrap.clientHeight);

/* ------------------------------------------------------------------------ *
 *  The live CSS calculus for the DERIVED box
 * ------------------------------------------------------------------------ */

function cssCalculus(s: AppState): string {
  const p = s.padding;
  if (s.ref === "outer") {
    const r = s.radius;
    const ri = innerRadius(s);
    return `/* outer is the reference — inner is derived */
.outer { --r: ${r}px; --p: ${p}px;
         border-radius: var(--r); padding: var(--p); }
.inner { border-radius: max(0px, calc(var(--r) - var(--p))); }
         /* max(0, ${r} − ${p}) = ${ri}px${r < p ? "  ← clamped sharp" : ""} */`;
  }
  const r = s.radius;
  const ro = outerRadius(s);
  return `/* inner is the reference — outer is derived */
.inner { --r: ${r}px; border-radius: var(--r); }
.outer { --p: ${p}px; padding: var(--p);
         border-radius: calc(var(--r) + var(--p)); }
         /* ${r} + ${p} = ${ro}px */`;
}

/* ------------------------------------------------------------------------ *
 *  Rendering: SVG scene + the HTML bits that follow it
 * ------------------------------------------------------------------------ */

function sync(): void {
  render(state, activeOf(drag));
  const cx = state.rect.x + state.rect.w / 2;
  const cy = state.rect.y + state.rect.h / 2;
  toggleBtn.style.left = `${cx}px`;
  toggleBtn.style.top = `${cy}px`;
  toggleBtn.textContent = `REF: ${state.ref.toUpperCase()} ⇄`;
  cssCode.textContent = cssCalculus(state);
}

/* ------------------------------------------------------------------------ *
 *  Dragging: radius handles (all corners linked), padding area, resize
 * ------------------------------------------------------------------------ */

interface Drag {
  role: "radius" | "resize" | "padding";
  corner?: Corner;
  axis?: EdgeAxis;
  edge?: Edge;
  at?: number;
  start: Point;
  rect0: { x: number; y: number; w: number; h: number };
}

let drag: Drag | null = null;

const activeOf = (d: Drag | null): ActiveDrag | null =>
  d ? { role: d.role, corner: d.corner, axis: d.axis, edge: d.edge, at: d.at } : null;

/** Pointer position in stage coordinates (the SVG no longer sits at 0,0). */
function toStage(e: PointerEvent): Point {
  const b = stage.getBoundingClientRect();
  return { x: e.clientX - b.left, y: e.clientY - b.top };
}

/** Which outer edge the pointer is nearest to — a padding drag sticks to it. */
function nearestEdge(pt: Point): Edge {
  const { x, y, w, h } = state.rect;
  const d: Array<[Edge, number]> = [
    ["top", Math.abs(pt.y - y)],
    ["bottom", Math.abs(y + h - pt.y)],
    ["left", Math.abs(pt.x - x)],
    ["right", Math.abs(x + w - pt.x)],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][0];
}

/** The pointer's distance INTO the box, orthogonal to the given edge. */
function orthogonalDepth(edge: Edge, pt: Point): number {
  const { x, y, w, h } = state.rect;
  switch (edge) {
    case "top": return pt.y - y;
    case "bottom": return y + h - pt.y;
    case "left": return pt.x - x;
    case "right": return x + w - pt.x;
  }
}

stage.addEventListener("pointerdown", (e) => {
  const target = (e.target as Element).closest<SVGElement>("[data-role]");
  if (!target) return;
  const pt = toStage(e);
  const role = target.dataset.role as Drag["role"];
  drag = {
    role,
    corner: target.dataset.corner as Corner | undefined,
    axis: target.dataset.axis as EdgeAxis | undefined,
    start: pt,
    rect0: { ...state.rect },
  };
  if (role === "padding") {
    drag.edge = nearestEdge(pt);
    drag.at = drag.edge === "top" || drag.edge === "bottom" ? pt.x : pt.y;
    state.padding = Math.round(clampPadding(state, orthogonalDepth(drag.edge, pt)));
    state.radius = clampLinkedRadius(state, state.radius);
  }
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
  sync();
});

stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const pt = toStage(e);

  if (drag.role === "radius" && drag.corner && drag.axis) {
    // Requested ρ is the pointer's distance from the corner along the edge
    // of the REFERENCE box; all corners share the result.
    const requested = radiusFromPointer(refRect(state), drag.corner, drag.axis, pt);
    state.radius = Math.round(clampLinkedRadius(state, requested));
  } else if (drag.role === "padding" && drag.edge) {
    // Padding follows the pointer's depth orthogonal to the grabbed edge.
    drag.at = drag.edge === "top" || drag.edge === "bottom" ? pt.x : pt.y;
    state.padding = Math.round(clampPadding(state, orthogonalDepth(drag.edge, pt)));
    state.radius = clampLinkedRadius(state, state.radius);
  } else if (drag.role === "resize" && drag.corner) {
    const r0 = drag.rect0;
    let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
    if (drag.corner === "tl" || drag.corner === "bl") x1 = Math.min(pt.x, x2 - MIN_SIZE);
    else x2 = Math.max(pt.x, x1 + MIN_SIZE);
    if (drag.corner === "tl" || drag.corner === "tr") y1 = Math.min(pt.y, y2 - MIN_SIZE);
    else y2 = Math.max(pt.y, y1 + MIN_SIZE);
    state.rect = {
      x: Math.round(x1), y: Math.round(y1),
      w: Math.round(x2 - x1), h: Math.round(y2 - y1),
    };
    state.padding = clampPadding(state, state.padding);
    state.radius = clampLinkedRadius(state, state.radius);
  }
  sync();
});

function endDrag(e: PointerEvent): void {
  if (!drag) return;
  drag = null;
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  sync(); // drop the construction overlay
}
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);

// Double-click any radius handle to square all corners off (ρ = 0).
stage.addEventListener("dblclick", (e) => {
  if (!(e.target as Element).closest('[data-role="radius"]')) return;
  state.radius = 0;
  sync();
});

/* ------------------------------------------------------------------------ *
 *  Reference toggle
 * ------------------------------------------------------------------------ */

// Swap which box is the reference. The visible radii stay put: the new
// reference adopts the radius the toggle-target box already has.
toggleBtn.addEventListener("click", () => {
  if (state.ref === "outer") {
    state.radius = innerRadius(state);
    state.ref = "inner";
  } else {
    state.radius = outerRadius(state);
    state.ref = "outer";
  }
  state.radius = clampLinkedRadius(state, state.radius);
  sync();
});

/* ------------------------------------------------------------------------ *
 *  Mobile ergonomics: auto-hide the drag targets after a few idle seconds
 * ------------------------------------------------------------------------ */

const IDLE_MS = 4000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function wake(): void {
  stageWrap.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (drag) { wake(); return; } // never hide mid-drag
    stageWrap.classList.add("idle");
  }, IDLE_MS);
}
stageWrap.addEventListener("pointerdown", wake);
stageWrap.addEventListener("pointermove", wake);
wake();

window.addEventListener("resize", sync);

sync();
