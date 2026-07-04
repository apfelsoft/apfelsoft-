# Concentric Corners

A deterministic, vanilla-TypeScript riff on [@steveruizok's corner-radius demo](https://x.com/steveruizok/status/2072651352908370013) in a line-on-black CAD style with single-stroke Hershey lettering. No runtime libraries — just TypeScript, SVG, and Vite as the build tool.

**Live:** https://apfelsoft.github.io/apfelsoft-/

## The demo

**Four renderer tabs — CSS, Canvas 2D, SVG, WebGPU — draw the same two boxes from the same live state object.** Only the boxes are per-renderer; interaction, construction geometry and lettering live in a shared SVG chrome above them, so the tabs have functional and visual parity by construction, and switching carries the current state with it (also encoded in the URL as `?mode=`). The CSS tab is the honest one: two plain divs where the derived box's `border-radius` is literally the `max()/calc()` expression — the browser's CSS engine does the math. The WebGPU tab is raw WebGPU (tessellated arcs extruded into triangle-strip ribbons); the Slug library is proprietary C++ with no web distribution, so it can't power a web demo. The tab disables itself where WebGPU is unavailable.

Two boxes, concentric corners. All four corners are **linked** — there is exactly one radius ρ, and it belongs to the **reference box** (toggle centered in the box swaps whether that's the outer or the inner one). The other box's radius is *derived* by the concentric rule, and the strip under the stage shows the **live CSS calculus** for that derived box.

- Drag any round handle to set ρ (they all move together). While dragging, the chart shows dotted construction circles for both radii around their shared center, dash-dot center lines, a radius leader, the ρ dimension along the edge, and the padding p as a narrow dimension with two inward-pointing arrows. All auxiliary construction is 0.5px hairline at 50% white.
- Drag on any edge or anywhere in the padding area to set the padding — it follows the pointer's depth orthogonal to the grabbed edge. Square corner handles resize; double-click a round handle for sharp corners.
- Mobile ergonomics: all drag targets auto-hide after ~4 idle seconds and reappear on any touch; touch devices get larger targets; a short haptic tick marks clamp limits; and where a gyroscope actually reports (iOS asks permission on the first tap) the scene and chrome layers shift by slightly different amounts for a subtle parallax depth — pure CSS transforms fed two numbers.

## Do you need trig? No — not even a square root

A corner arc's center sits ρ inward from *both* edges, i.e. at (ρ, ρ) from the corner point. Pad the shape by p and both edges move inward by p — so keeping the *same* center costs exactly p of radius. The whole theory is subtraction:

```
ρ_in  = max(0, ρ_out − p)    outer → inner
ρ_out = ρ_in + p             inner → outer
```

The only square root anywhere is decorative: the shared center lies on the 45° diagonal at distance ρ·√2 from the corner — a consequence of (ρ, ρ), never an input. The `max(0, …)` clamp is where roundness dies: once p ≥ ρ the corner goes sharp. That step is **lossy** — from a sharp inner corner you can only recover ρ_out ≤ p, not its exact value.

### The same calculus in CSS

Outer reference → inner, clamped at sharp:

```css
.outer {
  --r: 48px;
  --p: 24px;
  border-radius: var(--r);
  padding: var(--p);
}
.outer > .inner {
  border-radius: max(0px, calc(var(--r) - var(--p)));
}
```

Inner reference → outer (no clamp needed — adding p only grows the radius):

```css
.inner { --r: 8px; border-radius: var(--r); }
.outer {
  --p: 24px;
  padding: var(--p);
  border-radius: calc(var(--r) + var(--p));
}
```

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # typecheck + build to dist/
```

Pushes to `main` build and publish `dist/` to GitHub Pages via `.github/workflows/pages.yml`.

## Source layout

- `src/geometry.ts` — the pure math (the concentric rule, arc centers, arc start points, the path builder)
- `src/state.ts` — one state object: outer rect, the linked radius ρ, the padding p, and which box is the reference
- `src/render.ts` — builds the SVG scene once, re-renders from state; construction overlay and Hershey lettering
- `src/main.ts` — pointer interaction, the reference toggle, and the live CSS readout
- `src/hershey.ts` — generated single-stroke font data (`scripts/gen-hershey.mjs`)
