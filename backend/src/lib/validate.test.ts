/**
 * validate.test.ts — server-side validation tests (no AWS, no network).
 * Proves the backend re-validates events the same way the client does and rejects
 * malformed batches defensively.
 */
import { describe, it, expect } from 'vitest';
import { validateEvent, validateBatch, SCHEMA_VERSION, MAX_BATCH } from './validate';

const goodEvent = {
  schemaVersion: SCHEMA_VERSION,
  type: 'player_jump',
  sessionId: 'abcdefgh-1234',
  levelId: 'himal_rajya',
  ts: Date.now(),
  tMs: 10,
  attrs: { x: 1, y: 2 },
};

describe('validateEvent', () => {
  it('accepts a well-formed event', () => {
    expect(validateEvent(goodEvent).ok).toBe(true);
  });
  it('rejects unknown type', () => {
    expect(validateEvent({ ...goodEvent, type: 'nope' }).reason).toBe('unknown_type');
  });
  it('rejects bad schema version', () => {
    expect(validateEvent({ ...goodEvent, schemaVersion: 2 }).reason).toBe('bad_schema_version');
  });
  it('rejects short session id', () => {
    expect(validateEvent({ ...goodEvent, sessionId: 'x' }).reason).toBe('bad_session_id');
  });
  it('rejects non-finite timestamp', () => {
    expect(validateEvent({ ...goodEvent, tMs: Infinity }).reason).toBe('bad_timestamp');
  });
  it('rejects oversized event', () => {
    expect(validateEvent({ ...goodEvent, attrs: { blob: 'z'.repeat(5000) } }).reason).toBe('too_large');
  });
});

describe('validateBatch', () => {
  it('accepts a batch of good events', () => {
    const r = validateBatch({ events: [goodEvent, goodEvent] });
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(2);
    expect(r.dropped).toBe(0);
  });
  it('drops bad events but keeps good ones', () => {
    const r = validateBatch({ events: [goodEvent, { type: 'nope' }] });
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });
  it('rejects a non-array events field', () => {
    expect(validateBatch({ events: 'x' }).reason).toBe('events_not_array');
  });
  it('rejects an empty batch', () => {
    expect(validateBatch({ events: [] }).reason).toBe('empty_batch');
  });
  it('rejects an oversized batch', () => {
    const many = Array.from({ length: MAX_BATCH + 1 }, () => goodEvent);
    expect(validateBatch({ events: many }).reason).toBe('batch_too_large');
  });
});
