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
