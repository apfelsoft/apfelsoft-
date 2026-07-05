/**
 * Pure geometry for concentric rounded rectangles.
 *
 * Every function in this file is deterministic and side-effect free:
 * the same input always produces the same output. Nothing here touches
 * the DOM — this is only the math, and the math is only subtraction.
 *
 * Symbols used (each explained again where it appears):
 *   ρ (rho) — a corner radius, in pixels
 *   p       — a padding: how far the inner box sits from the outer one
 */

/** A point in screen pixels. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned rectangle: (x, y) is its top-left corner, w × h its size. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The four corners of a rectangle, named clockwise from top-left. */
export const CORNERS = ["tl", "tr", "br", "bl"] as const;
export type Corner = (typeof CORNERS)[number];

/** ρ per corner — kept per-corner so a path can mix round and sharp. */
export type Radii = Record<Corner, number>;

/** The same ρ on all four corners — the "all corners linked" case. */
export const uniformRadii = (ρ: number): Radii => ({ tl: ρ, tr: ρ, br: ρ, bl: ρ });

/**
 * How a corner turns its 90° — the CSS corner-shape family plus a catenary:
 *  - round / squircle / bevel / scoop / notch: the named CSS corner-shape
 *    keywords, all members of the superellipse(k) family with k = 1, 2, 0,
 *    −1, −∞ (exponent p = 2^|k|; negative k reflects the convex curve
 *    across the bevel diagonal).
 *  - superellipse: the same family with a user-chosen k.
 *  - catenary: a segment of y = cosh(x) between the points where its slope
 *    is ∓1 (a 90° total turn), rotated 45° so the end tangents meet both
 *    edges exactly — the "90° target angle". Not a superellipse.
 * Every shape starts and ends at the same arc start points ρ from the
 * corner, so the concentric subtraction rule is untouched.
 */
export type CornerShape =
  | "round" | "squircle" | "bevel" | "scoop" | "notch"
  | "catenary" | "superellipse";
export const SHAPES: readonly CornerShape[] =
  ["round", "squircle", "bevel", "scoop", "notch", "catenary", "superellipse"];

/** The k of the named CSS keywords within the superellipse family. */
export const NAMED_K: Partial<Record<CornerShape, number>> = {
  round: 1, squircle: 2, bevel: 0, scoop: -1, notch: -Infinity,
};

/** Samples per corner for the non-arc shapes. */
const CORNER_SAMPLES = 24;

/**
 * Unit corner curve in top-left-corner local coordinates (corner at (0,0),
 * +u toward the box interior along x, +v along y): runs from (0, 1) on the
 * vertical edge to (1, 0) on the horizontal edge, tangent to both.
 */
function superellipseUnit(k: number): Array<[number, number]> {
  if (k <= -6) return [[0, 1], [1, 1], [1, 0]]; // → notch
  if (k >= 6) return [[0, 1], [0, 0], [1, 0]];  // → sharp outward corner
  const e = 2 / Math.pow(2, Math.abs(k));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= CORNER_SAMPLES; i++) {
    const t = (i / CORNER_SAMPLES) * (Math.PI / 2);
    pts.push([1 - Math.cos(t) ** e, 1 - Math.sin(t) ** e]);
  }
  // Negative k: the concave twin — reflect across the bevel diagonal.
  return k < 0 ? pts.map(([u, v]): [number, number] => [1 - v, 1 - u]) : pts;
}

function unitCorner(shape: CornerShape, k: number): Array<[number, number]> {
  if (shape === "catenary") {
    // y = cosh(x) for x ∈ [−x₁, x₁] with sinh(x₁) = 1 turns exactly 90°.
    const x1 = Math.asinh(1);
    const raw: Array<[number, number]> = [];
    for (let i = 0; i <= CORNER_SAMPLES; i++) {
      const x = -x1 + (2 * x1 * i) / CORNER_SAMPLES;
      raw.push([x, Math.cosh(x)]);
    }
    // Rotate +45°: the end tangents (∓45°) become 0° and 90°.
    const c = Math.SQRT1_2;
    const rot = raw.map(([x, y]): [number, number] => [x * c - y * c, x * c + y * c]);
    // Map endpoint A (horizontal tangent) onto the horizontal edge point
    // (1, 0) and endpoint B (vertical tangent) onto (0, 1). The chord of
    // the rotated curve runs along (1, 1) with Δx = Δy, so one uniform
    // scale s plus an x-mirror does it — both preserve edge tangency, and
    // the convex side lands toward the corner like the other shapes.
    const [ax, ay] = rot[0];
    const [bx] = rot[rot.length - 1];
    const s = 1 / (bx - ax);
    const out = rot.map(([x, y]): [number, number] => [1 - (x - ax) * s, (y - ay) * s]);
    // Pin the ends exactly against float noise, then order (0,1) → (1,0).
    out[0] = [1, 0];
    out[out.length - 1] = [0, 1];
    return out.reverse();
  }
  return superellipseUnit(shape === "superellipse" ? k : NAMED_K[shape] ?? 1);
}

/** Unit corners are pure functions of (shape, k) — memoize the last few. */
const unitCache = new Map<string, Array<[number, number]>>();
function cachedUnitCorner(shape: CornerShape, k: number): Array<[number, number]> {
  const key = `${shape}:${shape === "superellipse" ? k : ""}`;
  let u = unitCache.get(key);
  if (!u) {
    u = unitCorner(shape, k);
    if (unitCache.size > 32) unitCache.clear();
    unitCache.set(key, u);
  }
  return u;
}

