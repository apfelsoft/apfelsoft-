# Concentric Corners

A deterministic, vanilla-TypeScript riff on [@steveruizok's corner-radius demo](https://x.com/steveruizok/status/2072651352908370013). No runtime libraries — just TypeScript, SVG, and Vite as the build tool.

**Live:** https://apfelsoft.github.io/apfelsoft-/

## The math

All formulas live in [`src/geometry.ts`](src/geometry.ts) as small pure functions, written with the Greek symbols they're usually stated in (each explained in plain English at its declaration):

| Symbol | Meaning |
| --- | --- |
| ρ (rho) | a corner radius — how many pixels of a corner are rounded off |
| δ (delta) | an inset — how far an inner rectangle sits from the outer one |
| ℓ (ell) | the length of a rectangle edge |

- **Concentric rule** — `concentricRadius`: ρ_inner = max(0, ρ − δ). An inner rectangle inset by δ keeps the *same arc center* as the outer one when its radius shrinks by exactly δ; once δ ≥ ρ the corner goes square.
- **Arc center** — `arcCenter`: C = corner + (±ρ, ±ρ). All rings share these four points — that's what "concentric" means here.
- **Arc start points** — `arcStartPoint`: the draggable handles, sitting on each edge ρ away from the corner. `radiusFromPointer` is its inverse: pointer distance from the corner along the edge ⇒ requested ρ.
- **No-overlap clamp** — `clampRadius`: two corners on one edge must satisfy ρₐ + ρᵦ ≤ ℓ.
- **Resize repair** — `fitRadiiToRect`: the CSS border-radius rule, scaling all radii by f = min(1, ℓ ⁄ (ρₐ + ρᵦ)) over the four edges.

Rendering is a pure function of one state object (`src/state.ts`) — no randomness anywhere, hence *deterministic*.

## Do you need trig? No — not even a square root

A corner arc's center sits ρ inward from *both* edges, i.e. at (ρ, ρ) from the corner point. Inset the shape by a padding p and both edges move inward by p — so keeping the *same* center costs exactly p of radius. The whole theory is subtraction:

```
ρ_in  = max(0, ρ_out − p)    outer → inner
ρ_out = ρ_in + p             inner → outer
```

The only square root anywhere is decorative: the shared center lies on the 45° diagonal at distance ρ·√2 from the corner — a consequence of (ρ, ρ), never an input. The `max(0, …)` clamp is where roundness dies: once p ≥ ρ the corner goes sharp. Note that step is **lossy** — from a sharp inner corner you can only recover ρ_out ≤ p, not its exact value.

### The same calculus in CSS

Outer reference → inner, clamped at sharp:

```css
.card {
  --r: 24px;
  --p: 16px;
  border-radius: var(--r);
  padding: var(--p);
}
.card > .inner {
  border-radius: max(0px, calc(var(--r) - var(--p)));
}
```

Inner reference → outer (no clamp needed — adding p only grows the radius):

```css
.chip      { --ri: 8px; --p: 12px; }
.chip-wrap {
  padding: var(--p);
  border-radius: calc(var(--ri) + var(--p));
}
```

The i-th nesting level in one line, sharp corners included:

```css
border-radius: max(0px, calc(var(--r) - var(--i) * var(--p)));
```

## Using it

Drag the round handles along the edges to set each corner's ρ (each corner's two handles stay in sync), drag the body to move, drag the square corner handles to resize, double-click a round handle to square that corner, and tweak ring count / gap δ in the panel.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # typecheck + build to dist/
```

Pushes to this repo build and publish `dist/` to GitHub Pages via `.github/workflows/pages.yml`.

## Source layout

- `src/geometry.ts` — the pure math (everything above)
- `src/state.ts` — the single state object all rendering derives from
- `src/render.ts` — builds the SVG scene once, re-renders it from state
- `src/main.ts` — pointer interaction and control-panel wiring
