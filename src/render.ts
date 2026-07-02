import type { Corner, EdgeAxis } from "./geometry";
import {
  CORNERS,
  arcCenter,
  arcStartPoint,
  ringAt,
  roundedRectPath,
} from "./geometry";
import type { AppState } from "./state";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Create an SVG element with attributes, optionally appended to a parent. */
function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

/** Deterministic stroke color for ring i — hue steps with the ring index. */
const ringColor = (i: number): string =>
  `hsl(${(214 + i * 16) % 360} 90% ${Math.max(46, 66 - i * 1.5)}%)`;

/**
 * Builds the persistent SVG scene graph once (interactive elements must not
 * be recreated mid-drag or pointer capture would break) and returns a render
 * function that updates it from state. Interaction is wired via data-*
 * attributes on the handles, so this module stays free of drag logic.
 */
export function createView(stage: SVGSVGElement): (state: AppState) => void {
  const gRings = el("g", {}, stage);
  const gOuter = el("g", {}, stage);
  const gGuides = el("g", { "pointer-events": "none" }, stage);
  const gHandles = el("g", {}, stage);

  // The outer rectangle — draggable as a whole ("body").
  const outerPath = el("path", {
    fill: "rgba(91,157,255,0.07)",
    stroke: "#5b9dff",
    "stroke-width": 2,
    cursor: "move",
  }, gOuter);
  outerPath.dataset.role = "body";

  // Square resize handles, one per corner.
  const cornerHandles = {} as Record<Corner, SVGRectElement>;
  for (const corner of CORNERS) {
    const cursor = corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize";
    const square = el("rect", {
      width: 10, height: 10, rx: 2,
      fill: "#0e1014", stroke: "#8b93a5", "stroke-width": 1.5, cursor,
    }, gHandles);
    square.dataset.role = "resize";
    square.dataset.corner = corner;
    cornerHandles[corner] = square;
  }

  // Round radius handles: two per corner, one on each adjacent edge, sitting
  // at the corner's arc start points.
  const radiusHandles: SVGGElement[] = [];
  for (const corner of CORNERS) {
    for (const axis of ["h", "v"] as const) {
      const group = el("g", { cursor: axis === "h" ? "ew-resize" : "ns-resize" }, gHandles);
      group.dataset.role = "radius";
      group.dataset.corner = corner;
      group.dataset.axis = axis;
      el("circle", { r: 14, fill: "transparent" }, group); // generous hit area
      el("circle", { r: 6, fill: "#fff", stroke: "#5b9dff", "stroke-width": 2.5 }, group);
      radiusHandles.push(group);
    }
  }

  return function render(state: AppState): void {
    const { rect, radii } = state;

    outerPath.setAttribute("d", roundedRectPath(rect, radii));

    // Concentric rings — non-interactive, so rebuilding them is safe.
    gRings.textContent = "";
    for (let i = 1; i <= state.rings; i++) {
      const ring = ringAt(rect, radii, i * state.gap);
      if (!ring) break;
      el("path", {
        d: roundedRectPath(ring.rect, ring.radii),
        fill: "none",
        stroke: ringColor(i),
        "stroke-width": 2,
        opacity: 0.9,
      }, gRings);
    }

    // Guides: each corner's arc center, dashed spokes out to the two arc
    // start points, a faint full circle of radius ρ, and the ρ value.
    gGuides.textContent = "";
    if (state.guides) {
      for (const corner of CORNERS) {
        const ρ = radii[corner];
        const center = arcCenter(rect, corner, ρ);
        if (ρ > 2) {
          for (const axis of ["h", "v"] as const) {
            const start = arcStartPoint(rect, corner, axis, ρ);
            el("line", {
              x1: center.x, y1: center.y, x2: start.x, y2: start.y,
              stroke: "rgba(255,255,255,0.28)", "stroke-dasharray": "3 4",
            }, gGuides);
          }
          el("circle", {
            cx: center.x, cy: center.y, r: ρ,
            fill: "none", stroke: "rgba(255,255,255,0.10)", "stroke-dasharray": "2 5",
          }, gGuides);
        }
        el("circle", { cx: center.x, cy: center.y, r: 2.5, fill: "#ffb84d" }, gGuides);
        const label = el("text", {
          x: center.x, y: center.y - 8,
          fill: "rgba(255,255,255,0.55)",
          "font-size": 11, "text-anchor": "middle",
          "font-family": "ui-monospace, monospace",
        }, gGuides);
        label.textContent = String(Math.round(ρ));
      }
    }

    // Handles follow the state.
    for (const corner of CORNERS) {
      const px = corner === "tl" || corner === "bl" ? rect.x : rect.x + rect.w;
      const py = corner === "tl" || corner === "tr" ? rect.y : rect.y + rect.h;
      cornerHandles[corner].setAttribute("x", String(px - 5));
      cornerHandles[corner].setAttribute("y", String(py - 5));
    }
    for (const group of radiusHandles) {
      const corner = group.dataset.corner as Corner;
      const axis = group.dataset.axis as EdgeAxis;
      const p = arcStartPoint(rect, corner, axis, radii[corner]);
      group.setAttribute("transform", `translate(${p.x} ${p.y})`);
    }
  };
}
