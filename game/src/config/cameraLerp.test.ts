import { describe, expect, it } from 'vitest';
import { frameRateIndependentLerp } from './cameraLerp';

const FRAME_60 = 1000 / 60; // 16.667ms

describe('frameRateIndependentLerp', () => {
  it('returns the base lerp unchanged at exactly 60fps', () => {
    expect(frameRateIndependentLerp(0.15, FRAME_60)).toBeCloseTo(0.15, 10);
  });

  it('yields the SAME net smoothing over equal real time regardless of frame rate', () => {
    // Two 60fps frames vs one 30fps frame cover the same 33.3ms of real time, so the
    // remaining (1 - lerp) fraction must match — proving speed-independence.
    const base = 0.15;
    const twoAt60 =
      (1 - frameRateIndependentLerp(base, FRAME_60)) *
      (1 - frameRateIndependentLerp(base, FRAME_60));
    const oneAt30 = 1 - frameRateIndependentLerp(base, 2 * FRAME_60);
    expect(oneAt30).toBeCloseTo(twoAt60, 10);
  });

  it('tracks faster per-frame at low fps and slower per-frame at high fps', () => {
    const base = 0.15;
    const at144 = frameRateIndependentLerp(base, 1000 / 144);
    const at60 = frameRateIndependentLerp(base, FRAME_60);
    const at30 = frameRateIndependentLerp(base, 1000 / 30);
    expect(at144).toBeLessThan(at60); // high refresh → smaller per-frame step
    expect(at30).toBeGreaterThan(at60); // low refresh → larger per-frame step
  });

  it('clamps a long stall so the camera never snaps (output stays in [0,1])', () => {
    const v = frameRateIndependentLerp(0.15, 5000); // 5s stall
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
