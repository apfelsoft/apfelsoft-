# Concentric Corners

A deterministic, single-file SPA riff on [@steveruizok's corner-radius demo](https://x.com/steveruizok/status/2072651352908370013).

**Live:** https://apfelsoft.github.io/apfelsoft-/

## How it works

- Every corner of the rectangle has **two draggable handles**, one on each adjacent edge, marking where the corner's arc starts. Dragging either handle along its edge sets that corner's radius, so the pair always stays in sync.
- Each corner's **arc center** sits at `(radius, radius)` inside the corner and is shown as an orange dot.
- The nested rectangles are inset by a fixed gap per ring, and each ring's corner radius shrinks by exactly that inset (floored at 0). That keeps every ring's arc **concentric** — drawn about the same center point as the outer corner.
- Radii are clamped so adjacent arcs never overlap on a shared edge (`r_a + r_b ≤ edge length`); resizing re-clamps all four with the CSS `border-radius` overlap rule.
- The whole drawing is a pure function of a small state object — no randomness anywhere, hence *deterministic*.

Also: drag the body to move, drag the square corner handles to resize, double-click a radius handle to square that corner off, and tweak ring count/gap in the panel.

## Development

It's one `index.html` with no dependencies or build step — just open it in a browser. Pushes to this repo deploy it to GitHub Pages via `.github/workflows/pages.yml`.
