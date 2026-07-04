import type { AppState } from "../state";

/**
 * A scene renderer draws exactly the two boxes — nothing else. All
 * interaction, construction geometry and lettering live in the shared SVG
 * chrome above it, so every renderer has functional and visual parity by
 * construction, and they all read the same live state object.
 */
export interface SceneRenderer {
  /** Human-readable tab label. */
  readonly label: string;
  /** False when the platform can't run this renderer (e.g. no WebGPU). */
  readonly supported: boolean;
  mount(host: HTMLElement): void | Promise<void>;
  draw(state: AppState): void;
  unmount(): void;
}

/** Shared inks so all four backends match the chrome exactly. */
export const BOX_INK = "#f2f2f2";
export const BOX_DIM = "#8f8f8f";
export const OUTER_W = 1.6;
export const INNER_W = 1.2;
