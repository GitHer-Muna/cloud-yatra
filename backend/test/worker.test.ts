/**
 * worker.test.ts — exercises the Worker through its fetch handler in the real workerd
 * runtime, writing to an in-memory D1 with the production migrations applied.
 */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { migrate } from './apply-migrations';
import { __resetChaos } from '../src/chaos';

const BASE = 'https://api.test';

interface EventInit {
  type: string;
  sessionId?: string;
  levelId?: string | null;
  ts?: number;
  tMs?: number;
  attrs?: Record<string, unknown>;
  correlationId?: string | null;
}

function makeEvent(init: EventInit): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: init.type,
    sessionId: init.sessionId ?? 'session-abcdef12',
    levelId: init.levelId ?? 'terai',
    ts: init.ts ?? Date.now(),
    tMs: init.tMs ?? Math.floor(Math.random() * 100000),
    playerId: null,
    correlationId: init.correlationId ?? null,
    attrs: init.attrs ?? {},
  };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const req = new Request(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await migrate();
  // Clean tables so each test is isolated (migrations are idempotent across the suite).
  for (const t of ['events', 'sessions', 'scores', 'daily_rollup']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

describe('CORS + routing', () => {
  it('answers preflight with allow-origin', async () => {
    const res = await call('OPTIONS', '/event');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('404s unknown routes', async () => {
    const res = await call('GET', '/nope');
    expect(res.status).toBe(404);
  });

  it('sets a correlation id header on responses', async () => {
    const res = await call('GET', '/healthz');
    expect(res.headers.get('X-Correlation-Id')).toBeTruthy();
  });
});

describe('/healthz', () => {
  it('reports ok with D1 reachable', async () => {
    const res = await call('GET', '/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: boolean };
    expect(body.status).toBe('ok');
    expect(body.db).toBe(true);
  });
});

describe('/event validation + ingest', () => {
  it('accepts a valid event and persists it', async () => {
    const res = await call('POST', '/event', makeEvent({ type: 'game_started', attrs: { inputMode: 'keyboard' } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number; rejected: number };
    expect(body.accepted).toBe(1);
    const row = await env.DB.prepare('SELECT COUNT(*) c FROM events').first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  it('rejects an invalid event (bad schema version)', async () => {
    const bad = makeEvent({ type: 'game_started' });
    bad.schemaVersion = 99;
    const res = await call('POST', '/event', bad);
    const body = (await res.json()) as { accepted: number; rejected: number };
    expect(body.accepted).toBe(0);
    expect(body.rejected).toBe(1);
  });

  it('rejects unknown event type', async () => {
    const res = await call('POST', '/event', makeEvent({ type: 'not_a_real_event' }));
    const body = (await res.json()) as { rejected: number };
    expect(body.rejected).toBe(1);
  });

  it('is idempotent on replay (same identity → counted once)', async () => {
    const ev = makeEvent({ type: 'player_jump', ts: 1000, tMs: 1234, attrs: { x: 1, y: 2 } });
    await call('POST', '/event', ev);
    const res2 = await call('POST', '/event', ev);
    const body2 = (await res2.json()) as { accepted: number; duplicate: number };
    expect(body2.duplicate).toBe(1);
    const row = await env.DB.prepare('SELECT COUNT(*) c FROM events').first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  it('rejects bad json', async () => {
    const req = new Request(BASE + '/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: '{not json',
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});

describe('/events batch', () => {
  it('ingests a batch and updates the session rollup', async () => {
    const sid = 'sess-batch-001';
    const batch = [
      makeEvent({ type: 'game_started', sessionId: sid, tMs: 1, attrs: { inputMode: 'touch' } }),
      makeEvent({ type: 'player_jump', sessionId: sid, tMs: 2, attrs: { x: 1, y: 1 } }),
      makeEvent({ type: 'player_jump', sessionId: sid, tMs: 3, attrs: { x: 1, y: 1 } }),
      makeEvent({ type: 'obstacle_cut', sessionId: sid, tMs: 4, attrs: { kind: 'thorns', total: 1 } }),
      makeEvent({ type: 'collectible_collected', sessionId: sid, tMs: 5, attrs: { kind: 'marigold', total: 1 } }),
      makeEvent({ type: 'collectible_collected', sessionId: sid, tMs: 6, attrs: { kind: 'prayer_bell', total: 1 } }),
      makeEvent({ type: 'player_died', sessionId: sid, tMs: 7, attrs: { cause: 'eagle' } }),
    ];
    const res = await call('POST', '/events', batch);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number };
    expect(body.accepted).toBe(7);

    const s = await env.DB.prepare('SELECT * FROM sessions WHERE session_id=?').bind(sid).first<any>();
    expect(s.started).toBe(1);
    expect(s.jumps).toBe(2);
    expect(s.cuts).toBe(1);
    expect(s.collects).toBe(1);
    expect(s.bells).toBe(1);
    expect(s.deaths).toBe(1);
    expect(s.input_mode).toBe('touch');
  });

  it('rejects an oversized batch', async () => {
    const batch = Array.from({ length: 101 }, (_, i) => makeEvent({ type: 'player_jump', tMs: i }));
    const res = await call('POST', '/events', batch);
    expect(res.status).toBe(413);
  });

  it('accepts {events:[...]} wrapper form', async () => {
    const res = await call('POST', '/events', { events: [makeEvent({ type: 'game_started' })] });
    const body = (await res.json()) as { accepted: number };
    expect(body.accepted).toBe(1);
  });
});

describe('/score + /leaderboard', () => {
  it('submits a score and reads it back ranked', async () => {
    await call('POST', '/score', { name: 'Asha', score: 500, timeMs: 42000, levelId: 'himal' });
    await call('POST', '/score', { name: 'Bimal', score: 900 });
    await call('POST', '/score', { name: 'Chandra', score: 300 });
    const res = await call('GET', '/leaderboard?limit=10');
    const body = (await res.json()) as { entries: Array<{ name: string; score: number }> };
    expect(body.entries.map((e) => e.name)).toEqual(['Bimal', 'Asha', 'Chandra']);
  });

  it('keeps only the best score per name (case-insensitive)', async () => {
    await call('POST', '/score', { name: 'Asha', score: 500 });
    await call('POST', '/score', { name: 'asha', score: 1200 });
    await call('POST', '/score', { name: 'ASHA', score: 300 });
    const res = await call('GET', '/leaderboard');
    const body = (await res.json()) as { entries: Array<{ name: string; score: number }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].score).toBe(1200);
  });

  it('rejects a bad score', async () => {
    const res = await call('POST', '/score', { name: 'X', score: -5 });
    expect(res.status).toBe(400);
  });

  it('rejects a missing name', async () => {
    const res = await call('POST', '/score', { score: 100 });
    expect(res.status).toBe(400);
  });
});

describe('/stats', () => {
  it('aggregates events, deaths by cause, and the funnel', async () => {
    const sid = 'sess-stats-1';
    await call('POST', '/events', [
      makeEvent({ type: 'game_started', sessionId: sid, levelId: 'terai', tMs: 1 }),
      makeEvent({ type: 'player_died', sessionId: sid, levelId: 'terai', tMs: 2, attrs: { cause: 'eagle' } }),
      makeEvent({ type: 'player_died', sessionId: sid, levelId: 'hills', tMs: 3, attrs: { cause: 'rockfall' } }),
      makeEvent({ type: 'level_completed', sessionId: sid, levelId: 'himal', tMs: 4, attrs: { score: 999, timeMs: 1000 } }),
    ]);
    const res = await call('GET', '/stats');
    expect(res.status).toBe(200);
    const s = (await res.json()) as any;
    expect(s.totals.events).toBe(4);
    expect(s.totals.deaths).toBe(2);
    expect(s.totals.completions).toBe(1);
    const causes = Object.fromEntries(s.deathsByCause.map((r: any) => [r.cause, r.count]));
    expect(causes.eagle).toBe(1);
    expect(causes.rockfall).toBe(1);
    expect(s.funnel.started).toBe(1);
    expect(s.funnel.reachedHimal).toBe(1);
    expect(s.funnel.completed).toBe(1);
  });
});

describe('/metrics', () => {
  it('exposes prometheus text with request counters', async () => {
    await call('GET', '/healthz');
    const res = await call('GET', '/metrics');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('cy_api_requests_total');
    expect(text).toContain('# TYPE cy_api_request_duration_ms histogram');
  });
});

/** Like call() but with extra headers (used for the chaos admin token). */
async function callH(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Response> {
  const req = new Request(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const TOKEN = { 'X-Chaos-Token': 'test-admin-token' };

describe('Chaos Mode', () => {
  beforeEach(() => __resetChaos());

  it('status is inactive by default and is unauthenticated', async () => {
    const res = await call('GET', '/chaos/status');
    expect(res.status).toBe(200);
    const s = (await res.json()) as { active: boolean; remainingMs: number };
    expect(s.active).toBe(false);
    expect(s.remainingMs).toBe(0);
  });

  it('rejects start without a token (401)', async () => {
    const res = await call('POST', '/chaos/start', {});
    expect(res.status).toBe(401);
    const after = (await (await call('GET', '/chaos/status')).json()) as { active: boolean };
    expect(after.active).toBe(false);
  });

  it('rejects start with a wrong token (401)', async () => {
    const res = await callH('POST', '/chaos/start', { 'X-Chaos-Token': 'nope' }, {});
    expect(res.status).toBe(401);
  });

  it('starts chaos with the admin token and reports active status', async () => {
    const res = await callH('POST', '/chaos/start', TOKEN, { durationMs: 60000, errorRate: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: { active: boolean; remainingMs: number } };
    expect(body.ok).toBe(true);
    expect(body.status.active).toBe(true);
    expect(body.status.remainingMs).toBeGreaterThan(0);
  });

  it('injects latency on gameplay routes but never on control/health routes', async () => {
    // errorRate 0 → no synthetic failures, only latency, so we can assert timing + status.
    await callH('POST', '/chaos/start', TOKEN, { durationMs: 60000, latencyMs: 300, errorRate: 0 });

    const t0 = Date.now();
    const ev = await call('POST', '/event', makeEvent({ type: 'player_jump', tMs: 1 }));
    const gameplayMs = Date.now() - t0;
    expect(ev.status).toBe(200); // still succeeds (only latency, no error)
    expect(gameplayMs).toBeGreaterThanOrEqual(250); // the ~300ms injection landed

    const t1 = Date.now();
    const health = await call('GET', '/healthz');
    const healthMs = Date.now() - t1;
    expect(health.status).toBe(200);
    expect(healthMs).toBeLessThan(200); // health is never perturbed
  });

  it('fails gameplay requests with 503 when errorRate is 1', async () => {
    await callH('POST', '/chaos/start', TOKEN, { durationMs: 60000, latencyMs: 0, errorRate: 1 });
    const res = await call('POST', '/event', makeEvent({ type: 'player_jump', tMs: 2 }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('chaos_injected');
  });

  it('stop ends the window immediately', async () => {
    await callH('POST', '/chaos/start', TOKEN, { durationMs: 60000, errorRate: 1 });
    const stop = await callH('POST', '/chaos/stop', TOKEN);
    expect(stop.status).toBe(200);
    const s = (await (await call('GET', '/chaos/status')).json()) as { active: boolean };
    expect(s.active).toBe(false);
    // gameplay works again (no injection)
    const res = await call('POST', '/event', makeEvent({ type: 'player_jump', tMs: 3 }));
    expect(res.status).toBe(200);
  });

  it('exposes recent chaos episodes for Grafana annotations', async () => {
    await callH('POST', '/chaos/start', TOKEN, { durationMs: 60000, errorRate: 0 });
    await callH('POST', '/chaos/stop', TOKEN);
    const res = await call('GET', '/chaos/events');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ kind: string; ts: number }> };
    const kinds = body.events.map((e) => e.kind);
    expect(kinds).toContain('chaos_start');
    expect(kinds).toContain('chaos_stop');
    expect(body.events.every((e) => typeof e.ts === 'number')).toBe(true);
  });

  it('surfaces cy_chaos_active in /metrics while active', async () => {
    await callH('POST', '/chaos/start', TOKEN, { durationMs: 60000, errorRate: 0 });
    const text = await (await call('GET', '/metrics')).text();
    expect(text).toContain('cy_chaos_active');
  });
});
