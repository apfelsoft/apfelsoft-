import type { Corner, EdgeAxis, Point, Rect } from "./geometry";
import {
  CORNERS,
  arcCenter,
  arcStartPoint,
  roundedRectPath,
  uniformRadii,
} from "./geometry";
import type { AppState } from "./state";
import { innerRadius, innerRect, outerRadius, refRect } from "./state";
import { BASELINE, CAP, GLYPHS, SPACE_ADV } from "./hershey";

const SVG_NS = "http://www.w3.org/2000/svg";

/** One of the outer box's four edges — the padding drag remembers which. */
export type Edge = "top" | "right" | "bottom" | "left";

/** What the pointer is currently dragging — drives the construction overlay. */
export interface ActiveDrag {
  role: "radius" | "resize" | "padding";
  corner?: Corner;
  axis?: EdgeAxis;
  /** For padding drags: the edge being pushed... */
  edge?: Edge;
  /** ...and the pointer's coordinate ALONG that edge, for the dimension. */
  at?: number;
}

/* ----------------------------- drawing inks ----------------------------- *
 * Line-on-black. The boxes are full strokes; ALL auxiliary construction —
 * center lines, spokes, dimensions — is 0.5px hairline at 50% white, and
 * construction circles are dotted.
 */
const INK = "#f2f2f2";                     // the boxes and handles
const DIM = "#8f8f8f";                     // derived box, secondary UI
const AUX = "rgba(255,255,255,0.5)";       // every auxiliary line
const AUX_W = 0.5;
const LABEL = "rgba(255,255,255,0.65)";    // lettering on aux geometry
const DASH_CENTER = "16 4 3 4";            // CAD center-line: long dash, dot, …
const DOTTED = "0.1 4.5";                  // round-cap dots for circles

/** Create an SVG element with attributes, optionally appended to a parent. */
function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

/* --------------------------- Hershey lettering -------------------------- */

function textAdvance(text: string): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? SPACE_ADV : (GLYPHS[ch]?.adv ?? SPACE_ADV);
  return w;
}

/**
 * Stroke a string in single-line Hershey lettering. (x, y) is the baseline
 * anchor; size is the capital-letter height in pixels.
 */
function hersheyText(
  parent: Element,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { anchor?: "start" | "middle" | "end"; color?: string } = {},
): void {
  const s = size / CAP;
  const total = textAdvance(text) * s;
  const dx = opts.anchor === "middle" ? -total / 2 : opts.anchor === "end" ? -total : 0;
  const g = el("g", { transform: `translate(${x + dx} ${y}) scale(${s})` }, parent);
  let cursor = 0;
  for (const ch of text) {
    if (ch === " ") { cursor += SPACE_ADV; continue; }
    const glyph = GLYPHS[ch];
    if (!glyph) { cursor += SPACE_ADV; continue; }
    el("path", {
      d: glyph.d,
      transform: `translate(${cursor} ${-BASELINE})`,
      fill: "none",
      stroke: opts.color ?? LABEL,
      "stroke-width": 1.1,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke",
    }, g);
    cursor += glyph.adv;
  }
}

/* ------------------------- CAD drawing primitives ------------------------ */

/** An auxiliary hairline: 0.5px at 50% white. */
function auxLine(parent: Element, a: Point, b: Point, extra: Record<string, string | number> = {}): void {
  el("line", {
    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    stroke: AUX, "stroke-width": AUX_W, ...extra,
  }, parent);
}

/** Open (two-stroke) arrowhead at `tip`, pointing along the unit vector u. */
function arrowhead(parent: Element, tip: Point, u: Point): void {
  const L = 9, W = 3;
  for (const side of [1, -1]) {
    auxLine(parent, tip, {
      x: tip.x - u.x * L + side * -u.y * W,
      y: tip.y - u.y * L + side * u.x * W,
    }, { "stroke-width": 0.75 });
  }
}

/**
 * A dimension between p1 and p2, drawn offset sideways by `offset` pixels
 * (sign picks the side): extension lines from the measured points, a
 * dimension line with inward arrowheads, and the value lettered at its
 * middle — standard technical-drawing style.
 */
