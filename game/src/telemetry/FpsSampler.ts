/**
 * FpsSampler.ts — samples average FPS periodically (NOT per-frame).
 *
 * WHY SAMPLED: emitting a metric every frame would flood telemetry and blow up
 * cardinality/volume (violating the low-volume rule). Instead we read Phaser's
 * running FPS every ~2s and emit one averaged number. The scene calls `tick()` each
 * frame (cheap counter), and the sampler emits only when the interval elapses.
 */
export class FpsSampler {
  private accumMs = 0;
  private fpsSum = 0;
  private frames = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly onSample: (avgFps: number) => void,
  ) {}

  /** Call once per frame with the frame delta (ms) and current FPS reading. */
  tick(deltaMs: number, currentFps: number): void {
    this.accumMs += deltaMs;
    this.fpsSum += currentFps;
    this.frames += 1;
    if (this.accumMs >= this.intervalMs && this.frames > 0) {
      const avg = Math.round(this.fpsSum / this.frames);
      this.onSample(avg);
      this.accumMs = 0;
      this.fpsSum = 0;
      this.frames = 0;
    }
  }
}
