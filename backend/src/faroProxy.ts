/**
 * faroProxy.ts — a first-party passthrough for Grafana Faro RUM ingest.
 *
 * WHY THIS EXISTS
 * The Faro Web SDK posts RUM data to a Grafana Cloud collector host
 * (`faro-collector-prod-<region>.grafana.net`). That hostname matches the tracker/ad
 * blocklists used by Brave Shields, Edge Tracking Prevention, uBlock, etc., so the browser
 * refuses the request with `net::ERR_BLOCKED_BY_CLIENT` and the SDK logs "Delivery retries
 * exhausted". The data is OUR OWN first-party RUM, not third-party tracking, but the blockers
 * can't tell them apart by hostname.
 *
 * THE FIX
 * Serve Faro ingest from the Worker's OWN origin (same origin as the game's API), which the
 * blockers don't treat as a tracker. The game points `VITE_FARO_URL` at `${WORKER}/faro`;
 * this module forwards the body verbatim to the real collector configured in `FARO_UPSTREAM`
 * and returns a CORS-friendly response. No body inspection, no credentials — a dumb pipe.
 *
 * SCOPE + SAFETY
 *  - POST/OPTIONS only. Faro sends measurements as POST (fetch or navigator.sendBeacon).
 *  - The upstream collector URL already embeds the app key in its path, so no secret is
 *    added here. `FARO_UPSTREAM` is public-by-design config (same class as VITE_FARO_URL).
 *  - Returns a 404 when unconfigured, so the game simply keeps its direct Faro URL.
 */
import type { Env } from './env';
import { corsHeaders } from './cors';

const PREFIX = '/faro';

/** True when the request targets the first-party Faro ingest passthrough. */
export function isFaroRequest(pathname: string): boolean {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

/**
 * Forward a Faro ingest request to the configured upstream collector. The game's
 * `VITE_FARO_URL` is set to `${WORKER}/faro`; the path after `/faro` (if any) and the query
 * string are appended to `FARO_UPSTREAM` so sub-paths pass through. Returns 404 when the
 * upstream isn't configured (the game then keeps using its direct collector URL).
 */
export async function handleFaro(req: Request, env: Env): Promise<Response> {
  const upstream = (env.FARO_UPSTREAM ?? '').trim().replace(/\/$/, '');
  if (!upstream) {
    return new Response('faro upstream not configured', { status: 404 });
  }

  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  }
  if (method !== 'POST') {
    return new Response('method not allowed', {
      status: 405,
      headers: corsHeaders(req, env),
    });
  }

  const url = new URL(req.url);
  const rest = url.pathname.slice(PREFIX.length); // '' or '/<more>'
  const target = `${upstream}${rest}${url.search}`;

  // Forward the body verbatim. Faro uses application/json (fetch transport) or a text body
  // via sendBeacon; pass the Content-Type through so the collector parses it correctly.
  // The collector also REQUIRES the `X-Faro-Session-Id` header (and may read other
  // `x-faro-*` headers) — it returns 400 "missing X-Faro-Session-Id header" without it — so
  // forward every `x-faro-*` request header too.
  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Content-Type', req.headers.get('Content-Type') ?? 'application/json');
  req.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('x-faro-')) {
      upstreamHeaders.set(key, value);
    }
  });

  const res = await fetch(target, {
    method: 'POST',
    headers: upstreamHeaders,
    body: await req.arrayBuffer(),
  });

  // Echo a CORS-friendly response so the browser accepts it from the game origin. The body
  // from a Faro collector is typically empty (204/200); relay status and body as-is.
  const headers = corsHeaders(req, env);
  return new Response(res.body, { status: res.status, headers });
}
