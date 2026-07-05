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
 * How a corner turns its 90°:
 *  - round / squircle: the named CSS corner-shape keywords, members of the
 *    superellipse(k) family with k = 1 and 2 (exponent p = 2^k).
 *  - superellipse: the same convex family with a user-chosen k ≥ 1.
 *  - catenary: a segment of y = cosh(x) between the points where its slope
 *    is ∓1 (a 90° total turn), rotated 45° so the end tangents meet both
 *    edges exactly — the "90° target angle". Not a superellipse.
 * Every shape starts and ends at the same arc start points ρ from the
 * corner, so the concentric subtraction rule is untouched.
 */
export type CornerShape = "round" | "squircle" | "superellipse" | "catenary";
export const SHAPES: readonly CornerShape[] =
  ["round", "squircle", "superellipse", "catenary"];

/** Smallest superellipse exponent offered (k = 1 is the plain circle). */
export const K_MIN = 1;
export const K_MAX = 3;

/** The k of the named CSS keywords within the superellipse family. */
export const NAMED_K: Partial<Record<CornerShape, number>> = {
  round: 1, squircle: 2,
};

type UV = [number, number];

/**
 * A corner as a PARAMETRIC curve P(t), t ∈ [0, 1], in top-left-corner local
 * coordinates (corner at (0,0), +u toward the box interior along x, +v along
 * y): P(0) = (0, 1) on the vertical edge, P(1) = (1, 0) on the horizontal
 * edge, tangent to both. Returns null for the degenerate polyline shapes
 * (notch / sharp) that have no smooth curve to subdivide.
 */
export function cornerParam(shape: CornerShape, k: number): (t: number) => UV {
  if (shape === "catenary") {
    // y = cosh(x) for x ∈ [−x₁, x₁] with sinh(x₁) = 1 turns exactly 90°.
    // Rotate +45° so the ∓45° end tangents become 0° and 90°, then fit the
    // rotated chord (which runs along (1,1)) onto (0,1)→(1,0) with one
    // uniform scale plus an x-mirror — both preserve edge tangency.
    const x1 = Math.asinh(1);
    const c = Math.SQRT1_2;
    const rot = (u: number): UV => {
      const xx = -x1 + 2 * x1 * u, yy = Math.cosh(xx);
      return [xx * c - yy * c, xx * c + yy * c];
    };
    const [ax, ay] = rot(0);
    const [bx] = rot(1);
    const s = 1 / (bx - ax);
    return (t) => {
      if (t <= 0) return [0, 1];
      if (t >= 1) return [1, 0];
      const [X, Y] = rot(1 - t); // reverse param so t = 0 → (0, 1)
      return [1 - (X - ax) * s, (Y - ay) * s];
    };
  }
  // Convex superellipse quarter, exponent p = 2^k (k ≥ 1): k = 1 is the
  // plain circle, larger k squares the corner off toward the edges.
  const kk = shape === "superellipse" ? k : NAMED_K[shape] ?? 1;
  const e = 2 / Math.pow(2, kk);
  return (t) => {
    const a = t * (Math.PI / 2);
    return [1 - Math.cos(a) ** e, 1 - Math.sin(a) ** e];
  };
}

/** Perpendicular distance from p to the infinite line through a, b. */
function lineDist(p: UV, a: UV, b: UV): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}

/**
 * Chord-deviation budget as a fraction of one pixel. The subdivision test
 * uses the parameter-midpoint deviation, which slightly under-estimates the
 * true maximum where curvature concentrates (sharp superellipses), so the
 * budget is set at 3% to keep the actual worst-case error under the 5% target
 * with margin.
 */
const PIXEL_TOL = 0.03;

/**
 * Adaptive unit corner for a corner that will be scaled to `r` pixels:
 * recursively bisect the parameter until the chord's deviation from the true
 * curve is below PIXEL_TOL pixels everywhere — i.e. sub-5%-of-a-pixel error
 * against an unlimited-segment reference, with segment count driven by the
 * local curvature rather than a fixed budget.
 */
function adaptiveUnitCorner(shape: CornerShape, k: number, r: number): UV[] {
  const P = cornerParam(shape, k);
  const tol = PIXEL_TOL / Math.max(1, r); // pixel tolerance → unit-space
  const pts: UV[] = [P(0)];
  const rec = (t0: number, t1: number, p0: UV, p1: UV, depth: number): void => {
    const tm = 0.5 * (t0 + t1);
    const pm = P(tm);
    if (depth <= 0 || lineDist(pm, p0, p1) <= tol) {
      pts.push(p1);
      return;
    }
    rec(t0, tm, p0, pm, depth - 1);
    rec(tm, t1, pm, p1, depth - 1);
  };
  rec(0, 1, P(0), P(1), 11); // depth 11 → up to 2048 segments if ever needed
  return pts;
}

/**
 * Unit corners depend only on (shape, k, ⌈r⌉) — memoize by those. Radius is
 * quantized to whole pixels so a steady drag mostly hits the cache while the
 * tolerance still tracks the on-screen size.
 */
const cornerCache = new Map<string, UV[]>();
function cachedCorner(shape: CornerShape, k: number, r: number): UV[] {
  const rq = Math.max(1, Math.round(r));
  const key = `${shape}:${shape === "superellipse" ? k.toFixed(3) : ""}:${rq}`;
  let u = cornerCache.get(key);
  if (!u) {
    u = adaptiveUnitCorner(shape, k, rq);
    if (cornerCache.size > 96) cornerCache.clear();
    cornerCache.set(key, u);
  }
  return u;
}

/**
 * The full closed outline of a box with uniform corner radius ρ and the
 * given corner shape, as a clockwise polyline in pixel space. Corners are
 * sampled adaptively so the polyline is within 5% of a pixel of the true
 * curve at the current radius. Every renderer that can't consume an SVG
 * path (WebGPU) walks these points.
 */
export function outlineSamples(rect: Rect, ρ: number, shape: CornerShape, k = 2): UV[] {
  const { x, y, w, h } = rect;
  const r = Math.max(0, Math.min(ρ, w / 2, h / 2));
  const unit = cachedCorner(shape, k, r);
  const pts: UV[] = [];
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
