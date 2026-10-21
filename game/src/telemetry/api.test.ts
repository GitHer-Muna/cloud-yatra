/**
 * api.test.ts — the backend client (api.ts) and HttpBatchSink.
 *
 * These verify the two things that matter for the live backend wiring:
 *   1. Offline-safe fallback: with no base URL (or on fetch failure) the leaderboard still
 *      returns a usable local board and nothing throws into gameplay.
 *   2. Batching: HttpBatchSink coalesces events and POSTs them to /events.
 *
 * These tests force the "no backend configured" path by overriding the module's env
 * reader via __setApiBaseEnvReader — so they pass whether or not a developer has a local
 * game/.env pointing at a real Worker. The sink is tested directly with an explicit base
 * URL and a mocked fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBase, hasBackend, fetchLeaderboard, __setApiBaseEnvReader } from './api';
import { HttpBatchSink } from './sinks';
import type { TelemetryEvent } from './events';

function evt(type: string): TelemetryEvent {
  return {
    schemaVersion: 1,
    type: type as TelemetryEvent['type'],
    sessionId: 'sess-aaaaaaaa',
    levelId: 'terai',
    ts: Date.now(),
    tMs: 1,
    playerId: null,
    correlationId: null,
    attrs: {},
  };
}

describe('apiBase / hasBackend', () => {
  beforeEach(() => __setApiBaseEnvReader(() => undefined));
  afterEach(() => __setApiBaseEnvReader(() => undefined));

  it('returns null when VITE_API_BASE_URL is unset (offline build)', () => {
    expect(apiBase()).toBeNull();
    expect(hasBackend()).toBe(false);
  });
});

describe('fetchLeaderboard', () => {
  beforeEach(() => __setApiBaseEnvReader(() => undefined));
  afterEach(() => __setApiBaseEnvReader(() => undefined));

  it('falls back to the local board when no backend is configured', async () => {
    const board = await fetchLeaderboard(10);
    // Local board always has the seeded legends, so it is never empty.
    expect(Array.isArray(board)).toBe(true);
    expect(board.length).toBeGreaterThan(0);
  });
});

describe('apiBase (configured)', () => {
  afterEach(() => __setApiBaseEnvReader(() => undefined));

  it('trims a trailing slash and reports hasBackend', () => {
    __setApiBaseEnvReader(() => 'https://api.example.com/');
    expect(apiBase()).toBe('https://api.example.com');
    expect(hasBackend()).toBe(true);
  });

  it('treats a blank/whitespace value as unconfigured', () => {
    __setApiBaseEnvReader(() => '   ');
    expect(apiBase()).toBeNull();
    expect(hasBackend()).toBe(false);
  });
});

describe('HttpBatchSink', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{"accepted":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', {}); // force the fetch path (no sendBeacon)
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('flushes a batch to /events with the wrapper shape', async () => {
    const sink = new HttpBatchSink('https://api.test', 20, 4000);
    sink.emit(evt('game_started'));
    sink.emit(evt('player_jump'));
    await sink.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/events');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].type).toBe('game_started');
  });

  it('auto-sends when the batch size threshold is reached', async () => {
    const sink = new HttpBatchSink('https://api.test', 2, 10_000);
    sink.emit(evt('player_jump'));
    sink.emit(evt('player_jump')); // reaches maxBatch=2 → immediate send
    // allow the microtask/promise in send() to settle
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws when fetch rejects (offline-safe)', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('network down');
    });
    const sink = new HttpBatchSink('https://api.test', 20, 4000);
    sink.emit(evt('game_started'));
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it('does nothing when the queue is empty', async () => {
    const sink = new HttpBatchSink('https://api.test');
    await sink.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
