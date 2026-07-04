import type { AppState } from "../state";
import { BOX_DIM, BOX_INK, INNER_W, OUTER_W, type SceneRenderer } from "./types";

/**
 * The CSS renderer IS the calculus: two plain divs where the derived box's
 * border-radius is literally the max()/calc() expression from the explainer.
 * Only --r and --p are fed in; the browser's CSS engine does the math.
 */
export function createCssRenderer(): SceneRenderer {
  let outer: HTMLDivElement | null = null;
  let inner: HTMLDivElement | null = null;

  return {
    label: "CSS",
    supported: true,

    mount(host) {
      outer = document.createElement("div");
      inner = document.createElement("div");
      outer.className = "css-box-outer";
      inner.className = "css-box-inner";
      outer.appendChild(inner);
      host.appendChild(outer);
    },

    draw(s: AppState) {
      if (!outer || !inner) return;
      const { x, y, w, h } = s.rect;
      outer.style.left = `${x}px`;
      outer.style.top = `${y}px`;
      outer.style.width = `${w}px`;
      outer.style.height = `${h}px`;
      outer.style.setProperty("--r", `${s.radius}px`);
      outer.style.setProperty("--p", `${s.padding}px`);
      if (s.ref === "outer") {
        outer.style.borderRadius = "var(--r)";
        inner.style.borderRadius = "max(0px, calc(var(--r) - var(--p)))";
      } else {
        outer.style.borderRadius = "calc(var(--r) + var(--p))";
        inner.style.borderRadius = "var(--r)";
      }
      outer.style.borderColor = s.ref === "outer" ? BOX_INK : BOX_DIM;
      inner.style.borderColor = s.ref === "inner" ? BOX_INK : BOX_DIM;
      outer.style.borderWidth = `${OUTER_W}px`;
      inner.style.borderWidth = `${INNER_W}px`;
      // Corner shape: CSS has corner-shape for squircle (newer engines);
      // a catenary corner has no CSS equivalent, so the CSS tab shows it
      // round — the live strip says so.
      const cs = s.shape === "squircle" && CSS.supports("corner-shape", "squircle")
        ? "squircle" : "";
      outer.style.setProperty("corner-shape", cs);
      inner.style.setProperty("corner-shape", cs);
      // The chrome measures the padding to the inner box's OUTLINE; the
      // outer border sits inside the box, so back it out of the padding.
      outer.style.padding = `calc(var(--p) - ${OUTER_W}px)`;
    },

    unmount() {
      outer?.remove();
      outer = inner = null;
    },
  };
}
