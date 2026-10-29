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
import { apiBase, hasBackend, fetchLeaderboard, submitScore, __setApiBaseEnvReader } from './api';
import { getChaosStatus, startChaos, stopChaos } from './api';
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

describe('submitScore', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', {}); // force the fetch path (no sendBeacon)
    __setApiBaseEnvReader(() => 'https://api.test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __setApiBaseEnvReader(() => undefined);
  });

  it('submits an anonymous run with a per-session friendly name (does not drop it)', async () => {
    submitScore(1234, undefined, 5000, 'terai', 'sess-a3f9beef');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/score');
    const body = JSON.parse((opts as RequestInit).body as string);
    // No name given → a stable "Pilgrim-<id prefix>" name is derived from the session id,
    // so the shared board fills up instead of silently dropping nameless runs.
    expect(body.name).toBe('Pilgrim-sess');
    expect(body.score).toBe(1234);
  });

  it('uses the player-entered name verbatim when provided', async () => {
    submitScore(999, 'Tenzing', 4200, 'hills', 'sess-xyz1');
    await Promise.resolve();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.name).toBe('Tenzing');
  });

  it('never submits remotely when no backend is configured (offline-safe)', async () => {
    __setApiBaseEnvReader(() => undefined);
    submitScore(500, undefined, 1000, 'terai', 'sess-abcd');
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('Chaos client (offline-safe)', () => {
  afterEach(() => {
    __setApiBaseEnvReader(() => undefined);
    vi.unstubAllGlobals();
  });

  it('getChaosStatus returns inactive with no backend (no fetch)', async () => {
    __setApiBaseEnvReader(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const s = await getChaosStatus();
    expect(s.active).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('startChaos errors with no_backend when unconfigured', async () => {
    __setApiBaseEnvReader(() => undefined);
    const res = await startChaos('some-token');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no_backend');
  });

  it('startChaos errors with no_token when token is blank (configured backend)', async () => {
    __setApiBaseEnvReader(() => 'https://api.test');
    const res = await startChaos('');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no_token');
  });

  it('startChaos maps a 401 to unauthorized and sends the token header', async () => {
    __setApiBaseEnvReader(() => 'https://api.test');
    const fetchMock: ReturnType<typeof vi.fn> = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await startChaos('wrong-token');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unauthorized');
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://api.test/chaos/start');
    expect(call[1].headers).toMatchObject({ 'X-Chaos-Token': 'wrong-token' });
  });

  it('startChaos maps a 503 to disabled', async () => {
    __setApiBaseEnvReader(() => 'https://api.test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"chaos_disabled"}', { status: 503 })));
    const res = await startChaos('tok');
    expect(res.error).toBe('disabled');
  });

  it('startChaos returns the status on success', async () => {
    __setApiBaseEnvReader(() => 'https://api.test');
    const status = { active: true, remainingMs: 59000, profile: { latencyMs: 600, errorRate: 0.25 }, startedBy: 'admin', injected: 0 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, status }), { status: 200 })));
    const res = await startChaos('tok');
    expect(res.ok).toBe(true);
    expect(res.status.active).toBe(true);
    expect(res.status.remainingMs).toBe(59000);
  });

  it('stopChaos never throws on network failure', async () => {
    __setApiBaseEnvReader(() => 'https://api.test');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const res = await stopChaos('tok');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('network');
  });
});
