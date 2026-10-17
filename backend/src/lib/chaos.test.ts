/**
 * chaos.test.ts — unit tests for the PURE chaos logic (no AWS, no network).
 * Covers the injection decision and window clamping; the DynamoDB read/write wrappers
 * are integration-level and verified live after deploy.
 */
import { describe, it, expect } from 'vitest';
import {
  injectionFor,
  clampSeconds,
  DEFAULT_CHAOS_SECONDS,
  MAX_CHAOS_SECONDS,
  CHAOS_ERROR_RATE,
  CHAOS_LATENCY_RATE,
  CHAOS_LATENCY_MS,
  type ChaosState,
} from './chaos';

const active: ChaosState = { active: true, until: 10_000 };
const inactive: ChaosState = { active: false, until: 0 };

describe('injectionFor', () => {
  it('injects nothing when chaos is inactive', () => {
    expect(injectionFor(inactive, 0, 0, 0)).toEqual({ delayMs: 0, fail: false });
  });

  it('injects nothing once the window has expired', () => {
    expect(injectionFor(active, 10_000, 0, 0)).toEqual({ delayMs: 0, fail: false });
    expect(injectionFor(active, 10_001, 0, 0)).toEqual({ delayMs: 0, fail: false });
  });

  it('forces an error when the error roll is under the error rate', () => {
    const r = injectionFor(active, 0, CHAOS_ERROR_RATE - 0.01, 0.99);
    expect(r.fail).toBe(true);
    expect(r.delayMs).toBe(0);
  });

  it('adds latency when past the error rate but under the latency rate', () => {
    const r = injectionFor(active, 0, 0.99, CHAOS_LATENCY_RATE - 0.01);
    expect(r.fail).toBe(false);
    expect(r.delayMs).toBe(CHAOS_LATENCY_MS);
  });

  it('passes through cleanly when both rolls are high', () => {
    expect(injectionFor(active, 0, 0.99, 0.99)).toEqual({ delayMs: 0, fail: false });
  });

  it('prefers an error over latency (never both)', () => {
    const r = injectionFor(active, 0, 0, 0); // both rolls lowest → error wins
    expect(r.fail).toBe(true);
    expect(r.delayMs).toBe(0);
  });
});

describe('clampSeconds', () => {
  it('defaults when not a finite number', () => {
    expect(clampSeconds(undefined)).toBe(DEFAULT_CHAOS_SECONDS);
    expect(clampSeconds('60')).toBe(DEFAULT_CHAOS_SECONDS);
    expect(clampSeconds(NaN)).toBe(DEFAULT_CHAOS_SECONDS);
  });
  it('caps at the maximum window', () => {
    expect(clampSeconds(99999)).toBe(MAX_CHAOS_SECONDS);
  });
  it('floors at 1 second', () => {
    expect(clampSeconds(0)).toBe(1);
    expect(clampSeconds(-5)).toBe(1);
  });
  it('passes through an in-range value (floored)', () => {
    expect(clampSeconds(45.9)).toBe(45);
  });
});