function dimension(parent: Element, p1: Point, p2: Point, offset: number, label: string): void {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const u = { x: dx / len, y: dy / len };
  // Sideways unit normal. Screen coordinates are y-down, so this is u
  // rotated CLOCKWISE: for a left→right line it points down the screen.
  const n = { x: -u.y, y: u.x };
  const q1 = { x: p1.x + n.x * offset, y: p1.y + n.y * offset };
  const q2 = { x: p2.x + n.x * offset, y: p2.y + n.y * offset };
  const over = Math.sign(offset) * 4;
  auxLine(parent, p1, { x: q1.x + n.x * over, y: q1.y + n.y * over });
  auxLine(parent, p2, { x: q2.x + n.x * over, y: q2.y + n.y * over });
  auxLine(parent, q1, q2);
  arrowhead(parent, q1, { x: -u.x, y: -u.y });
  arrowhead(parent, q2, u);
  const lift = 6;
  hersheyText(parent, label,
    (q1.x + q2.x) / 2 + n.x * Math.sign(offset) * lift,
    (q1.y + q2.y) / 2 + n.y * Math.sign(offset) * lift + 4,
    11, { anchor: "middle" });
}

/**
 * A NARROW dimension, CAD style for spans too tight to hold arrowheads:
 * the dimension line extends beyond both measured points and the two
 * arrows sit outside, tips touching p1 and p2, pointing INWARD at each
 * other. Used for the padding between the boxes.
 */
function narrowDimension(parent: Element, p1: Point, p2: Point): void {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const u = { x: dx / len, y: dy / len };
  const ext = 13;
  auxLine(parent,
    { x: p1.x - u.x * ext, y: p1.y - u.y * ext },
    { x: p2.x + u.x * ext, y: p2.y + u.y * ext });
  arrowhead(parent, p1, u);                      // outside, pointing in
  arrowhead(parent, p2, { x: -u.x, y: -u.y });   // outside, pointing in
  // No value lettered here — the calc stack is the single source of numbers.
}

/** CAD center mark: a small cross plus dash-dot center lines through c. */
function centerMark(parent: Element, c: Point, reach: number): void {
  for (const [ux, uy] of [[1, 0], [0, 1]] as const) {
    auxLine(parent, { x: c.x - ux * 5, y: c.y - uy * 5 }, { x: c.x + ux * 5, y: c.y + uy * 5 },
      { "stroke-width": 0.75 });
    auxLine(parent, { x: c.x - ux * reach, y: c.y - uy * reach },
      { x: c.x + ux * reach, y: c.y + uy * reach }, { "stroke-dasharray": DASH_CENTER });
  }
}

/** A dotted construction circle. */
function dottedCircle(parent: Element, c: Point, r: number, bright: boolean): void {
  el("circle", {
    cx: c.x, cy: c.y, r,
    fill: "none",
    stroke: bright ? "rgba(255,255,255,0.75)" : AUX,
    "stroke-width": 0.75,
    "stroke-dasharray": DOTTED,
    "stroke-linecap": "round",
  }, parent);
}

/* ------------------------------- the view -------------------------------- */

/**
 * Builds the persistent SVG scene graph once (interactive elements must not
 * be recreated mid-drag or pointer capture would break) and returns a render
 * function that redraws it from state plus the current drag, if any.
 */
