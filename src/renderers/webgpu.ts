import { outlineSamples } from "../geometry";
import type { AppState } from "../state";
import { innerRadius, innerRect, outerRadius } from "../state";
import { INNER_W, OUTER_W, type SceneRenderer } from "./types";

/**
 * The WebGPU renderer. (The Slug library — Eric Lengyel's GPU vector/glyph
 * renderer — is proprietary C++ with no web distribution, so this is raw
 * WebGPU drawing the same line art: each box outline is tessellated into a
 * closed polyline and extruded into a constant-width triangle-strip ribbon.)
 */


/**
 * Extrude a closed polyline into a triangle-strip ribbon of width `w`,
 * emitting interleaved [x, y, r, g, b, a] vertices in pixel space.
 */
function ribbon(pts: Array<[number, number]>, w: number, rgba: [number, number, number, number]): number[] {
  const half = w / 2;
  const n = pts.length;
  const out: number[] = [];
  const push = (px: number, py: number) => out.push(px, py, ...rgba);
  for (let i = 0; i <= n; i++) {
    const [ax, ay] = pts[i % n];
    const [bx, by] = pts[(i + 1) % n];
    const [px, py] = pts[(i - 1 + n) % n];
    // Averaged normal of the two adjacent segments (cheap miter).
    let nx = (ay - py) + (by - ay);
    let ny = -((ax - px) + (bx - ax));
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    push(ax + nx * half, ay + ny * half);
    push(ax - nx * half, ay - ny * half);
  }
  return out;
}

const SHADER = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
};
@group(0) @binding(0) var<uniform> viewport: vec2f;

@vertex
fn vs(@location(0) xy: vec2f, @location(1) color: vec4f) -> VSOut {
  var out: VSOut;
  // pixel space -> clip space, y flipped
  out.pos = vec4f(xy.x / viewport.x * 2.0 - 1.0, 1.0 - xy.y / viewport.y * 2.0, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.color.rgb * in.color.a, in.color.a); // premultiplied
}
`;

export function createWebGpuRenderer(): SceneRenderer {
  let canvas: HTMLCanvasElement | null = null;
  // Hold the adapter for the renderer's lifetime: letting it be
  // garbage-collected invalidates the device in Chromium ("A valid
  // external Instance reference no longer exists").
  let adapter: GPUAdapter | null = null;
  let device: GPUDevice | null = null;
  let context: GPUCanvasContext | null = null;
  let pipeline: GPURenderPipeline | null = null;
  let bindGroup: GPUBindGroup | null = null;
  let viewportBuf: GPUBuffer | null = null;
  let vertexBuf: GPUBuffer | null = null;
  let vertexCap = 0;
  let format: GPUTextureFormat = "bgra8unorm";

  return {
    label: "WEBGPU",
    supported: typeof navigator !== "undefined" && !!navigator.gpu,

    async mount(host) {
      canvas = document.createElement("canvas");
      canvas.className = "scene-canvas";
      host.appendChild(canvas);
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("no WebGPU adapter");
      device = await adapter.requestDevice();
      device.addEventListener("uncapturederror", (e) => {
        console.warn("WebGPU:", (e as GPUUncapturedErrorEvent).error.message);
      });
      context = canvas.getContext("webgpu");
      if (!context) throw new Error("no WebGPU context");
      format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });

      const module = device.createShaderModule({ code: SHADER });
      pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module,
          buffers: [{
            arrayStride: 6 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x4" },
            ],
          }],
        },
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
      viewportBuf = device.createBuffer({ size: 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: viewportBuf } }],
      });
    },

    draw(s: AppState) {
      if (!canvas || !device || !context || !pipeline || !bindGroup || !viewportBuf) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      device.queue.writeBuffer(viewportBuf, 0, new Float32Array([w, h]));

      const ink: [number, number, number, number] = [0.95, 0.95, 0.95, 1];
      const dim: [number, number, number, number] = [0.56, 0.56, 0.56, 1];
      const outerVerts = ribbon(outlineSamples(s.rect, outerRadius(s), s.shape), OUTER_W,
        s.ref === "outer" ? ink : dim);
      const innerVerts = ribbon(outlineSamples(innerRect(s), innerRadius(s), s.shape), INNER_W,
        s.ref === "inner" ? ink : dim);
      const data = new Float32Array([...outerVerts, ...innerVerts]);
      if (!vertexBuf || vertexCap < data.byteLength) {
        vertexBuf?.destroy();
        vertexCap = data.byteLength;
        vertexBuf = device.createBuffer({ size: vertexCap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      device.queue.writeBuffer(vertexBuf, 0, data);

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
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuf);
      const outerCount = outerVerts.length / 6;
      const innerCount = innerVerts.length / 6;
      pass.draw(outerCount, 1, 0);
      pass.draw(innerCount, 1, outerCount);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },

    unmount() {
      canvas?.remove();
      canvas = null;
      // Keep the device around: re-mounting the tab reuses nothing else,
      // but destroying mid-flight work causes validation noise.
      context = null;
    },
  };
}
