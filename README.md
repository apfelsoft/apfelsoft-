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
