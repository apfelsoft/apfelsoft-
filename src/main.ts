import "./style.css";
import type { Corner, EdgeAxis, Rect } from "./geometry";
import { clampRadius, fitRadiiToRect, radiusFromPointer } from "./geometry";
import type { ActiveDrag } from "./render";
import { createView } from "./render";
import { MIN_SIZE, initialState } from "./state";

const stage = document.getElementById("stage") as unknown as SVGSVGElement;
const render = createView(stage);
const state = initialState(window.innerWidth, window.innerHeight);

/* ------------------------------------------------------------------------ *
 *  Dragging: radius handles, corner resize, whole-body move
 * ------------------------------------------------------------------------ */

/** What a pointer-down grabbed, plus where the drag started. */
interface Drag {
  role: "radius" | "resize" | "body";
  corner?: Corner;
  axis?: EdgeAxis;
  startX: number;
  startY: number;
  /** The rectangle as it was when the drag began. */
  rect0: Rect;
}

let drag: Drag | null = null;

/** What render() needs to know about the drag to show construction geometry. */
const activeOf = (d: Drag | null): ActiveDrag | null =>
  d ? { role: d.role, corner: d.corner, axis: d.axis } : null;

stage.addEventListener("pointerdown", (e) => {
  const target = (e.target as Element).closest<SVGElement>("[data-role]");
  if (!target) return;
  drag = {
    role: target.dataset.role as Drag["role"],
    corner: target.dataset.corner as Corner | undefined,
    axis: target.dataset.axis as EdgeAxis | undefined,
    startX: e.clientX,
    startY: e.clientY,
    rect0: { ...state.rect },
  };
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});

stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const pointer = { x: e.clientX, y: e.clientY };

  if (drag.role === "radius" && drag.corner && drag.axis) {
    // Requested ρ is the pointer's distance from the corner along the edge;
    // clampRadius keeps it legal against both neighboring corners.
    const requested = radiusFromPointer(state.rect, drag.corner, drag.axis, pointer);
    state.radii[drag.corner] = Math.round(
      clampRadius(state.rect, state.radii, drag.corner, requested),
    );
  } else if (drag.role === "body") {
    state.rect.x = Math.round(drag.rect0.x + (pointer.x - drag.startX));
    state.rect.y = Math.round(drag.rect0.y + (pointer.y - drag.startY));
  } else if (drag.role === "resize" && drag.corner) {
    // The dragged corner follows the pointer; the opposite corner stays put.
    const r0 = drag.rect0;
    let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
    if (drag.corner === "tl" || drag.corner === "bl") x1 = Math.min(pointer.x, x2 - MIN_SIZE);
    else x2 = Math.max(pointer.x, x1 + MIN_SIZE);
    if (drag.corner === "tl" || drag.corner === "tr") y1 = Math.min(pointer.y, y2 - MIN_SIZE);
    else y2 = Math.max(pointer.y, y1 + MIN_SIZE);
    state.rect = {
      x: Math.round(x1), y: Math.round(y1),
      w: Math.round(x2 - x1), h: Math.round(y2 - y1),
    };
    state.radii = fitRadiiToRect(state.rect, state.radii);
  }
  render(state, activeOf(drag));
});

function endDrag(e: PointerEvent): void {
  if (!drag) return;
  drag = null;
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  render(state, null); // drop the construction overlay
}
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);

// Double-click a radius handle to square that corner off (ρ = 0).
stage.addEventListener("dblclick", (e) => {
  const target = (e.target as Element).closest<SVGElement>('[data-role="radius"]');
  if (!target) return;
  state.radii[target.dataset.corner as Corner] = 0;
  render(state, activeOf(drag));
});

/* ------------------------------------------------------------------------ *
 *  Control panel
 * ------------------------------------------------------------------------ */

const ringsInput = document.getElementById("rings") as HTMLInputElement;
const gapInput = document.getElementById("gap") as HTMLInputElement;
const guidesInput = document.getElementById("guides") as HTMLInputElement;
const ringsOut = document.getElementById("ringsOut") as HTMLOutputElement;
const gapOut = document.getElementById("gapOut") as HTMLOutputElement;

ringsInput.addEventListener("input", () => {
  state.rings = Number(ringsInput.value);
  ringsOut.textContent = ringsInput.value;
  render(state, activeOf(drag));
});
gapInput.addEventListener("input", () => {
  state.gap = Number(gapInput.value);
  gapOut.textContent = gapInput.value;
  render(state, activeOf(drag));
});
guidesInput.addEventListener("change", () => {
  state.guides = guidesInput.checked;
  render(state, activeOf(drag));
});

window.addEventListener("resize", () => render(state, activeOf(drag)));

render(state, activeOf(drag));
