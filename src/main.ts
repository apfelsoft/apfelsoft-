import "./style.css";
import { createCanvas2dRenderer } from "./renderers/canvas2d";
import { createCssRenderer } from "./renderers/css";
import { createSvgRenderer } from "./renderers/svg";
import type { SceneRenderer } from "./renderers/types";
import { initParallax } from "./parallax";
import type { Corner, CornerShape, EdgeAxis, Point } from "./geometry";
import { SHAPES, radiusFromPointer } from "./geometry";
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

const sceneHost = document.getElementById("scene-host") as HTMLElement;

const drawChrome = createView(stage);
const state = initialState(stageWrap.clientWidth, stageWrap.clientHeight);

/* ------------------------------------------------------------------------ *
 *  Renderer tabs: CSS / Canvas 2D / SVG / WebGPU — same scene, same state
 * ------------------------------------------------------------------------ */

const MODES = ["css", "canvas", "svg", "webgpu"] as const;
type Mode = (typeof MODES)[number];
/**
 * The WebGPU/Slug renderer pulls in TypeGPU, so it loads lazily on first
 * activation — the base bundle stays small for the mobile-first default.
 */
function lazyWebGpu(): SceneRenderer {
  let real: SceneRenderer | null = null;
  return {
    label: "WEBGPU · SLUG",
    supported: typeof navigator !== "undefined" && !!navigator.gpu,
    async mount(host) {
      real ??= (await import("./renderers/webgpu")).createWebGpuRenderer();
      await real.mount(host);
    },
    draw(state) { real?.draw(state); },
    unmount() { real?.unmount(); },
  };
}

const renderers: Record<Mode, SceneRenderer> = {
  css: createCssRenderer(),
  canvas: createCanvas2dRenderer(),
  svg: createSvgRenderer(),
  webgpu: lazyWebGpu(),
};
let mode: Mode = "css";

async function setMode(next: Mode): Promise<void> {
  if (!renderers[next].supported) return;
  renderers[mode].unmount();
  mode = next;
  document.querySelectorAll<HTMLButtonElement>("#tabs [data-mode]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.mode === mode));
  });
  try {
    await renderers[mode].mount(sceneHost);
  } catch {
    // e.g. WebGPU adapter refused at runtime — fall back to CSS.
    if (mode !== "css") { void setMode("css"); return; }
  }
  sync();
}

document.querySelectorAll<HTMLButtonElement>("#tabs [data-mode]").forEach((b) => {
  const m = b.dataset.mode as Mode;
  if (!renderers[m].supported) {
    b.disabled = true;
    b.title = "Not supported by this browser";
    return;
  }
  b.addEventListener("click", () => { void setMode(m).then(persistURL); });
});

/* ------------------------------------------------------------------------ *
 *  Shareable URL state: ?r=48&p=24&ref=outer
 * ------------------------------------------------------------------------ */

{
  const q = new URLSearchParams(location.search);
  const ref = q.get("ref");
  if (ref === "inner" || ref === "outer") state.ref = ref;
  const p = Number(q.get("p"));
  if (Number.isFinite(p) && q.has("p")) state.padding = Math.round(clampPadding(state, p));
  const r = Number(q.get("r"));
  if (Number.isFinite(r) && q.has("r")) state.radius = Math.round(clampLinkedRadius(state, r));
  const m = q.get("mode") as Mode | null;
  if (m && (MODES as readonly string[]).includes(m) && renderers[m].supported) mode = m;
  const sh = q.get("shape") as CornerShape | null;
  if (sh && (SHAPES as readonly string[]).includes(sh)) state.shape = sh;
}

/** Written when a gesture ends, so mid-drag doesn't spam history. */
function persistURL(): void {
  const q = new URLSearchParams();
  q.set("r", String(state.radius));
  q.set("p", String(state.padding));
  q.set("ref", state.ref);
  q.set("mode", mode);
  q.set("shape", state.shape);
  history.replaceState(null, "", `?${q}`);
}

/* ------------------------------------------------------------------------ *
 *  The live CSS calculus for the DERIVED box
 * ------------------------------------------------------------------------ */

function shapeNote(s: AppState): string {
  if (s.shape === "squircle") return `\n.outer, .inner { corner-shape: squircle; }`;
  if (s.shape === "catenary") return `\n/* catenary corner: no CSS equivalent — CSS tab shows round */`;
  return "";
}

function cssCalculus(s: AppState): string {
  const p = s.padding;
  if (s.ref === "outer") {
    const r = s.radius;
    const ri = innerRadius(s);
    return `/* outer is the reference — inner is derived */
.outer { --r: ${r}px; --p: ${p}px;
         border-radius: var(--r); padding: var(--p); }
.inner { border-radius: max(0px, calc(var(--r) - var(--p))); }
         /* max(0, ${r} − ${p}) = ${ri}px${r < p ? "  ← clamped sharp" : ""} */${shapeNote(s)}`;
  }
  const r = s.radius;
  const ro = outerRadius(s);
  return `/* inner is the reference — outer is derived */
.inner { --r: ${r}px; border-radius: var(--r); }
.outer { --p: ${p}px; padding: var(--p);
         border-radius: calc(var(--r) + var(--p)); }
         /* ${r} + ${p} = ${ro}px */${shapeNote(s)}`;
}

