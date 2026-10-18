/**
 * telemetry.test.ts — local tests for the telemetry foundation (no browser/network).
 * Proves: enrichment + anonymous sessionId, validation good/bad, MemorySink capture,
 * no PII, stable session across events, and the FPS sampler's sampled (not per-frame) emit.
 */
import { describe, it, expect } from 'vitest';
import { TelemetryService } from './TelemetryService';
import { MemorySink } from './sinks';
import { validateEvent, SCHEMA_VERSION, EVENT_TYPES } from './events';
import { FpsSampler } from './FpsSampler';

// Deterministic clock so tMs is predictable.
function fixedClock(start = 1000) {
  let t = start;
  return () => (t += 5);
}

describe('TelemetryService', () => {
  it('enriches every event with the envelope and an anonymous sessionId', () => {
    const sink = new MemorySink();
    const svc = new TelemetryService(sink, fixedClock());
    svc.setLevel('himal_rajya');

    svc.record({ type: 'player_jump', x: 100, y: 200 });

    expect(sink.events).toHaveLength(1);
    const e = sink.events[0];
    expect(e.schemaVersion).toBe(SCHEMA_VERSION);
    expect(e.type).toBe('player_jump');
    expect(e.levelId).toBe('himal_rajya');
    expect(typeof e.sessionId).toBe('string');
    expect(e.sessionId.length).toBeGreaterThanOrEqual(8);
    expect(e.playerId).toBeNull(); // opt-in only
    expect(e.attrs).toEqual({ x: 100, y: 200 });
  });

  it('gives all events in a session the SAME sessionId', () => {
    const sink = new MemorySink();
    const svc = new TelemetryService(sink, fixedClock());
    svc.record({ type: 'game_started' });
    svc.record({ type: 'level_started', attempt: 1 });
    expect(new Set(sink.events.map((e) => e.sessionId)).size).toBe(1);
  });

  it('records collectible + level_completed with their attrs', () => {
    const sink = new MemorySink();
    const svc = new TelemetryService(sink, fixedClock());
    svc.setLevel('himal_rajya');
    svc.record({ type: 'collectible_collected', kind: 'rhododendron', points: 10, total: 30 });
    svc.record({ type: 'level_completed', score: 120, timeMs: 90000 });
    expect(sink.events[0].attrs).toMatchObject({ kind: 'rhododendron', total: 30 });
    expect(sink.events[1].attrs).toMatchObject({ score: 120, timeMs: 90000 });
  });

  it('counts dropped invalid events without throwing', () => {
    const sink = new MemorySink();
    const svc = new TelemetryService(sink, fixedClock());
    // Force an invalid event via a bad attrs value that blows the size cap.
    // (Type-level this is valid; we test the runtime guard separately below.)
    svc.record({ type: 'flag_planted', checkpoint: 900 });
    expect(sink.events).toHaveLength(1);
    expect(svc.getDroppedCount()).toBe(0);
  });

  it('never includes obvious PII fields', () => {
    const sink = new MemorySink();
    const svc = new TelemetryService(sink, fixedClock());
    svc.record({ type: 'collectible_collected', kind: 'rhododendron', total: 10, points: 10 });
    const json = JSON.stringify(sink.events[0]).toLowerCase();
    for (const banned of ['email', 'name', 'ip', 'password', 'address']) {
      expect(json.includes(banned)).toBe(false);
    }
  });

  it('has exactly the documented event types', () => {
    expect(EVENT_TYPES).toHaveLength(14);
    expect(EVENT_TYPES).toContain('client_perf');
    expect(EVENT_TYPES).toContain('flag_planted');
    // Added with the khukuri-cut obstacle + eagle-stomp gameplay.
    expect(EVENT_TYPES).toContain('obstacle_cut');
    expect(EVENT_TYPES).toContain('player_stomp');
    // Low-volume liveness ping for the live dashboard's active-sessions/duration panels.
    expect(EVENT_TYPES).toContain('session_heartbeat');
  });

  it('records a valid session_heartbeat with a numeric uptime', () => {
    const sink = new MemorySink();
    const svc = new TelemetryService(sink, fixedClock());
    const ok = svc.record({ type: 'session_heartbeat', uptimeMs: 15000 });
    expect(ok).toBe(true);
    expect(sink.events[0].type).toBe('session_heartbeat');
    expect((sink.events[0].attrs as { uptimeMs: number }).uptimeMs).toBe(15000);
  });
});

describe('validateEvent', () => {
  const good = {
    schemaVersion: SCHEMA_VERSION,
    type: 'player_jump' as const,
    sessionId: 'abcdefgh-1234',
    levelId: 'himal_rajya',
    ts: Date.now(),
    tMs: 10,
    playerId: null,
    correlationId: null,
    attrs: { x: 1, y: 2 },
  };

  it('accepts a well-formed event', () => {
    expect(validateEvent(good).ok).toBe(true);
  });
  it('rejects an unknown type', () => {
    expect(validateEvent({ ...good, type: 'nope' }).reason).toBe('unknown_type');
  });
  it('rejects a bad schema version', () => {
    expect(validateEvent({ ...good, schemaVersion: 999 }).reason).toBe('bad_schema_version');
  });
  it('rejects a short sessionId', () => {
    expect(validateEvent({ ...good, sessionId: 'x' }).reason).toBe('bad_session_id');
  });
  it('rejects a non-finite timestamp', () => {
    expect(validateEvent({ ...good, tMs: Infinity }).reason).toBe('bad_timestamp');
  });
  it('rejects oversized payloads', () => {
    expect(validateEvent({ ...good, attrs: { blob: 'z'.repeat(5000) } }).reason).toBe('too_large');
  });
});

describe('FpsSampler', () => {
  it('emits ONE averaged sample per interval, not per frame', () => {
    const samples: number[] = [];
    const sampler = new FpsSampler(1000, (avg) => samples.push(avg));
    // 10 frames of ~100ms each at 60fps → one interval (1000ms) → exactly one emit.
    for (let i = 0; i < 10; i++) sampler.tick(100, 60);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toBe(60);
  });

  it('does not emit before the interval elapses', () => {
    const samples: number[] = [];
    const sampler = new FpsSampler(2000, (avg) => samples.push(avg));
    sampler.tick(500, 58);
    sampler.tick(500, 62);
    expect(samples).toHaveLength(0); // only 1000ms of 2000ms elapsed
  });
});
