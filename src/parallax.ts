/**
 * Gyroscope parallax — ONLY when orientation data is actually available.
 *
 * On iOS Safari, DeviceOrientationEvent.requestPermission() exists and must
 * be called from a user gesture, so we ask once on the first touch; if the
 * user declines (or the device has no gyro) nothing happens and the page
 * stays perfectly static. The first reading becomes the neutral pose, and
 * JS only feeds two normalized numbers into CSS custom properties — the
 * actual displacement is pure CSS (see style.css).
 */
export function initParallax(target: HTMLElement): void {
  let baseBeta: number | null = null;
  let tx = 0, ty = 0;      // where the gyro wants us
  let cx = 0, cy = 0;      // where we are (eased)
  let running = false;

  function loop(): void {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    target.style.setProperty("--tilt-x", cx.toFixed(3));
    target.style.setProperty("--tilt-y", cy.toFixed(3));
    requestAnimationFrame(loop);
  }

  function onOrientation(e: DeviceOrientationEvent): void {
    if (e.gamma == null || e.beta == null) return; // no real gyro data
    if (baseBeta === null) baseBeta = e.beta;      // neutral = how it's held now
    tx = Math.max(-1, Math.min(1, e.gamma / 25));
    ty = Math.max(-1, Math.min(1, (e.beta - baseBeta) / 25));
    if (!running) { running = true; loop(); }
  }

  const DOE = window.DeviceOrientationEvent as unknown as
    { requestPermission?: () => Promise<string> } | undefined;
  if (!DOE) return;

  if (typeof DOE.requestPermission === "function") {
    // iOS: permission needs a user gesture — piggyback on the first touch.
    const ask = async (): Promise<void> => {
      try {
        if (await DOE.requestPermission!() === "granted") {
          window.addEventListener("deviceorientation", onOrientation);
        }
      } catch { /* declined or unavailable — stay static */ }
    };
    window.addEventListener("pointerdown", () => { void ask(); }, { once: true });
  } else {
    window.addEventListener("deviceorientation", onOrientation);
  }
}