/* ------------------------------------------------------------------------ *
 *  Rendering: SVG scene + the HTML bits that follow it
 * ------------------------------------------------------------------------ */

function sync(): void {
  drawChrome(state, activeOf(drag));
  renderers[mode].draw(state);
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

/**
 * A short haptic tick the moment a drag hits its clamp limit (ρ at 0 or
 * max, padding at min or max) — once per boundary entry, touch only.
 */
let atLimit = false;
function hapticAtLimit(requested: number, clamped: number): void {
  const hit = Math.abs(requested - clamped) > 1;
  if (hit && !atLimit) navigator.vibrate?.(8);
  atLimit = hit;
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

const shapeMenu = document.getElementById("shapeMenu") as HTMLElement;

function openShapeMenu(at: Point): void {
  shapeMenu.hidden = false;
  shapeMenu.style.left = `${Math.max(8, Math.min(at.x, stageWrap.clientWidth - 110))}px`;
  shapeMenu.style.top = `${Math.max(8, Math.min(at.y, stageWrap.clientHeight - 110))}px`;
  shapeMenu.querySelectorAll<HTMLButtonElement>("[data-shape]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.shape === state.shape));
  });
}

shapeMenu.querySelectorAll<HTMLButtonElement>("[data-shape]").forEach((b) => {
  b.addEventListener("click", () => {
    state.shape = b.dataset.shape as CornerShape;
    shapeMenu.hidden = true;
    sync();
    persistURL();
  });
});

let longPress: ReturnType<typeof setTimeout> | undefined;

stage.addEventListener("pointerdown", (e) => {
  shapeMenu.hidden = true;
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
  // Long-press on a corner (its handles) brings up the shape toggle.
  if ((role === "radius" || role === "resize") && drag.corner) {
    const at = { ...pt };
    longPress = setTimeout(() => {
      if (!drag) return;
      drag = null;
      openShapeMenu(at);
      sync();
    }, 550);
  }
  sync();
});

stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const pt = toStage(e);
  if (Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y) > 8) clearTimeout(longPress);

  if (drag.role === "radius" && drag.corner && drag.axis) {
    // Requested ρ is the pointer's distance from the corner along the edge
    // of the REFERENCE box; all corners share the result.
    const requested = radiusFromPointer(refRect(state), drag.corner, drag.axis, pt);
    state.radius = Math.round(clampLinkedRadius(state, requested));
    hapticAtLimit(requested, state.radius);
  } else if (drag.role === "padding" && drag.edge) {
    // Padding follows the pointer's depth orthogonal to the grabbed edge.
    drag.at = drag.edge === "top" || drag.edge === "bottom" ? pt.x : pt.y;
    const requested = orthogonalDepth(drag.edge, pt);
    state.padding = Math.round(clampPadding(state, requested));
    hapticAtLimit(requested, state.padding);
    state.radius = clampLinkedRadius(state, state.radius);
  } else if (drag.role === "resize" && drag.corner) {
    // Corner resize is symmetric about the box center, so the rectangle
    // stays centered where it was.
    const r0 = drag.rect0;
    const cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
    const w = Math.max(MIN_SIZE, 2 * Math.abs(pt.x - cx));
    const h = Math.max(MIN_SIZE, 2 * Math.abs(pt.y - cy));
    state.rect = {
      x: Math.round(cx - w / 2), y: Math.round(cy - h / 2),
      w: Math.round(w), h: Math.round(h),
    };
    state.padding = clampPadding(state, state.padding);
    state.radius = clampLinkedRadius(state, state.radius);
  }
  sync();
});

function endDrag(e: PointerEvent): void {
  clearTimeout(longPress);
  if (!drag) return;
  drag = null;
  atLimit = false;
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  sync(); // drop the construction overlay
  persistURL();
}
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);

// Double-click any radius handle to square all corners off (ρ = 0).
stage.addEventListener("dblclick", (e) => {
  if (!(e.target as Element).closest('[data-role="radius"]')) return;
  state.radius = 0;
  sync();
  persistURL();
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
  persistURL();
});

/* ------------------------------------------------------------------------ *
 *  Copy buttons on every CSS block
 * ------------------------------------------------------------------------ */

document.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const pre = btn.parentElement?.querySelector("pre");
    if (!pre) return;
    try {
      await navigator.clipboard.writeText(pre.textContent ?? "");
      btn.textContent = "COPIED";
    } catch {
      btn.textContent = "FAILED";
    }
    setTimeout(() => { btn.textContent = "COPY"; }, 1200);
  });
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

// Subtle gyro parallax where orientation data exists (iOS asks on first tap).
initParallax(stageWrap);

void setMode(mode);
