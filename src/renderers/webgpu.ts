import tgpu, { type TgpuBindGroup, type TgpuBuffer, type TgpuRoot, type UniformFlag, type StorageFlag } from "typegpu";
import * as d from "typegpu/data";
import type { CornerShape, Rect } from "../geometry";
import { outlineSamples } from "../geometry";
import type { AppState } from "../state";
import { innerRadius, innerRect, outerRadius } from "../state";
import { INNER_W, OUTER_W, type SceneRenderer } from "./types";

/**
 * The WebGPU renderer, powered by the SLUG ALGORITHM — Eric Lengyel's
 * GPU vector renderer, dedicated to the public domain in March 2026
 * (patent 10,373,352 disclaimed; reference shaders MIT on GitHub).
 *
 * Instead of tessellating triangles, each box stroke becomes a closed
 * RING of quadratic Bézier curves (outer offset outline clockwise, inner
 * offset outline counter-clockwise) uploaded once per frame; the fragment
 * shader computes the nonzero winding number at each pixel directly from
 * the curves — resolution-independent, no atlases, no tessellation. Full
 * Slug adds per-band curve lists as an acceleration structure; with a few
 * hundred curves per box we can afford the brute-force loop.
 *
 * TypeGPU (Software Mansion) does the typed plumbing: schemas, buffers
 * with automatic alignment, bind groups — unwrapped into the raw WebGPU
 * pipeline where the WGSL lives.
 */

/** One quadratic Bézier segment. vec2f fields → stride 24, no padding. */
const Curve = d.struct({ p0: d.vec2f, p1: d.vec2f, p2: d.vec2f });

/** Per-draw parameters (one per box). */
const DrawUniform = d.struct({
  color: d.vec4f,
  mins: d.vec2f,      // stroke bbox, pixel space
  maxs: d.vec2f,
  viewport: d.vec2f,
  range: d.vec2u,     // first curve index, curve count
});

const MAX_CURVES = 2048;

const layout = tgpu.bindGroupLayout({
  uni: { uniform: DrawUniform, visibility: ["vertex", "fragment"] },
  curves: { storage: (n: number) => d.arrayOf(Curve, n), access: "readonly", visibility: ["fragment"] },
});

export const SLUG_WGSL = /* wgsl */ `
struct DrawUniform {
  color: vec4f,
  mins: vec2f,
  maxs: vec2f,
  viewport: vec2f,
  range: vec2u,
}
struct Curve { p0: vec2f, p1: vec2f, p2: vec2f }

@group(0) @binding(0) var<uniform> uni: DrawUniform;
@group(0) @binding(1) var<storage, read> curves: array<Curve>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) px: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  // One quad over the stroke's bounding box.
  let t = vec2f(f32(i & 1u), f32(i >> 1u));
  let p = mix(uni.mins, uni.maxs, t);
  var out: VSOut;
  out.pos = vec4f(p.x / uni.viewport.x * 2.0 - 1.0, 1.0 - p.y / uni.viewport.y * 2.0, 0.0, 1.0);
  out.px = p;
  return out;
}

// Signed ray crossings of one quadratic curve, ray from the origin
// toward +x (curve given relative to the sample point). The heart of
// the Slug technique: roots of the curve's y(t), x tested per root.
//
// The roots use the numerically STABLE split (Citardauq): the naive
// (b ± √(b²−ac))/a cancels catastrophically in f32 when a ≈ 0 — which
// is every nearly-straight segment here — and the noise lands bogus
// roots inside [0,1), breaking winding parity for whole scanlines
// (the full-width stripe artifact). q = b + sign(b)·√disc keeps both
// roots stable, and degenerates gracefully to the exact line case at
// a = 0 with no special branch at all.
fn winding(q0: vec2f, q1: vec2f, q2: vec2f) -> i32 {
  let a = q0 - 2.0 * q1 + q2;
  let b = q0 - q1;
  let c = q0;
  let disc = b.y * b.y - a.y * c.y;
  if (disc <= 0.0) { return 0; }
  let q = b.y + sign(b.y) * sqrt(disc);
  let t1 = q / a.y;   // → ±inf for line segments: harmlessly rejected
  let t2 = c.y / q;   // → the stable (line) root
  var w = 0;
  if (t1 >= 0.0 && t1 < 1.0) {
    let x = (a.x * t1 - 2.0 * b.x) * t1 + c.x;
    let dy = a.y * t1 - b.y;
    if (x > 0.0) { w += select(-1, 1, dy > 0.0); }
  }
  if (t2 >= 0.0 && t2 < 1.0) {
    let x = (a.x * t2 - 2.0 * b.x) * t2 + c.x;
    let dy = a.y * t2 - b.y;
    if (x > 0.0) { w += select(-1, 1, dy > 0.0); }
  }
  return w;
}

fn covered(px: vec2f) -> f32 {
  var w = 0;
  for (var i = 0u; i < uni.range.y; i++) {
    let cu = curves[uni.range.x + i];
    w += winding(cu.p0 - px, cu.p1 - px, cu.p2 - px);
  }
  return select(0.0, 1.0, w != 0);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // 4× rotated-grid supersampling for the anti-aliasing (full Slug
  // computes analytic root-distance coverage instead).
  let e = 0.001; // dodge exact endpoint hits
  var cov = covered(in.px + vec2f( 0.125 + e,  0.375 + e));
  cov    += covered(in.px + vec2f( 0.375 + e, -0.125 + e));
  cov    += covered(in.px + vec2f(-0.125 + e, -0.375 + e));
  cov    += covered(in.px + vec2f(-0.375 + e,  0.125 + e));
  let a = uni.color.a * cov * 0.25;
  return vec4f(uni.color.rgb * a, a); // premultiplied
}
`;

