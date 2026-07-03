import type { Corner, EdgeAxis, Point } from "./geometry";
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

/** What the pointer is currently dragging — drives the construction overlay. */
export interface ActiveDrag {
  role: "radius" | "resize" | "body";
  corner?: Corner;
  axis?: EdgeAxis;
}

/* ----------------------------- drawing inks ----------------------------- *
 * Line-on-black: everything is a stroke, nothing is filled (black fills on
 * handles exist only to occlude the lines running beneath them).
 */
const INK = "#f2f2f2";        // the reference box and active construction
const DIM = "#8f8f8f";        // the derived box, dimensions, labels
const FAINT = "#565656";      // auxiliary construction lines
const DASH_CONSTRUCT = "5 6";
const DASH_CENTER = "16 4 3 4"; // CAD center-line: long dash, dot, …

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
      stroke: opts.color ?? DIM,
      "stroke-width": 1.1,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke",
    }, g);
    cursor += glyph.adv;
  }
}

/* ------------------------- CAD drawing primitives ------------------------ */

function line(parent: Element, a: Point, b: Point, stroke: string, extra: Record<string, string | number> = {}): void {
  el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke, "stroke-width": 1, ...extra }, parent);
}

/** Open (two-stroke) arrowhead at `tip`, pointing along the unit vector u. */
function arrowhead(parent: Element, tip: Point, u: Point, color: string): void {
  const L = 9, W = 3;
  for (const side of [1, -1]) {
    line(parent, tip, {
      x: tip.x - u.x * L + side * -u.y * W,
      y: tip.y - u.y * L + side * u.x * W,
    }, color);
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
  line(parent, p1, { x: q1.x + n.x * over, y: q1.y + n.y * over }, DIM);
  line(parent, p2, { x: q2.x + n.x * over, y: q2.y + n.y * over }, DIM);
  line(parent, q1, q2, DIM);
  arrowhead(parent, q1, { x: -u.x, y: -u.y }, DIM);
  arrowhead(parent, q2, u, DIM);
  const lift = 6;
  hersheyText(parent, label,
    (q1.x + q2.x) / 2 + n.x * Math.sign(offset) * lift,
    (q1.y + q2.y) / 2 + n.y * Math.sign(offset) * lift + 4,
    11, { anchor: "middle", color: DIM });
}

/**
 * A NARROW dimension, CAD style for spans too tight to hold arrowheads:
 * the dimension line extends beyond both measured points and the two
 * arrows sit outside, tips touching p1 and p2, pointing INWARD at each
 * other. Used for the padding between the boxes.
 */
function narrowDimension(parent: Element, p1: Point, p2: Point, label: string): void {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const u = { x: dx / len, y: dy / len };
  const ext = 13;
  line(parent,
    { x: p1.x - u.x * ext, y: p1.y - u.y * ext },
    { x: p2.x + u.x * ext, y: p2.y + u.y * ext }, DIM);
  arrowhead(parent, p1, u, DIM);                      // outside, pointing in
  arrowhead(parent, p2, { x: -u.x, y: -u.y }, DIM);   // outside, pointing in
  // Letter the value beside the span, on the −n side (to the right of a
  // downward measure) so it never crosses the dimension line.
  const n = { x: -u.y, y: u.x };
  hersheyText(parent, label,
    (p1.x + p2.x) / 2 - n.x * 12,
    (p1.y + p2.y) / 2 - n.y * 12 + 4,
    10, { color: DIM });
}

/** CAD center mark: a small cross plus dash-dot center lines through c. */
function centerMark(parent: Element, c: Point, reach: number): void {
  for (const [ux, uy] of [[1, 0], [0, 1]] as const) {
    line(parent, { x: c.x - ux * 5, y: c.y - uy * 5 }, { x: c.x + ux * 5, y: c.y + uy * 5 }, INK);
    line(parent, { x: c.x - ux * reach, y: c.y - uy * reach },
      { x: c.x + ux * reach, y: c.y + uy * reach }, FAINT, { "stroke-dasharray": DASH_CENTER });
  }
}

/* ------------------------------- the view -------------------------------- */

/**
 * Builds the persistent SVG scene graph once (interactive elements must not
 * be recreated mid-drag or pointer capture would break) and returns a render
 * function that redraws it from state plus the current drag, if any.
 */
export function createView(stage: SVGSVGElement): (state: AppState, active: ActiveDrag | null) => void {
  const gBoxes = el("g", {}, stage);
  const gGuides = el("g", { "pointer-events": "none" }, stage);
  const gAux = el("g", { "pointer-events": "none" }, stage);
  const gHandles = el("g", {}, stage);

  // The outer box — its (unpainted) interior is draggable as the "body".
  const outerPath = el("path", {
    fill: "none",
    "pointer-events": "fill",
    stroke: INK,
    "stroke-width": 1.6,
    cursor: "move",
  }, gBoxes);
  outerPath.dataset.role = "body";

  // The inner box — never interactive; its radius is always derived or,
  // when it is the reference, set through the handles that sit on it.
  const innerPath = el("path", {
    fill: "none",
    stroke: DIM,
    "stroke-width": 1.2,
  }, gBoxes);

  // Square resize handles on the outer box's corners.
  const cornerHandles = {} as Record<Corner, SVGRectElement>;
  for (const corner of CORNERS) {
    const cursor = corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize";
    const square = el("rect", {
      width: 9, height: 9,
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
      el("circle", { r: 16, fill: "transparent" }, group); // generous hit area
      el("circle", { r: 4.5, fill: "#000", stroke: INK, "stroke-width": 1.4 }, group);
      radiusHandles.push(group);
    }
  }

  /** Construction overlay for an in-progress radius drag. */
  function drawRadiusAux(state: AppState, corner: Corner, axis: EdgeAxis): void {
    const ρOut = outerRadius(state);
    const ρIn = innerRadius(state);
    const ρRef = state.radius;
    // Outer and inner arcs share this center — the demo's whole point.
    const c = arcCenter(state.rect, corner, ρOut);

    centerMark(gAux, c, ρOut + 26);

    const diag = Math.SQRT1_2;
    const circles: Array<[r: number, isRef: boolean]> = state.ref === "outer"
      ? [[ρOut, true], [ρIn, false]]
      : [[ρIn, true], [ρOut, false]];
    for (const [r, isRef] of circles) {
      if (r < 1) continue;
      el("circle", {
        cx: c.x, cy: c.y, r,
        fill: "none",
        stroke: isRef ? INK : FAINT,
        "stroke-width": 1,
        ...(isRef ? {} : { "stroke-dasharray": DASH_CONSTRUCT }),
      }, gAux);
      hersheyText(gAux, `R${Math.round(r)}`,
        c.x + r * diag + 5, c.y - r * diag - 4, 10,
        { color: isRef ? INK : DIM });
    }

    // Radius leader: center → the handle being dragged, arrow at the rim.
    const ref = refRect(state);
    const handle = arcStartPoint(ref, corner, axis, ρRef);
    if (ρRef > 1) {
      const u = { x: (handle.x - c.x) / ρRef, y: (handle.y - c.y) / ρRef };
      line(gAux, c, handle, INK);
      arrowhead(gAux, handle, u, INK);
    }

    // Distance from the reference box's corner to the arc start (= ρ),
    // dimensioned outside the box along the dragged edge.
    const onLeft = corner === "tl" || corner === "bl";
    const onTop = corner === "tl" || corner === "tr";
    const cornerPt = {
      x: onLeft ? ref.x : ref.x + ref.w,
      y: onTop ? ref.y : ref.y + ref.h,
    };
    let offset: number;
    if (axis === "h") {
      const leftToRight = handle.x >= cornerPt.x;
      offset = (leftToRight === onTop) ? -22 : 22;
    } else {
      const topToBottom = handle.y >= cornerPt.y;
      offset = (topToBottom === onLeft) ? 22 : -22;
    }
    dimension(gAux, cornerPt, handle, offset, String(Math.round(ρRef)));

    // The padding, measured between the two top edges mid-box — narrow
    // style with inward-pointing arrows since p is small.
    const midX = state.rect.x + state.rect.w / 2;
    narrowDimension(gAux,
      { x: midX, y: state.rect.y },
      { x: midX, y: state.rect.y + state.padding },
      `p=${state.padding}`);
  }

  /** Width/height dimensions while resizing. */
  function drawResizeAux(state: AppState): void {
    const { x, y, w, h } = state.rect;
    dimension(gAux, { x, y: y + h }, { x: x + w, y: y + h }, 30, String(w));  // below
    dimension(gAux, { x: x + w, y: y + h }, { x: x + w, y }, 30, String(h));  // right
  }

  /** Position readout while moving the whole box. */
  function drawBodyAux(state: AppState): void {
    const { x, y } = state.rect;
    centerMark(gAux, { x, y }, 18);
    hersheyText(gAux, `${x},${y}`, x - 8, y - 12, 11, { anchor: "end", color: DIM });
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

    // Idle guides: the shared center mark in each corner.
    gGuides.textContent = "";
    if (!active) {
      for (const corner of CORNERS) {
        if (ρOut < 2) break;
        const c = arcCenter(state.rect, corner, ρOut);
        for (const [ux, uy] of [[1, 0], [0, 1]] as const) {
          line(gGuides, { x: c.x - ux * 5, y: c.y - uy * 5 }, { x: c.x + ux * 5, y: c.y + uy * 5 }, DIM);
        }
      }
    }

    // Construction overlay during a drag.
    gAux.textContent = "";
    if (active?.role === "radius" && active.corner && active.axis) {
      drawRadiusAux(state, active.corner, active.axis);
    } else if (active?.role === "resize") {
      drawResizeAux(state);
    } else if (active?.role === "body") {
      drawBodyAux(state);
    }

    // Handles: resize squares on the outer box, radius handles on the
    // reference box.
    for (const corner of CORNERS) {
      const px = corner === "tl" || corner === "bl" ? state.rect.x : state.rect.x + state.rect.w;
      const py = corner === "tl" || corner === "tr" ? state.rect.y : state.rect.y + state.rect.h;
      cornerHandles[corner].setAttribute("x", String(px - 4.5));
      cornerHandles[corner].setAttribute("y", String(py - 4.5));
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