export function createView(stage: SVGSVGElement): (state: AppState, active: ActiveDrag | null) => void {
  // Touch screens get bigger targets.
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const HIT_R = coarse ? 26 : 16;
  const DOT_R = coarse ? 6 : 4.5;
  const SQUARE = coarse ? 13 : 9;

  const gBoxes = el("g", { "pointer-events": "none" }, stage);
  const gGuides = el("g", { "pointer-events": "none" }, stage);
  const gAux = el("g", { "pointer-events": "none" }, stage);
  const gHit = el("g", {}, stage);
  const gHandles = el("g", { class: "handles" }, stage);

  const outerPath = el("path", { fill: "none", stroke: INK, "stroke-width": 1.6 }, gBoxes);
  const innerPath = el("path", { fill: "none", stroke: DIM, "stroke-width": 1.2 }, gBoxes);

  // The padding area — the ring between (slightly outside) the outer box
  // and the inner box. Dragging anywhere in it, or on an edge, sets the
  // padding orthogonally to that edge. fill-rule evenodd punches the inner
  // box out of the hit region.
  const paddingHit = el("path", {
    fill: "transparent",
    "fill-rule": "evenodd",
    stroke: "none",
    cursor: "crosshair",
  }, gHit);
  paddingHit.dataset.role = "padding";

  // Square resize handles on the outer box's corners.
  const cornerHandles = {} as Record<Corner, SVGRectElement>;
  for (const corner of CORNERS) {
    const cursor = corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize";
    const square = el("rect", {
      width: SQUARE, height: SQUARE,
      fill: "#000", stroke: DIM, "stroke-width": 1.2, cursor,
    }, gHandles);
    square.dataset.role = "resize";
    square.dataset.corner = corner;
    cornerHandles[corner] = square;
  }

  // Round radius handles: two per corner on the REFERENCE box. All corners
  // are linked, so every handle sets the same single ρ.
  const radiusHandles: SVGGElement[] = [];
  for (const corner of CORNERS) {
    for (const axis of ["h", "v"] as const) {
      const group = el("g", { cursor: axis === "h" ? "ew-resize" : "ns-resize" }, gHandles);
      group.dataset.role = "radius";
      group.dataset.corner = corner;
      group.dataset.axis = axis;
      el("circle", { r: HIT_R, fill: "transparent" }, group); // generous hit area
      el("circle", { r: DOT_R, fill: "#000", stroke: INK, "stroke-width": 1.4 }, group);
      radiusHandles.push(group);
    }
  }

  /**
   * The calculation stack: ρ, then ±p, then the derived result — symbols
   * left-aligned in one column, numbers right-aligned in a second, so the
   * relation reads directly like the subtraction it is. This is the ONLY
   * place the drag overlay letters numbers; dimensions stay unlabeled.
   */
  function calcStack(state: AppState, c: Point, corner: Corner): void {
    const onLeft = corner === "tl" || corner === "bl";
    const onTop = corner === "tl" || corner === "tr";
    const COL = 58, LH = 16;
    const x0 = onLeft ? c.x + 14 : c.x - 14 - COL;
    const rows: Array<[sym: string, val: number, bright: boolean]> = [
      ["ρ", state.radius, true],
      [state.ref === "outer" ? "-p" : "+p", state.padding, false],
      ["=", state.ref === "outer" ? innerRadius(state) : outerRadius(state), false],
    ];
    rows.forEach(([sym, val, bright], i) => {
      const y = onTop
        ? c.y + 22 + i * LH
        : c.y - 22 - (rows.length - 1 - i) * LH;
      const color = bright ? INK : LABEL;
      hersheyText(gAux, sym, x0, y, 11, { color });
      hersheyText(gAux, String(val), x0 + COL, y, 11, { anchor: "end", color });
    });
  }

  /** Construction overlay for an in-progress radius drag. */
  function drawRadiusAux(state: AppState, corner: Corner, axis: EdgeAxis): void {
    const ρOut = outerRadius(state);
    const ρIn = innerRadius(state);
    const ρRef = state.radius;
    // Outer and inner arcs share this center — the demo's whole point.
    const c = arcCenter(state.rect, corner, ρOut);

    centerMark(gAux, c, ρOut + 26);
    if (ρOut >= 1) dottedCircle(gAux, c, ρOut, state.ref === "outer");
    if (ρIn >= 1) dottedCircle(gAux, c, ρIn, state.ref === "inner");

    // Radius leader: center → the handle being dragged, arrow at the rim.
    const ref = refRect(state);
    const handle = arcStartPoint(ref, corner, axis, ρRef);
    if (ρRef > 1) {
      const u = { x: (handle.x - c.x) / ρRef, y: (handle.y - c.y) / ρRef };
      auxLine(gAux, c, handle, { "stroke-width": 0.75 });
      arrowhead(gAux, handle, u);
    }

    // The padding, narrow style with inward-pointing arrows, on the edge
    // being dragged (no number — the stack carries it).
    const midX = state.rect.x + state.rect.w / 2;
    narrowDimension(gAux,
      { x: midX, y: state.rect.y },
      { x: midX, y: state.rect.y + state.padding });

    calcStack(state, c, corner);
  }

  /** The padding dimension while dragging in the padding area. */
  function drawPaddingAux(state: AppState, edge: Edge, at: number): void {
    const { x, y, w, h } = state.rect;
    const p = state.padding;
    const ρOut = outerRadius(state);
    // Keep the dimension on the straight part of the edge, clear of arcs.
    const clampAlong = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(v, hi));
    let p1: Point, p2: Point;
    if (edge === "top" || edge === "bottom") {
      const ax = clampAlong(at, x + ρOut + 14, x + w - ρOut - 14);
      const edgeY = edge === "top" ? y : y + h;
      const inY = edge === "top" ? edgeY + p : edgeY - p;
      p1 = { x: ax, y: edgeY };
      p2 = { x: ax, y: inY };
    } else {
      const ay = clampAlong(at, y + ρOut + 14, y + h - ρOut - 14);
      const edgeX = edge === "left" ? x : x + w;
      const inX = edge === "left" ? edgeX + p : edgeX - p;
      p1 = { x: edgeX, y: ay };
      p2 = { x: inX, y: ay };
    }
    narrowDimension(gAux, p1, p2);
    // Anchor the calc stack at the corner that starts the grabbed edge.
    const corner: Corner = edge === "top" ? "tl" : edge === "right" ? "tr" : edge === "bottom" ? "br" : "bl";
    calcStack(state, arcCenter(state.rect, corner, ρOut), corner);
  }

  /** Width/height dimensions while resizing. */
  function drawResizeAux(state: AppState): void {
    const { x, y, w, h } = state.rect;
    dimension(gAux, { x, y: y + h }, { x: x + w, y: y + h }, 30, String(w));  // below
    dimension(gAux, { x: x + w, y: y + h }, { x: x + w, y }, 30, String(h));  // right
  }

  return function render(state: AppState, active: ActiveDrag | null): void {
    const ρOut = outerRadius(state);
    const ρIn = innerRadius(state);
    const inner = innerRect(state);

    outerPath.setAttribute("d", roundedRectPath(state.rect, uniformRadii(ρOut)));
    innerPath.setAttribute("d", roundedRectPath(inner, uniformRadii(ρIn)));
    // The reference box draws bright, the derived one dim.
    outerPath.setAttribute("stroke", state.ref === "outer" ? INK : DIM);
    innerPath.setAttribute("stroke", state.ref === "inner" ? INK : DIM);

    // Padding hit ring: from 10px outside the outer edge down to the inner
    // box (evenodd punches the inner region out).
    const outerHit: Rect = {
      x: state.rect.x - 10, y: state.rect.y - 10,
      w: state.rect.w + 20, h: state.rect.h + 20,
    };
    paddingHit.setAttribute("d",
      `${roundedRectPath(outerHit, uniformRadii(0))} ${roundedRectPath(inner, uniformRadii(ρIn))}`);

    // Idle guides: the shared center mark in each corner.
    gGuides.textContent = "";
    if (!active) {
      for (const corner of CORNERS) {
        if (ρOut < 2) break;
        const c = arcCenter(state.rect, corner, ρOut);
        for (const [ux, uy] of [[1, 0], [0, 1]] as const) {
          auxLine(gGuides, { x: c.x - ux * 5, y: c.y - uy * 5 }, { x: c.x + ux * 5, y: c.y + uy * 5 },
            { "stroke-width": 0.75 });
        }
      }
    }

    // Construction overlay during a drag.
    gAux.textContent = "";
    if (active?.role === "radius" && active.corner && active.axis) {
      drawRadiusAux(state, active.corner, active.axis);
    } else if (active?.role === "padding" && active.edge && active.at !== undefined) {
      drawPaddingAux(state, active.edge, active.at);
    } else if (active?.role === "resize") {
      drawResizeAux(state);
    }

    // Handles: resize squares on the outer box, radius handles on the
    // reference box.
    for (const corner of CORNERS) {
      const px = corner === "tl" || corner === "bl" ? state.rect.x : state.rect.x + state.rect.w;
      const py = corner === "tl" || corner === "tr" ? state.rect.y : state.rect.y + state.rect.h;
      cornerHandles[corner].setAttribute("x", String(px - SQUARE / 2));
      cornerHandles[corner].setAttribute("y", String(py - SQUARE / 2));
    }
    const ref = refRect(state);
    for (const group of radiusHandles) {
      const corner = group.dataset.corner as Corner;
      const axis = group.dataset.axis as EdgeAxis;
      const p = arcStartPoint(ref, corner, axis, state.radius);
      group.setAttribute("transform", `translate(${p.x} ${p.y})`);
    }
  };
}
