/**
 * cors.ts — small, strict CORS helper.
 *
 * The browser game calls this Worker cross-origin (Pages origin → Worker origin), so we
 * must answer preflight OPTIONS and echo an allowed origin. ALLOWED_ORIGINS is a
 * comma-separated allowlist (or "*" during development).
 */
import type { Env } from './env';

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('Origin');
  const list = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return origin ?? '*';
  if (origin && list.includes(origin)) return origin;
  return null;
}

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = allowedOrigin(req, env);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Correlation-Id, X-Chaos-Token, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    // The browser's Beacon API (navigator.sendBeacon) always sends requests in credentials
    // mode "include". For such a request the preflight must return
    // Access-Control-Allow-Credentials: true AND a CONCRETE origin (never "*"), or the
    // browser blocks the request. We submit scores via sendBeacon, so this is required for
    // the leaderboard to populate from real play. Only set it when we are echoing a single
    // concrete origin — pairing credentials:true with "*" is invalid and would be rejected.
    if (origin !== '*') {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
  }
  return headers;
}

export function preflight(req: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req, env) });
}