/**
 * The full closed outline of a box with uniform corner radius ρ and the
 * given corner shape, as a clockwise polyline in pixel space. Every scene
 * renderer that can't consume an SVG path (WebGPU) walks these points.
 */
export function outlineSamples(rect: Rect, ρ: number, shape: CornerShape, k = 2): Array<[number, number]> {
  const { x, y, w, h } = rect;
  const r = Math.max(0, Math.min(ρ, w / 2, h / 2));
  const unit = cachedUnitCorner(shape, k);
  const pts: Array<[number, number]> = [];
  // tl corner runs (0,1)→(1,0); the other corners reuse it mirrored, in
  // clockwise walking order starting from the top edge.
  const rev = [...unit].reverse();
  for (const [u, v] of unit) pts.push([x + u * r, y + v * r]);            // tl
  for (const [u, v] of rev) pts.push([x + w - u * r, y + v * r]);         // tr
  for (const [u, v] of unit) pts.push([x + w - u * r, y + h - v * r]);    // br
  for (const [u, v] of rev) pts.push([x + u * r, y + h - v * r]);         // bl
  return pts;
}

/**
 * SVG path for a box with uniform ρ and a corner shape: crisp A-arcs for
 * round, sampled polylines for the analytic shapes.
 */
export function boxPath(rect: Rect, ρ: number, shape: CornerShape, k = 2): string {
  if (shape === "round") return roundedRectPath(rect, uniformRadii(Math.max(0, Math.min(ρ, rect.w / 2, rect.h / 2))));
  const pts = outlineSamples(rect, ρ, shape, k);
  return `M ${pts.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(" L ")} Z`;
}

/**
 * Which of a corner's two edges something sits on:
 * "h" = its horizontal edge (top or bottom), "v" = its vertical edge (left or right).
 */
export type EdgeAxis = "h" | "v";

/**
 * The concentric rule — the whole theory, and it is pure subtraction:
 *
 *     ρ_inner = max(0, ρ_outer − p)
 *
 * An inner box inset by p keeps the SAME arc center as the outer one
 * exactly when its radius shrinks by that same p. Once the padding eats
 * the whole radius (p ≥ ρ) the corner is square — radii never go negative.
 * No trig, no π, no roots anywhere.
 */
export const concentricRadius = (ρ: number, p: number): number =>
  Math.max(0, ρ - p);

/**
 * Where a corner's arc center sits: exactly ρ inward from BOTH edges that
 * meet at that corner (i.e. at (ρ, ρ) on the corner's diagonal). Outer and
 * inner box share these four points — that is what "concentric" means.
 * (The center is ρ·√2 from the corner along the diagonal, but that root is
 * a consequence, never an input.)
 */
export function arcCenter(rect: Rect, corner: Corner, ρ: number): Point {
  const { x, y, w, h } = rect;
  switch (corner) {
    case "tl": return { x: x + ρ,     y: y + ρ     };
    case "tr": return { x: x + w - ρ, y: y + ρ     };
    case "br": return { x: x + w - ρ, y: y + h - ρ };
    case "bl": return { x: x + ρ,     y: y + h - ρ };
  }
}

/**
 * Where a corner's arc STARTS: on one of the corner's two edges, ρ away from
 * the corner point. These are the draggable handles — each corner has two,
 * and with all corners linked every one of the eight sets the same ρ.
 */
export function arcStartPoint(
  rect: Rect,
  corner: Corner,
  axis: EdgeAxis,
  ρ: number,
): Point {
  const { x, y, w, h } = rect;
  const onLeft = corner === "tl" || corner === "bl";
  const onTop = corner === "tl" || corner === "tr";
  if (axis === "h") {
    // On the top or bottom edge: ρ away from the corner, horizontally.
    return { x: onLeft ? x + ρ : x + w - ρ, y: onTop ? y : y + h };
  }
  // On the left or right edge: ρ away from the corner, vertically.
  return { x: onLeft ? x : x + w, y: onTop ? y + ρ : y + h - ρ };
}

/**
 * The inverse of arcStartPoint: given where the pointer is while dragging a
 * handle, how big is the requested radius? It is simply the pointer's
 * distance from the corner, measured along the edge the handle rides on.
 */
export function radiusFromPointer(
  rect: Rect,
  corner: Corner,
  axis: EdgeAxis,
  pointer: Point,
): number {
  const { x, y, w, h } = rect;
  const onLeft = corner === "tl" || corner === "bl";
  const onTop = corner === "tl" || corner === "tr";
  if (axis === "h") return onLeft ? pointer.x - x : x + w - pointer.x;
  return onTop ? pointer.y - y : y + h - pointer.y;
}

/**
 * The outline of a rounded rectangle as an SVG path: straight edge segments
 * joined by a quarter-circle arc of radius ρ at each corner, walked
 * clockwise from the top-left arc's end point. Corners with ρ = 0 emit no
 * arc and stay sharp.
 */
export function roundedRectPath(rect: Rect, radii: Radii): string {
  const { x, y, w, h } = rect;
  const { tl, tr, br, bl } = radii;
  const arc = (ρ: number, endX: number, endY: number) =>
    ρ > 0 ? `A ${ρ} ${ρ} 0 0 1 ${endX} ${endY}` : "";
  return [
    `M ${x + tl} ${y}`,
    `H ${x + w - tr}`,
    arc(tr, x + w, y + tr),
    `V ${y + h - br}`,
    arc(br, x + w - br, y + h),
    `H ${x + bl}`,
    arc(bl, x, y + h - bl),
    `V ${y + tl}`,
    arc(tl, x + tl, y),
    "Z",
  ].join(" ");
}