/* --------------------- CPU side: strokes as Bézier rings ----------------- */

type Vec2 = [number, number];
export type CurveData = { p0: Vec2; p1: Vec2; p2: Vec2 };

const grow = (r: Rect, e: number): Rect =>
  ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });

/** A closed polyline (downsampled for the GPU) → line-quads. */
function polylineQuads(pts: Vec2[], reverse: boolean, out: CurveData[]): void {
  const p = reverse ? [...pts].reverse() : pts;
  const step = 3; // every 3rd sample is plenty at stroke scale
  const kept: Vec2[] = [];
  for (let i = 0; i < p.length; i += step) kept.push(p[i]);
  for (let i = 0; i < kept.length; i++) {
    const a = kept[i], b = kept[(i + 1) % kept.length];
    out.push({ p0: a, p1: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], p2: b });
  }
}

/**
 * The stroke of one box as a nonzero-winding Bézier ring: the outline
 * offset outward by half the width (clockwise) plus the outline offset
 * inward (counter-clockwise). Offsetting a shape by growing rect and ρ
 * together is exact for round corners and sub-pixel for the others.
 */
export function strokeRing(rect: Rect, ρ: number, shape: CornerShape, width: number): CurveData[] {
  const h = width / 2;
  const out: CurveData[] = [];
  polylineQuads(outlineSamples(grow(rect, h), ρ + h, shape), false, out);
  polylineQuads(outlineSamples(grow(rect, -h), Math.max(0, ρ - h), shape), true, out);
  return out;
}

/* ------------------------------ the renderer ----------------------------- */

export function createWebGpuRenderer(): SceneRenderer {
  let canvas: HTMLCanvasElement | null = null;
  let root: TgpuRoot | null = null;
  let context: GPUCanvasContext | null = null;
  let pipeline: GPURenderPipeline | null = null;
  let curveBuf: (TgpuBuffer<d.WgslArray<typeof Curve>> & StorageFlag) | null = null;
  let unis: Array<TgpuBuffer<typeof DrawUniform> & UniformFlag> = [];
  let groups: TgpuBindGroup[] = [];

  return {
    label: "WEBGPU · SLUG",
    supported: typeof navigator !== "undefined" && !!navigator.gpu,

    async mount(host) {
      canvas = document.createElement("canvas");
      canvas.className = "scene-canvas";
      host.appendChild(canvas);
      root = await tgpu.init();
      const device = root.device;
      context = canvas.getContext("webgpu");
      if (!context) throw new Error("no WebGPU context");
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });

      curveBuf = root.createBuffer(d.arrayOf(Curve, MAX_CURVES)).$usage("storage");
      unis = [0, 1].map(() => root!.createBuffer(DrawUniform).$usage("uniform"));
      groups = unis.map((uni) => root!.createBindGroup(layout, { uni, curves: curveBuf! }));

      const module = device.createShaderModule({ code: SLUG_WGSL });
      pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [root.unwrap(layout)] }),
        vertex: { module },
        fragment: {
          module,
          targets: [{
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          }],
        },
        primitive: { topology: "triangle-strip" },
      });
    },

    draw(s: AppState) {
      if (!canvas || !root || !context || !pipeline || !curveBuf) return;
      const device = root.device;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }

      const ink = d.vec4f(0.95, 0.95, 0.95, 1);
      const dim = d.vec4f(0.56, 0.56, 0.56, 1);
      const boxes: Array<{ rect: Rect; ρ: number; width: number; ref: boolean }> = [
        { rect: s.rect, ρ: outerRadius(s), width: OUTER_W, ref: s.ref === "outer" },
        { rect: innerRect(s), ρ: innerRadius(s), width: INNER_W, ref: s.ref === "inner" },
      ];

      const all: CurveData[] = [];
      const ranges: Array<[number, number]> = [];
      for (const b of boxes) {
        const start = all.length;
        all.push(...strokeRing(b.rect, b.ρ, s.shape, b.width));
        ranges.push([start, all.length - start]);
      }
      curveBuf.write(all.slice(0, MAX_CURVES).map((c) => ({
        p0: d.vec2f(...c.p0), p1: d.vec2f(...c.p1), p2: d.vec2f(...c.p2),
      })), );

      boxes.forEach((b, i) => {
        const m = b.width / 2 + 1;
        unis[i].write({
          color: b.ref ? ink : dim,
          mins: d.vec2f(b.rect.x - m, b.rect.y - m),
          maxs: d.vec2f(b.rect.x + b.rect.w + m, b.rect.y + b.rect.h + m),
          viewport: d.vec2f(w, h),
          range: d.vec2u(ranges[i][0], ranges[i][1]),
        });
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipeline);
      for (let i = 0; i < boxes.length; i++) {
        pass.setBindGroup(0, root.unwrap(groups[i]));
        pass.draw(4);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
    },

    unmount() {
      canvas?.remove();
      canvas = null;
      context = null;
      // The tgpu root (and its device) is recreated on the next mount.
      root?.destroy();
      root = null;
      pipeline = null;
      curveBuf = null;
      unis = [];
      groups = [];
    },
  };
}
