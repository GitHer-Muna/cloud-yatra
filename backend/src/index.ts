/**
 * index.ts — the Cloud Yatra backend Worker entrypoint.
 *
 * Routes:
 *   GET  /healthz       → liveness + D1 reachability probe
 *   GET  /metrics       → Prometheus text (isolate-lifetime counters/histograms)
 *   GET  /stats         → aggregate dashboard stats from D1 (JSON)
 *   GET  /leaderboard   → top scores from D1 (JSON)
 *   POST /score         → submit a completed run (best-per-name)
 *   POST /event         → ingest a single telemetry event
 *   POST /events        → ingest a batch of telemetry events
 *
 * Every request: correlationId, structured JSON log, Prometheus metrics, optional Grafana
 * Loki log push + Tempo trace span. The game degrades gracefully if this Worker is down.
 */
import type { Env } from './env';
import { corsHeaders, preflight } from './cors';
import { validateEvent, MAX_BATCH, type EventEnvelope } from './events';
import { ingest, leaderboard, stats, submitScore } from './db';
import { inc, observe, renderMetrics, setGauge } from './metrics';
import { Logger, hexId, pushTrace } from './logger';

function json(data: unknown, status: number, req: Request, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req, env) },
  });
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method.toUpperCase();
    const startMs = Date.now();

    const correlationId = req.headers.get('X-Correlation-Id') ?? hexId(8);
    const traceId = hexId(16);
    const spanId = hexId(8);
    const country = (req as unknown as { cf?: { country?: string } }).cf?.country ?? null;

    const route = routeLabel(pathname);
    const log = new Logger(env, ctx, { correlationId, route, method, country: country ?? 'unknown' });

    if (method === 'OPTIONS') return preflight(req, env);

    let response: Response;
    try {
      response = await handle(req, env, { pathname, method, log, correlationId, country });
    } catch (err) {
      log.error('unhandled_error', { error: err instanceof Error ? err.message : String(err) });
      inc('cy_api_errors_total', { route }, 'Unhandled errors by route');
      response = json({ error: 'internal_error', correlationId }, 500, req, env);
    }

    const durationMs = Date.now() - startMs;
    const sclass = statusClass(response.status);
    inc('cy_api_requests_total', { route, status_class: sclass }, 'HTTP requests by route/status');
    observe('cy_api_request_duration_ms', durationMs, { route }, 'Request duration (ms)');

    log.info('request', { status: response.status, durationMs });
    log.flushLoki({ route, status_class: sclass });
    pushTrace(env, ctx, {
      traceId,
      spanId,
      name: `${method} ${route}`,
      startMs,
      endMs: startMs + durationMs,
      attributes: {
        'http.method': method,
        'http.route': route,
        'http.status_code': response.status,
        correlationId,
      },
      status: response.status >= 500 ? 'error' : 'ok',
    });

    response.headers.set('X-Correlation-Id', correlationId);
    return response;
  },
} satisfies ExportedHandler<Env>;

function routeLabel(pathname: string): string {
  // Keep the route label low-cardinality (known routes only).
  const known = ['/healthz', '/metrics', '/stats', '/leaderboard', '/score', '/event', '/events'];
  return known.includes(pathname) ? pathname : 'other';
}

interface Ctx {
  pathname: string;
  method: string;
  log: Logger;
  correlationId: string;
  country: string | null;
}

async function handle(req: Request, env: Env, c: Ctx): Promise<Response> {
  const { pathname, method } = c;

  if (pathname === '/healthz' && method === 'GET') {
    let dbOk = false;
    try {
      await env.DB.prepare('SELECT 1').first();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    setGauge('cy_api_up', 1, {}, 'Worker liveness (1=up)');
    return json({ status: dbOk ? 'ok' : 'degraded', db: dbOk, service: env.SERVICE_NAME }, dbOk ? 200 : 503, req, env);
  }

  if (pathname === '/metrics' && method === 'GET') {
    return new Response(renderMetrics(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; version=0.0.4', ...corsHeaders(req, env) },
    });
  }

  if (pathname === '/stats' && method === 'GET') {
    const s = await stats(env);
    setGauge('cy_sessions_total', s.sessions.total, {}, 'Total sessions (from D1)');
    setGauge('cy_sessions_active', s.sessions.active5m, {}, 'Active sessions (5m, from D1)');
    for (const r of s.eventsByType) {
      inc('cy_events_snapshot_total', { type: r.type }, 'Events by type snapshot', 0);
      setGauge('cy_events_by_type', r.count, { type: r.type }, 'Event count by type (D1)');
    }
    return json(s, 200, req, env);
  }

  if (pathname === '/leaderboard' && method === 'GET') {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? '20');
    const rows = await leaderboard(env, Number.isFinite(limit) ? limit : 20);
    return json({ entries: rows }, 200, req, env);
  }

  if (pathname === '/score' && method === 'POST') {
    const body = (await safeJson(req)) as Record<string, unknown> | null;
    if (!body) return json({ error: 'bad_json' }, 400, req, env);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const score = Number(body.score);
    if (!name || name.length > 48) return json({ error: 'bad_name' }, 400, req, env);
    if (!Number.isFinite(score) || score < 0 || score > 1_000_000)
      return json({ error: 'bad_score' }, 400, req, env);
    await submitScore(env, {
      name,
      score,
      timeMs: Number.isFinite(Number(body.timeMs)) ? Number(body.timeMs) : null,
      levelId: typeof body.levelId === 'string' ? body.levelId : null,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      country: c.country,
    });
    inc('cy_scores_submitted_total', {}, 'Scores submitted');
    const rows = await leaderboard(env, 20);
    return json({ ok: true, entries: rows }, 200, req, env);
  }

  if ((pathname === '/event' || pathname === '/events') && method === 'POST') {
    const body = await safeJson(req);
    if (body === null) return json({ error: 'bad_json' }, 400, req, env);
    const batch: unknown[] = pathname === '/events' ? (Array.isArray(body) ? body : (body as { events?: unknown[] })?.events ?? []) : [body];
    if (!Array.isArray(batch) || batch.length === 0) return json({ error: 'empty' }, 400, req, env);
    if (batch.length > MAX_BATCH) return json({ error: 'too_many' }, 413, req, env);

    let accepted = 0;
    let rejected = 0;
    let duplicate = 0;
    const receivedAt = Date.now();
    for (const raw of batch) {
      const v = validateEvent(raw);
      if (!v.ok) {
        rejected += 1;
        inc('cy_events_rejected_total', { reason: v.reason ?? 'unknown' }, 'Rejected events');
        continue;
      }
      const ev = raw as EventEnvelope;
      const eventId = deriveEventId(ev);
      const res = await ingest(env, ev, { eventId, receivedAt, country: c.country });
      if (res.inserted) {
        accepted += 1;
        inc('cy_events_accepted_total', { type: ev.type }, 'Accepted events by type');
      } else {
        duplicate += 1;
      }
    }
    c.log.info('ingest', { accepted, rejected, duplicate });
    return json({ accepted, rejected, duplicate }, 200, req, env);
  }

  return json({ error: 'not_found' }, 404, req, env);
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Stable idempotency key: prefer a client correlationId, else hash of identity fields. */
function deriveEventId(ev: EventEnvelope): string {
  if (ev.correlationId && ev.correlationId.length >= 8) {
    return `${ev.correlationId}:${ev.type}:${ev.tMs}`;
  }
  return `${ev.sessionId}:${ev.type}:${ev.ts}:${ev.tMs}`;
}
