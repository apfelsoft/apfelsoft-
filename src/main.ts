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
 *  Corner-shape tabs (all CSS corner-shape types + catenary) and the
 *  superellipse k slider, shown only while SUPERELLIPSE is active
 * ------------------------------------------------------------------------ */

const kRow = document.getElementById("kRow") as HTMLElement;
const kInput = document.getElementById("kExp") as HTMLInputElement;
const kOut = document.getElementById("kOut") as HTMLOutputElement;

function syncShapeUI(): void {
  document.querySelectorAll<HTMLButtonElement>("#shapes [data-shape]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.shape === state.shape));
  });
  kRow.hidden = state.shape !== "superellipse";
  kInput.value = String(state.k);
  kOut.textContent = state.k.toFixed(2);
}

document.querySelectorAll<HTMLButtonElement>("#shapes [data-shape]").forEach((b) => {
  b.addEventListener("click", () => {
    state.shape = b.dataset.shape as CornerShape;
    syncShapeUI();
    sync();
    persistURL();
  });
});
kInput.addEventListener("input", () => {
  state.k = Number(kInput.value);
  kOut.textContent = state.k.toFixed(2);
  sync();
});
kInput.addEventListener("change", persistURL);

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
  const k = Number(q.get("k"));
  if (Number.isFinite(k) && q.has("k")) state.k = Math.max(-3, Math.min(3, k));
}

/** Written when a gesture ends, so mid-drag doesn't spam history. */
function persistURL(): void {
  const q = new URLSearchParams();
  q.set("r", String(state.radius));
  q.set("p", String(state.padding));
  q.set("ref", state.ref);
  q.set("mode", mode);
  q.set("shape", state.shape);
  if (state.shape === "superellipse") q.set("k", String(state.k));
  history.replaceState(null, "", `?${q}`);
}

/* ------------------------------------------------------------------------ *
 *  The live CSS calculus for the DERIVED box
 * ------------------------------------------------------------------------ */

function shapeNote(s: AppState): string {
  if (s.shape === "round") return "";
  if (s.shape === "catenary") {
    // Not a superellipse — the CSS tab draws the whole outline as an
    // evenodd shape() ring when the engine supports it.
    return CSS.supports("clip-path", "shape(evenodd from 0px 0px, line to 1px 0px, line to 1px 1px, close)")
      ? `\n.box { clip-path: shape(evenodd from \u2026, line to \u2026, close,\n                        move to \u2026, line to \u2026, close); }  /* true catenary ring */`
      : `\n.outer, .inner { corner-shape: superellipse(1.171); }  /* \u2248 catenary; shape() unsupported */`;
  }
  const cs = s.shape === "superellipse" ? `superellipse(${s.k})` : s.shape;
  const support = CSS.supports("corner-shape", cs)
    ? "" : "\n/* corner-shape unsupported here \u2192 CSS tab shows round */";
  return `\n.outer, .inner { corner-shape: ${cs}; }${support}`;
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

const remPx = (): number =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * Keep the box inside the stage. If it ends up crossing the 1rem margin
 * (window resize, rotation), scale it down at its aspect ratio and re-seat
 * it within a roomier 2rem margin — the overcorrection keeps it from
 * riding the trigger boundary.
 */
function fitBoxToStage(): void {
  const rem = remPx();
  const W = stageWrap.clientWidth, H = stageWrap.clientHeight;
  const soft = rem, hard = 2 * rem;
  const r = state.rect;
  const violates = r.x < soft || r.y < soft ||
    r.x + r.w > W - soft || r.y + r.h > H - soft;
  if (!violates) return;
  const scale = Math.min(1, (W - 2 * hard) / r.w, (H - 2 * hard) / r.h);
  const w = Math.max(MIN_SIZE, Math.round(r.w * scale));
  const h = Math.max(MIN_SIZE, Math.round(r.h * scale));
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
  x = Math.min(Math.max(x, hard), Math.max(hard, W - hard - w));
  y = Math.min(Math.max(y, hard), Math.max(hard, H - hard - h));
  state.rect = { x, y, w, h };
  state.padding = Math.round(clampPadding(state, state.padding));
  state.radius = clampLinkedRadius(state, state.radius);
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
    // The centered resize may never push an edge past the 1rem stage margin.
    const soft = remPx();
    const maxW = 2 * Math.min(cx - soft, stageWrap.clientWidth - soft - cx);
    const maxH = 2 * Math.min(cy - soft, stageWrap.clientHeight - soft - cy);
    const w = Math.min(Math.max(MIN_SIZE, 2 * Math.abs(pt.x - cx)), Math.max(MIN_SIZE, maxW));
    const h = Math.min(Math.max(MIN_SIZE, 2 * Math.abs(pt.y - cy)), Math.max(MIN_SIZE, maxH));
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
  if (!drag) return;
  drag = null;
  idleMs = 2000; // first edit is done — auto-hide twice as fast from now on
  wake();        // re-arm the idle timer with the shorter delay
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

// Generous before the first edit; once the user has completed one gesture
// they know where the targets are, so the chrome gets out of the way 50%
// faster.
let idleMs = 4000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function wake(): void {
  stageWrap.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (drag) { wake(); return; } // never hide mid-drag
    stageWrap.classList.add("idle");
  }, idleMs);
}
stageWrap.addEventListener("pointerdown", wake);
stageWrap.addEventListener("pointermove", wake);
wake();

window.addEventListener("resize", () => {
  fitBoxToStage();
  sync();
});

fitBoxToStage();
syncShapeUI();

// Subtle gyro parallax where orientation data exists (iOS asks on first tap).
initParallax(stageWrap);

void setMode(mode);
