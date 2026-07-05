// Dev-only harness: confirms outlineSamples() stays within 5% of a pixel of
// the true corner curve at every tested radius, for every shape.
import type { CornerShape } from "./geometry";
import { cornerParam, outlineSamples } from "./geometry";

type UV = [number, number];

/** Perpendicular distance from p to segment ab (clamped to the segment). */
function segDist(p: UV, a: UV, b: UV): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const cases: Array<{ shape: CornerShape; k: number }> = [
  { shape: "round", k: 1 },
  { shape: "squircle", k: 2 },
  { shape: "superellipse", k: 3 },
  { shape: "superellipse", k: 1.5 },
  { shape: "catenary", k: 2 },
];
const radii = [24, 60, 120, 200, 280];

const verdict: Record<string, number> = {};
let worst = 0;
for (const { shape, k } of cases) {
  const P = cornerParam(shape, k);
  for (const r of radii) {
    // Big rect so r is never clamped; only the top-left corner is tested.
    const rect = { x: 40, y: 40, w: 6 * r, h: 6 * r };
    const poly = outlineSamples(rect, r, shape, k);
    // The tl corner occupies the first chunk of the outline; test the whole
    // polyline's segments against dense true tl-corner points anyway.
    let maxDev = 0;
    const N = 6000;
    for (let i = 0; i <= N; i++) {
      const [u, v] = P(i / N);
      const truePt: UV = [rect.x + u * r, rect.y + v * r];
      // nearest distance to any polyline segment
      let best = Infinity;
      for (let j = 0; j < poly.length - 1 && best > 0; j++) {
        const dd = segDist(truePt, poly[j], poly[j + 1]);
        if (dd < best) best = dd;
      }
      if (best > maxDev) maxDev = best;
    }
    const key = `${shape}${shape === "superellipse" ? "(" + k + ")" : ""}@${r}`;
    verdict[key] = Number(maxDev.toFixed(4));
    worst = Math.max(worst, maxDev);
  }
}
document.title = JSON.stringify({ worstPx: Number(worst.toFixed(4)), pass: worst < 0.05, verdict });
