import type { Radii, Rect } from "./geometry";
import { fitRadiiToRect } from "./geometry";

/**
 * Everything the drawing depends on. Rendering is a pure function of this
 * object — there is no other source of truth and no randomness, which is
 * what makes the whole app deterministic.
 */
export interface AppState {
  /** The outer rectangle, in screen pixels. */
  rect: Rect;
  /** ρ per corner — where along each edge that corner's arc starts. */
  radii: Radii;
  /** How many concentric inner rectangles to draw. */
  rings: number;
  /** δ step in pixels between one ring and the next. */
  gap: number;
  /** Whether to draw arc centers, spokes, and radius labels. */
  guides: boolean;
}

/** The rectangle can never be dragged smaller than this, per side. */
export const MIN_SIZE = 48;

/** A centered starting rectangle sized to the viewport, with varied radii. */
export function initialState(viewportW: number, viewportH: number): AppState {
  const w = Math.round(Math.max(MIN_SIZE, Math.min(640, viewportW * 0.6)));
  const h = Math.round(Math.max(MIN_SIZE, Math.min(440, viewportH * 0.6)));
  const rect: Rect = {
    x: Math.round((viewportW - w) / 2),
    y: Math.round((viewportH - h) / 2),
    w,
    h,
  };
  // Deliberately different per-corner radii so the concentric behavior is
  // visible immediately; fitted in case the viewport is very small.
  const radii = fitRadiiToRect(rect, { tl: 72, tr: 24, br: 96, bl: 48 });
  return { rect, radii, rings: 2, gap: 18, guides: true };
}
