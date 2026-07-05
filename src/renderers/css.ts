import type { CornerShape, Rect } from "../geometry";
import { outlineSamples } from "../geometry";
import type { AppState } from "../state";
import { BOX_DIM, BOX_INK, INNER_W, OUTER_W, type SceneRenderer } from "./types";

/**
 * The CSS renderer IS the calculus: two plain divs where the derived box's
 * border-radius is literally the max()/calc() expression from the explainer.
 * Only --r and --p are fed in; the browser's CSS engine does the math.
 *
 * Corner shapes map onto CSS directly: every superellipse-family shape is
 * a corner-shape value (round, squircle, bevel, scoop, notch,
 * superellipse(k)). The catenary is NOT a superellipse, so it is drawn
 * with CSS shape(): the whole box outline — outer offset contour plus
 * reversed inner offset contour — becomes an evenodd clip-path ring on a
 * background-filled div, i.e. the stroke itself, in pure CSS.
 */

/** clip-path: shape() support, probed once. */
const SHAPE_OK = typeof CSS !== "undefined" &&
  CSS.supports("clip-path", "shape(evenodd from 0px 0px, line to 10px 0px, line to 10px 10px, close)");

const grow = (r: Rect, e: number): Rect =>
  ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });

/** One contour as shape() commands (points are already adaptively sampled). */
function contour(pts: Array<[number, number]>, head: "from" | "move to"): string {
  const kept = pts.map(([px, py]) => `${px.toFixed(1)}px ${py.toFixed(1)}px`);
  return `${head} ${kept[0]}, ${kept.slice(1).map((p) => `line to ${p}`).join(", ")}, close`;
}

/**
 * The stroke of a box as a CSS shape() ring in element-local coordinates:
 * outline offset outward by half the stroke width plus the inward offset,
 * evenodd rule punching the middle out.
 */
function ringShape(w: number, h: number, ρ: number, shape: CornerShape, width: number): string {
  const e = width / 2;
  const local: Rect = { x: 0, y: 0, w, h };
  const outer = outlineSamples(grow(local, e), ρ + e, shape);
  const inner = outlineSamples(grow(local, -e), Math.max(0, ρ - e), shape);
  return `shape(evenodd ${contour(outer, "from")}, ${contour(inner, "move to")})`;
}

export function createCssRenderer(): SceneRenderer {
  let outer: HTMLDivElement | null = null;
  let inner: HTMLDivElement | null = null;
  let ring: HTMLDivElement | null = null;

  return {
    label: "CSS",
    supported: true,

    mount(host) {
      outer = document.createElement("div");
      inner = document.createElement("div");
      // clip-path on the outer div would clip the inner child away with
      // it, so the outer stroke gets its own absolutely-positioned ring
      // div; the inner box can clip itself (it has no children).
      ring = document.createElement("div");
      ring.className = "css-box-ring";
      outer.className = "css-box-outer";
      inner.className = "css-box-inner";
      outer.append(ring, inner);
      host.appendChild(outer);
    },

    draw(s: AppState) {
      if (!outer || !inner) return;
      const { x, y, w, h } = s.rect;
      const ρOut = s.ref === "outer" ? s.radius : s.radius + s.padding;
      const ρIn = s.ref === "inner" ? s.radius : Math.max(0, s.radius - s.padding);
      outer.style.left = `${x}px`;
      outer.style.top = `${y}px`;
      outer.style.width = `${w}px`;
      outer.style.height = `${h}px`;
      outer.style.setProperty("--r", `${s.radius}px`);
      outer.style.setProperty("--p", `${s.padding}px`);
      const outerColor = s.ref === "outer" ? BOX_INK : BOX_DIM;
      const innerColor = s.ref === "inner" ? BOX_INK : BOX_DIM;

      if (!ring) return;
      if (s.shape === "catenary" && SHAPE_OK) {
        // shape() ring mode: no borders — backgrounds clipped to the
        // outline rings ARE the strokes.
        outer.style.borderWidth = "0";
        inner.style.borderWidth = "0";
        outer.style.padding = "var(--p)";
        outer.style.borderRadius = "0";
        inner.style.borderRadius = "0";
        outer.style.background = "transparent";
        ring.style.display = "block";
        ring.style.background = outerColor;
        inner.style.background = innerColor;
        const wi = w - 2 * s.padding, hi = h - 2 * s.padding;
        ring.style.clipPath = ringShape(w, h, ρOut, "catenary", OUTER_W);
        inner.style.clipPath = ringShape(wi, hi, ρIn, "catenary", INNER_W);
        outer.style.removeProperty("corner-shape");
        inner.style.removeProperty("corner-shape");
        return;
      }

      // border-radius calculus mode
      ring.style.display = "none";
      outer.style.background = "transparent";
      inner.style.background = "transparent";
      outer.style.clipPath = "";
      inner.style.clipPath = "";
      if (s.ref === "outer") {
        outer.style.borderRadius = "var(--r)";
        inner.style.borderRadius = "max(0px, calc(var(--r) - var(--p)))";
      } else {
        outer.style.borderRadius = "calc(var(--r) + var(--p))";
        inner.style.borderRadius = "var(--r)";
      }
      outer.style.borderColor = outerColor;
      inner.style.borderColor = innerColor;
      outer.style.borderWidth = `${OUTER_W}px`;
      inner.style.borderWidth = `${INNER_W}px`;
      // Corner shape: every superellipse-family value is native CSS. The
      // catenary lands here only when shape() is unsupported — then the
      // closest superellipse stands in (the live strip says so).
      const cs = s.shape === "round" ? ""
        : s.shape === "superellipse" ? `superellipse(${s.k})`
        : s.shape === "catenary" ? "superellipse(1.171)"
        : s.shape;
      const supported = cs !== "" && CSS.supports("corner-shape", cs);
      outer.style.setProperty("corner-shape", supported ? cs : "");
      inner.style.setProperty("corner-shape", supported ? cs : "");
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
