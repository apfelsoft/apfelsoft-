import { boxPath } from "../geometry";
import type { AppState } from "../state";
import { innerRadius, innerRect, outerRadius } from "../state";
import { BOX_DIM, BOX_INK, INNER_W, OUTER_W, type SceneRenderer } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The SVG renderer: two stroked <path> elements. */
export function createSvgRenderer(): SceneRenderer {
  let svg: SVGSVGElement | null = null;
  let outer: SVGPathElement | null = null;
  let inner: SVGPathElement | null = null;

  return {
    label: "SVG",
    supported: true,

    mount(host) {
      svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "scene-svg");
      outer = document.createElementNS(SVG_NS, "path");
      inner = document.createElementNS(SVG_NS, "path");
      for (const [p, w] of [[outer, OUTER_W], [inner, INNER_W]] as const) {
        p.setAttribute("fill", "none");
        p.setAttribute("stroke-width", String(w));
      }
      svg.append(outer, inner);
      host.appendChild(svg);
    },

    draw(s: AppState) {
      if (!outer || !inner) return;
      outer.setAttribute("d", boxPath(s.rect, outerRadius(s), s.shape, s.k));
      inner.setAttribute("d", boxPath(innerRect(s), innerRadius(s), s.shape, s.k));
      outer.setAttribute("stroke", s.ref === "outer" ? BOX_INK : BOX_DIM);
      inner.setAttribute("stroke", s.ref === "inner" ? BOX_INK : BOX_DIM);
    },

    unmount() {
      svg?.remove();
      svg = outer = inner = null;
    },
  };
}
