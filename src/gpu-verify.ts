// Dev-only: offscreen render + readback of the Slug ring pipeline.
// Sets document.title to a JSON verdict for the test driver.
import type { CornerShape } from "./geometry";
import { SLUG_WGSL, strokeRing } from "./renderers/webgpu";

const W = 400, H = 300;
const RECT = { x: 50, y: 50, w: 300, h: 200 };
const RHO = 60;

async function run(): Promise<void> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("no adapter");
  const device = await adapter.requestDevice();
  const tex = device.createTexture({
    size: [W, H], format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const module = device.createShaderModule({ code: SLUG_WGSL });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module },
    fragment: { module, targets: [{ format: "rgba8unorm" }] },
    primitive: { topology: "triangle-strip" },
  });

  const verdict: Record<string, unknown> = {};
  for (const shape of ["round", "squircle", "catenary"] as CornerShape[]) {
    const curves = strokeRing(RECT, RHO, shape, 3); // fat stroke for sampling
    const cdata = new Float32Array(curves.length * 6);
    curves.forEach((c, i) => cdata.set([...c.p0, ...c.p1, ...c.p2], i * 6));
    const cbuf = device.createBuffer({ size: cdata.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(cbuf, 0, cdata);
    const u = new ArrayBuffer(48);
    const f = new Float32Array(u), ui = new Uint32Array(u);
    f.set([1, 1, 1, 1, 0, 0, W, H, W, H], 0); // color, mins, maxs, viewport
    ui.set([0, curves.length], 10);            // range
    const ubuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ubuf, 0, u);
    const bg = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ubuf } },
        { binding: 1, resource: { buffer: cbuf } },
      ],
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: tex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.draw(4);
    pass.end();
    const bpr = Math.ceil((W * 4) / 256) * 256;
    const rb = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: tex }, { buffer: rb, bytesPerRow: bpr }, [W, H]);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const px = new Uint8Array(rb.getMappedRange());
    const litAt = (x: number, y: number): boolean => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (px[(y + dy) * bpr + (x + dx) * 4] > 60) return true;
      }
      return false;
    };
    let total = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[y * bpr + x * 4] > 60) total++;
    // Stripe detector: interior scanlines (clear of the top/bottom stroke)
    // must never be mostly lit — that is the broken-winding signature.
    let stripes = 0;
    for (let y = 58; y < 242; y++) {
      let lit = 0;
      for (let x = 55; x < 345; x++) if (px[y * bpr + x * 4] > 60) lit++;
      if (lit > 145) stripes++;
    }
    verdict[shape] = {
      topEdge: litAt(200, 50),
      leftEdge: litAt(50, 150),
      cornerArc: litAt(68, 68),          // ~45° point of a 60px round corner
      centerDark: !litAt(200, 150),
      cornerPointDark: !litAt(52, 52),   // the sharp corner point itself must be cut
      stripes,                            // broken-winding rows — must be 0
      total,
    };
    rb.unmap();
  }
  document.title = JSON.stringify(verdict);
}
run().catch((e) => { document.title = "ERR " + (e as Error).message; });
