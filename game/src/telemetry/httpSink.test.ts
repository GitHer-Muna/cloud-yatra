/**
 * httpSink.test.ts — tests the HttpBatchSink that ships events to the backend /event.
 * Uses a mocked fetch (no real network). Proves the batch SHAPE matches the server
 * contract ({ events: [...] }), flushing behaviour, and requeue-on-server-error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpBatchSink } from './sinks';
import type { TelemetryEvent } from './events';

function makeEvent(type: string, attrs: Record<string, unknown> = {}): TelemetryEvent {
  return {
    schemaVersion: 1,
    type: type as TelemetryEvent['type'],
    sessionId: 'test-session-1234',
    levelId: 'himal_rajya',
    ts: Date.now(),
    tMs: 1,
    playerId: null,
    correlationId: null,
    attrs,
  };
}

describe('HttpBatchSink', () => {
  let sink: HttpBatchSink;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    sink?.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('POSTs a { events: [...] } batch to the endpoint on manual flush', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    sink = new HttpBatchSink('https://api.example.com/event', { flushIntervalMs: 99999 });
    sink.emit(makeEvent('player_jump', { x: 1, y: 2 }));
    await sink.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/event');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('player_jump');
  });

  it('auto-flushes when the buffer reaches maxBatch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    sink = new HttpBatchSink('https://api.example.com/event', {
      maxBatch: 3,
      flushIntervalMs: 99999,
    });
    sink.emit(makeEvent('player_jump'));
    sink.emit(makeEvent('player_jump'));
    expect(fetchMock).not.toHaveBeenCalled(); // below threshold
    sink.emit(makeEvent('player_jump')); // hits maxBatch → flush
    await vi.runOnlyPendingTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).events).toHaveLength(3);
  });

  it('requeues the batch on a 5xx server error so it retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    sink = new HttpBatchSink('https://api.example.com/event', { flushIntervalMs: 99999 });
    sink.emit(makeEvent('level_completed', { score: 100, timeMs: 5000 }));

    await sink.flush(); // first attempt fails → requeued
    await sink.flush(); // second attempt succeeds
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The same event should have been resent in the second call.
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).events[0].type).toBe('level_completed');
  });

  it('does nothing when the buffer is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);
    sink = new HttpBatchSink('https://api.example.com/event', { flushIntervalMs: 99999 });
    await sink.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
