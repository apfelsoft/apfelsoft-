import type { Rect } from "./geometry";
import { concentricRadius } from "./geometry";

/** Which box owns the reference radius; the other box's radius is derived. */
export type RefBox = "outer" | "inner";

/**
 * Everything the demo depends on. Rendering is a pure function of this
 * object — no other source of truth, no randomness: deterministic.
 * All four corners are linked: there is exactly ONE radius, belonging to
 * the reference box.
 */
export interface AppState {
  /** The outer box, in stage pixels. */
  rect: Rect;
  /** ρ — the radius of the REFERENCE box (all corners share it). */
  radius: number;
  /** p — the padding between the outer and inner box. */
  padding: number;
  /** Which box the radius belongs to. */
  ref: RefBox;
}

/** The outer box can never be resized smaller than this, per side. */
export const MIN_SIZE = 150;

/** A centered starting box sized to the stage. */
export function initialState(stageW: number, stageH: number): AppState {
  const w = Math.round(Math.max(MIN_SIZE, Math.min(560, stageW * 0.72)));
  const h = Math.round(Math.max(MIN_SIZE, Math.min(380, stageH * 0.7)));
  return {
    rect: {
      x: Math.round((stageW - w) / 2),
      y: Math.round((stageH - h) / 2),
      w,
      h,
    },
    radius: 48,
    padding: 24,
    ref: "outer",
  };
}

/** The inner box: the outer one inset by the padding p on every side. */
export function innerRect(s: AppState): Rect {
  const p = s.padding;
  return { x: s.rect.x + p, y: s.rect.y + p, w: s.rect.w - 2 * p, h: s.rect.h - 2 * p };
}

/** The rectangle the radius handles live on. */
export const refRect = (s: AppState): Rect =>
  s.ref === "outer" ? s.rect : innerRect(s);

/** ρ of the outer box — the reference itself, or inner + p. */
export const outerRadius = (s: AppState): number =>
  s.ref === "outer" ? s.radius : s.radius + s.padding;

/** ρ of the inner box — the reference itself, or max(0, outer − p). */
export const innerRadius = (s: AppState): number =>
  s.ref === "inner" ? s.radius : concentricRadius(s.radius, s.padding);

/**
 * With all corners linked, the only legality rule left is that two equal
 * radii must fit on the reference box's shortest edge: 2ρ ≤ min(w, h).
 * (The derived box is then automatically legal in both directions.)
 */
export function clampLinkedRadius(s: AppState, requested: number): number {
  const r = refRect(s);
  return Math.max(0, Math.min(requested, Math.floor(Math.min(r.w, r.h) / 2)));
}
