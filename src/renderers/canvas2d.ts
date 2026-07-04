import { roundedRectPath, uniformRadii } from "../geometry";
import type { AppState } from "../state";
import { innerRadius, innerRect, outerRadius } from "../state";
import { BOX_DIM, BOX_INK, INNER_W, OUTER_W, type SceneRenderer } from "./types";

/**
 * The Canvas 2D renderer. Path2D accepts SVG path data, so it strokes the
 * exact same rounded-rect paths the SVG renderer uses — parity for free.
 */
export function createCanvas2dRenderer(): SceneRenderer {
  let canvas: HTMLCanvasElement | null = null;

  return {
    label: "CANVAS 2D",
    supported: true,

    mount(host) {
      canvas = document.createElement("canvas");
      canvas.className = "scene-canvas";
      host.appendChild(canvas);
    },

    draw(s: AppState) {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = OUTER_W;
      ctx.strokeStyle = s.ref === "outer" ? BOX_INK : BOX_DIM;
      ctx.stroke(new Path2D(roundedRectPath(s.rect, uniformRadii(outerRadius(s)))));
      ctx.lineWidth = INNER_W;
      ctx.strokeStyle = s.ref === "inner" ? BOX_INK : BOX_DIM;
      ctx.stroke(new Path2D(roundedRectPath(innerRect(s), uniformRadii(innerRadius(s)))));
    },

    unmount() {
      canvas?.remove();
      canvas = null;
    },
  };
}
