/**
 * Pure geometry for concentric rounded rectangles.
 *
 * Every function in this file is deterministic and side-effect free:
 * the same input always produces the same output. Nothing here touches
 * the DOM — this is only the math.
 *
 * Greek symbols used throughout (each is explained again where it appears):
 *
 *   ρ (rho)   — a corner radius: how many pixels of a corner are rounded off
 *   δ (delta) — an inset: how far an inner rectangle sits from the outer one
 *   ℓ (ell)   — the length of a rectangle edge
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

/** ρ (rho) for every corner — each corner can have its own radius. */
export type Radii = Record<Corner, number>;

/**
 * Which of a corner's two edges something sits on:
 * "h" = its horizontal edge (top or bottom), "v" = its vertical edge (left or right).
 */
export type EdgeAxis = "h" | "v";

/* ------------------------------------------------------------------------ *
 *  The concentric rule — the heart of the demo
 * ------------------------------------------------------------------------ */

/**
 * The concentric rule:
 *
 *     ρ_inner = max(0, ρ − δ)
 *
 * An inner rectangle inset by δ keeps the SAME arc center as the outer
 * rectangle exactly when its corner radius shrinks by that same δ.
 * Once the inset eats the whole radius (δ ≥ ρ) the corner becomes square —
 * radii never go negative.
 */
export const concentricRadius = (ρ: number, δ: number): number =>
  Math.max(0, ρ - δ);

/**
 * Where a corner's arc center sits: exactly ρ inward from BOTH edges that
 * meet at that corner (i.e. on the corner's diagonal):
 *
 *     C = corner point + (±ρ, ±ρ)
 *
 * Every concentric ring draws its corner arc around these same four points —
 * that shared center is what "concentric" means here.
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
 * and both always sit the same ρ from the corner, so they move in sync.
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
 * (Clamping against the neighbors happens separately, in clampRadius.)
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

/* ------------------------------------------------------------------------ *
 *  Keeping radii legal: neighboring arcs must not overlap
 * ------------------------------------------------------------------------ */

/** The corner that shares a horizontal edge (top or bottom) with the given one. */
const HORIZONTAL_NEIGHBOR: Record<Corner, Corner> =
  { tl: "tr", tr: "tl", bl: "br", br: "bl" };

/** The corner that shares a vertical edge (left or right) with the given one. */
const VERTICAL_NEIGHBOR: Record<Corner, Corner> =
  { tl: "bl", bl: "tl", tr: "br", br: "tr" };

/**
 * Two corners on the same edge of length ℓ must satisfy
 *
 *     ρₐ + ρᵦ ≤ ℓ
 *
 * or their arcs would overlap in the middle of the edge. While dragging one
 * corner's handle, this clamps the requested ρ against BOTH of that corner's
 * neighbors (the one across its horizontal edge and the one across its
 * vertical edge), and against 0 from below.
 */
export function clampRadius(
  rect: Rect,
  radii: Radii,
  corner: Corner,
  requested: number,
): number {
  const roomAcrossTopOrBottom = rect.w - radii[HORIZONTAL_NEIGHBOR[corner]]; // ℓ − ρ_neighbor
  const roomAcrossLeftOrRight = rect.h - radii[VERTICAL_NEIGHBOR[corner]];   // ℓ − ρ_neighbor
  return Math.max(0, Math.min(requested, roomAcrossTopOrBottom, roomAcrossLeftOrRight));
}

/**
 * After the rectangle is resized, previously legal radii may now violate
 * ρₐ + ρᵦ ≤ ℓ. The CSS border-radius overlap rule repairs this by scaling
 * ALL four radii by one shared factor
 *
 *     f = min(1, ℓ ⁄ (ρₐ + ρᵦ))   taken over all four edges
 *
 * so their proportions are preserved and every edge becomes legal at once.
 */
export function fitRadiiToRect(rect: Rect, radii: Radii): Radii {
  const edges: Array<[sum: number, ℓ: number]> = [
    [radii.tl + radii.tr, rect.w], // top edge
    [radii.bl + radii.br, rect.w], // bottom edge
    [radii.tl + radii.bl, rect.h], // left edge
    [radii.tr + radii.br, rect.h], // right edge
  ];
  const f = Math.min(1, ...edges.map(([sum, ℓ]) => (sum > 0 ? ℓ / sum : 1)));
  if (f >= 1) return radii;
  return {
    tl: Math.floor(radii.tl * f),
    tr: Math.floor(radii.tr * f),
    br: Math.floor(radii.br * f),
    bl: Math.floor(radii.bl * f),
  };
}

/* ------------------------------------------------------------------------ *
 *  Building the concentric rings
 * ------------------------------------------------------------------------ */

/**
 * One concentric ring: the outer rectangle shrunk by the inset δ on every
 * side, with each corner radius reduced by the concentric rule ρ − δ.
 * Returns null when the inset is so large that no rectangle is left.
 */
export function ringAt(
  rect: Rect,
  radii: Radii,
  δ: number,
): { rect: Rect; radii: Radii } | null {
  const w = rect.w - 2 * δ;
  const h = rect.h - 2 * δ;
  if (w < 4 || h < 4) return null;
  return {
    rect: { x: rect.x + δ, y: rect.y + δ, w, h },
    radii: {
      tl: concentricRadius(radii.tl, δ),
      tr: concentricRadius(radii.tr, δ),
      br: concentricRadius(radii.br, δ),
      bl: concentricRadius(radii.bl, δ),
    },
  };
}

/* ------------------------------------------------------------------------ *
 *  Turning a rectangle + radii into an SVG path
 * ------------------------------------------------------------------------ */

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
