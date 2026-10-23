/**
 * cameraLerp.ts — frame-rate-independent camera-follow smoothing.
 *
 * Phaser applies the camera follow lerp once PER FRAME with no delta scaling, so a value
 * tuned at 60fps tracks tighter on a high-refresh display (e.g. Edge at 120/144Hz) and
 * laggier on a low-fps device. This converts a 60fps-tuned base lerp into the equivalent
 * lerp for the current frame's delta, so the camera reaches the same smoothing per unit of
 * REAL time on every browser/refresh rate.
 *
 * Formula: 1 - (1 - base)^(dtFrames), where dtFrames = deltaMs / (1000/60).
 * At exactly 60fps (deltaMs = 16.667) this returns `base` unchanged.
 */
export function frameRateIndependentLerp(base: number, deltaMs: number): number {
  // Clamp the delta so a long stall (tab refocus, GC pause) can't produce a near-1 lerp
  // that snaps the camera. 100ms = 6 frames' worth is plenty of catch-up.
  const dtFrames = Math.min(Math.max(deltaMs, 0), 100) / (1000 / 60);
  const lerp = 1 - Math.pow(1 - base, dtFrames);
  // Guard the output into a sane [0, 1] range.
  return Math.min(1, Math.max(0, lerp));
}
