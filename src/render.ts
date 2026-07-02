import type { Corner, EdgeAxis, Point } from "./geometry";
import {
  CORNERS,
  arcCenter,
  arcStartPoint,
  ringAt,
  roundedRectPath,
} from "./geometry";
import type { AppState } from "./state";
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
const INK = "#f2f2f2";        // primary geometry
const DIM = "#8f8f8f";        // dimensions, labels, secondary lines
const FAINT = "#565656";      // construction / auxiliary lines
const DASH_CONSTRUCT = "5 6"; // auxiliary circles and spokes
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

/** Advance width of a string in glyph units. */
function textAdvance(text: string): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? SPACE_ADV : (GLYPHS[ch]?.adv ?? SPACE_ADV);
  return w;
}

/**
 * Stroke a string in single-line Hershey lettering. (x, y) is the baseline
 * anchor; size is the capital-letter height in pixels. Glyph paths are
 * scaled via transform, so vector-effect keeps the stroke width optical.
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
  const u = { x: dx / len, y: dy / len };       // along the measurement
  // Sideways unit normal. Screen coordinates are y-down, so this is u
  // rotated CLOCKWISE: for a left→right line it points down the screen.
  const n = { x: -u.y, y: u.x };
  const q1 = { x: p1.x + n.x * offset, y: p1.y + n.y * offset };
  const q2 = { x: p2.x + n.x * offset, y: p2.y + n.y * offset };
  const over = Math.sign(offset) * 4;           // extension lines overshoot a touch
  line(parent, p1, { x: q1.x + n.x * over, y: q1.y + n.y * over }, DIM);
  line(parent, p2, { x: q2.x + n.x * over, y: q2.y + n.y * over }, DIM);
  line(parent, q1, q2, DIM);
  arrowhead(parent, q1, { x: -u.x, y: -u.y }, DIM);
  arrowhead(parent, q2, u, DIM);
  const lift = 6;                               // letter just off the line
  hersheyText(parent, label,
    (q1.x + q2.x) / 2 + n.x * Math.sign(offset) * lift,
    (q1.y + q2.y) / 2 + n.y * Math.sign(offset) * lift + 4,
    11, { anchor: "middle", color: DIM });
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
  const gRings = el("g", {}, stage);
  const gOuter = el("g", {}, stage);
  const gGuides = el("g", { "pointer-events": "none" }, stage);
  const gAux = el("g", { "pointer-events": "none" }, stage);
  const gHandles = el("g", {}, stage);

  // The outer rectangle — a bare stroke; pointer-events:fill makes its
  // (unpainted) interior draggable as the "body".
  const outerPath = el("path", {
    fill: "none",
    "pointer-events": "fill",
    stroke: INK,
    "stroke-width": 1.6,
    cursor: "move",
  }, gOuter);
  outerPath.dataset.role = "body";

  // Square resize handles, one per corner.
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

  // Round radius handles: two per corner, one on each adjacent edge, sitting
  // at the corner's arc start points.
  const radiusHandles: SVGGElement[] = [];
  for (const corner of CORNERS) {
    for (const axis of ["h", "v"] as const) {
      const group = el("g", { cursor: axis === "h" ? "ew-resize" : "ns-resize" }, gHandles);
      group.dataset.role = "radius";
      group.dataset.corner = corner;
      group.dataset.axis = axis;
      el("circle", { r: 14, fill: "transparent" }, group); // generous hit area
      el("circle", { r: 4.5, fill: "#000", stroke: INK, "stroke-width": 1.4 }, group);
    }
    // keep both handles addressable
  }
  gHandles.querySelectorAll<SVGGElement>('[data-role="radius"]').forEach((g) => radiusHandles.push(g));

  /** Construction overlay for an in-progress radius drag. */
  function drawRadiusAux(state: AppState, corner: Corner, axis: EdgeAxis): void {
    const { rect, radii } = state;
    const ρ = radii[corner];
    const c = arcCenter(rect, corner, ρ);

    centerMark(gAux, c, ρ + 26);

    // The full corner circle, plus each ring's concentric circle (ρ − i·δ),
    // every one lettered with its radius at the 45° point.
    const circles: Array<[r: number, main: boolean]> = [[ρ, true]];
    for (let i = 1; i <= state.rings; i++) {
      const r = ρ - i * state.gap;
      if (r > 0) circles.push([r, false]);
    }
    const diag = Math.SQRT1_2;
    for (const [r, main] of circles) {
      if (r < 1) continue;
      el("circle", {
        cx: c.x, cy: c.y, r,
        fill: "none",
        stroke: main ? INK : FAINT,
        "stroke-width": 1,
        ...(main ? {} : { "stroke-dasharray": DASH_CONSTRUCT }),
      }, gAux);
      hersheyText(gAux, `R${Math.round(r)}`,
        c.x + r * diag + 5, c.y - r * diag - 4, 10,
        { color: main ? INK : DIM });
    }

    // Radius leader: center → the handle being dragged, arrow at the rim.
    const handle = arcStartPoint(rect, corner, axis, ρ);
    const u = { x: (handle.x - c.x) / (ρ || 1), y: (handle.y - c.y) / (ρ || 1) };
    if (ρ > 1) {
      line(gAux, c, handle, INK);
      arrowhead(gAux, handle, u, INK);
    }

    // Distance from the corner point to the arc start, dimensioned along
    // the edge the handle rides on (its value is ρ by construction).
    const onLeft = corner === "tl" || corner === "bl";
    const onTop = corner === "tl" || corner === "tr";
    const cornerPt = {
      x: onLeft ? rect.x : rect.x + rect.w,
      y: onTop ? rect.y : rect.y + rect.h,
    };
    drawEdgeDimension(cornerPt, handle, axis, onTop, onLeft, ρ);

    // The analytic rule the rings obey.
    hersheyText(gAux, `ρ(i) = ρ - i*δ`,
      c.x, c.y + ρ + 40, 12, { anchor: "middle", color: DIM });
    hersheyText(gAux, `δ = ${state.gap}`,
      c.x, c.y + ρ + 58, 11, { anchor: "middle", color: FAINT });
  }

  function drawEdgeDimension(cornerPt: Point, handle: Point, axis: EdgeAxis, onTop: boolean, onLeft: boolean, ρ: number): void {
    // Choose the offset sign so the dimension sits OUTSIDE the rectangle.
    // dimension() offsets along the clockwise normal of corner→handle
    // (y-down screen coords: left→right ⇒ normal points down).
    let offset: number;
    if (axis === "h") {
      const leftToRight = handle.x >= cornerPt.x;
      offset = (leftToRight === onTop) ? -22 : 22;
    } else {
      const topToBottom = handle.y >= cornerPt.y;
      offset = (topToBottom === onLeft) ? 22 : -22;
    }
    dimension(gAux, cornerPt, handle, offset, String(Math.round(ρ)));
  }

  /** Width/height dimensions while resizing. */
  function drawResizeAux(state: AppState): void {
    const { x, y, w, h } = state.rect;
    dimension(gAux, { x, y: y + h }, { x: x + w, y: y + h }, 30, String(w));  // below
    dimension(gAux, { x: x + w, y: y + h }, { x: x + w, y }, 30, String(h));  // right
  }

  /** Position readout while moving the whole rectangle. */
  function drawBodyAux(state: AppState): void {
    const { x, y } = state.rect;
    centerMark(gAux, { x, y }, 18);
    hersheyText(gAux, `${x},${y}`, x - 8, y - 12, 11, { anchor: "end", color: DIM });
  }

  return function render(state: AppState, active: ActiveDrag | null): void {
    const { rect, radii } = state;

    outerPath.setAttribute("d", roundedRectPath(rect, radii));

    // Concentric rings — non-interactive, rebuilt each frame; brightness
    // steps down deterministically with the ring index.
    gRings.textContent = "";
    for (let i = 1; i <= state.rings; i++) {
      const ring = ringAt(rect, radii, i * state.gap);
      if (!ring) break;
      el("path", {
        d: roundedRectPath(ring.rect, ring.radii),
        fill: "none",
        stroke: INK,
        opacity: Math.max(0.3, 0.75 - (i - 1) * 0.15),
        "stroke-width": 1,
      }, gRings);
    }

    // Idle guides: center cross per corner, dashed spokes to the arc start
    // points, and the radius lettered beside the center.
    gGuides.textContent = "";
    if (state.guides) {
      for (const corner of CORNERS) {
        if (active?.role === "radius" && active.corner === corner) continue; // aux takes over
        const ρ = radii[corner];
        const c = arcCenter(rect, corner, ρ);
        for (const [ux, uy] of [[1, 0], [0, 1]] as const) {
          line(gGuides, { x: c.x - ux * 5, y: c.y - uy * 5 }, { x: c.x + ux * 5, y: c.y + uy * 5 }, DIM);
        }
        if (ρ > 2) {
          for (const axis of ["h", "v"] as const) {
            line(gGuides, c, arcStartPoint(rect, corner, axis, ρ), FAINT,
              { "stroke-dasharray": DASH_CONSTRUCT });
          }
        }
        hersheyText(gGuides, `R${Math.round(ρ)}`, c.x + 8, c.y - 6, 10, { color: FAINT });
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

    // Handles follow the state.
    for (const corner of CORNERS) {
      const px = corner === "tl" || corner === "bl" ? rect.x : rect.x + rect.w;
      const py = corner === "tl" || corner === "tr" ? rect.y : rect.y + rect.h;
      cornerHandles[corner].setAttribute("x", String(px - 4.5));
      cornerHandles[corner].setAttribute("y", String(py - 4.5));
    }
    for (const group of radiusHandles) {
      const corner = group.dataset.corner as Corner;
      const axis = group.dataset.axis as EdgeAxis;
      const p = arcStartPoint(rect, corner, axis, radii[corner]);
      group.setAttribute("transform", `translate(${p.x} ${p.y})`);
    }
  };
}
