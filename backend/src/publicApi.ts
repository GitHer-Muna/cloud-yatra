/**
 * publicApi.ts — the read-only public API under /open/*.
 *
 * Built for third-party dashboards (Grafana Play via the Infinity data source). It:
 *   - returns game statistics only: no player names, session ids, emails or secrets;
 *   - accepts GET/HEAD only (everything else is 405), so it has no write routes;
 *   - is cached (Cache-Control for browsers/CDNs plus a short in-isolate cache that
 *     shields D1) and rate limited per client IP.
 *
 * Rate limiting uses the optional Workers Rate Limiting binding PUBLIC_LIMITER. When the
 * binding is absent (local dev, tests) a small per-isolate fixed-window limiter is used.
 */
import type { Env } from './env';
import { corsHeaders } from './cors';
import { publicLeaderboard, pulse } from './db';
import { getStatus, recentEvents } from './chaos';

export const PUBLIC_PREFIX = '/open/';

/** Seconds a response may be reused by browsers and Cloudflare caches. */
export const PUBLIC_TTL_S = 30;
const ISOLATE_TTL_MS = 15_000;

/** Fallback limiter: requests per client per window, when no PUBLIC_LIMITER binding exists. */
const FALLBACK_LIMIT = 60;
const FALLBACK_WINDOW_MS = 60_000;

export function isPublicRequest(pathname: string): boolean {
  return pathname.startsWith(PUBLIC_PREFIX);
}

const cache = new Map<string, { at: number; body: string }>();
const hits = new Map<string, { windowStart: number; count: number }>();

/** Test-only: clear the in-isolate cache and fallback limiter. */
export function __resetPublicApi(): void {
  cache.clear();
  hits.clear();
}

async function allowed(req: Request, env: Env): Promise<boolean> {
  const key = req.headers.get('CF-Connecting-IP') ?? 'anon';
  if (env.PUBLIC_LIMITER) {
    const { success } = await env.PUBLIC_LIMITER.limit({ key });
    return success;
  }
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.windowStart >= FALLBACK_WINDOW_MS) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { windowStart: now, count: 1 });
    return true;
  }
  h.count += 1;
  return h.count <= FALLBACK_LIMIT;
}

function reply(req: Request, env: Env, body: string, status: number, cacheable: boolean): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...corsHeaders(req, env),
    'Cache-Control': cacheable ? `public, max-age=${PUBLIC_TTL_S}, s-maxage=${PUBLIC_TTL_S}` : 'no-store',
  };
  return new Response(req.method === 'HEAD' ? null : body, { status, headers });
}

async function compute(path: string, env: Env, stats: () => Promise<unknown>): Promise<unknown | undefined> {
  switch (path) {
    case 'stats':
      return stats();
    case 'pulse':
      return { pulse: [await pulse(env)] };
    case 'leaderboard':
      return { entries: await publicLeaderboard(env, 50) };
    case 'chaos/status':
      return getStatus();
    case 'chaos/events':
      return { events: recentEvents() };
    default:
      return undefined;
  }
}

export async function handlePublic(
  req: Request,
  env: Env,
  pathname: string,
  stats: () => Promise<unknown>,
): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const res = reply(req, env, JSON.stringify({ error: 'read_only' }), 405, false);
    res.headers.set('Allow', 'GET, HEAD, OPTIONS');
    return res;
  }
  if (!(await allowed(req, env))) {
    const res = reply(req, env, JSON.stringify({ error: 'rate_limited' }), 429, false);
    res.headers.set('Retry-After', '60');
    return res;
  }
  const path = pathname.slice(PUBLIC_PREFIX.length);
  const now = Date.now();
  const hit = cache.get(path);
  if (hit && now - hit.at < ISOLATE_TTL_MS) return reply(req, env, hit.body, 200, true);

  const data = await compute(path, env, stats);
  if (data === undefined) return reply(req, env, JSON.stringify({ error: 'not_found' }), 404, false);
  const body = JSON.stringify(data);
  cache.set(path, { at: now, body });
  return reply(req, env, body, 200, true);
}
