/**
 * grafanaProxy.ts — a narrow reverse proxy that lets the game page embed the real Grafana
 * public dashboard in an iframe BELOW the game, on the game's own origin.
 *
 * WHY THIS EXISTS
 * Grafana Cloud serves its dashboards (including public ones) with CSP
 * `frame-ancestors 'none'` and `X-Frame-Options: deny`, so a browser refuses to render
 * `<iframe src="https://<stack>.grafana.net/public-dashboards/...">` on another origin. The
 * only ways around that are an account-level Grafana setting (support ticket) or serving
 * the dashboard from the SAME origin as the embedding page. This proxy does the latter: the
 * Worker fetches the public dashboard from Grafana server-side and re-serves it from its own
 * origin with the frame-blocking headers removed. The dashboard HTML is served at
 * `/public-dashboards/<token>` (the Grafana boot script matches that pathname), and the
 * SPA's root-absolute calls (`/api`, `/bootdata`, …) are proxied at the Worker root too, so
 * the game page can iframe `${WORKER}/public-dashboards/<token>` with no browser refusal.
 *
 * SCOPE + SAFETY
 *  - PUBLIC dashboards only. There is no authentication to forward — the proxy never sees
 *    or needs a Grafana cookie, token, or credential. It cannot reach anything that isn't
 *    already public at the `/public-dashboards/<token>` + `/api/public/...` endpoints.
 *  - Method-limited to GET/HEAD/POST (the public panel-query endpoint uses POST).
 *  - Path-limited to the Grafana paths a public dashboard actually uses. The SPA fetches
 *    with ROOT-absolute paths (/api, /public, /avatar, /public-dashboards) that ignore
 *    <base href>, so we proxy those prefixes at the Worker ROOT. Static JS/CSS/img load
 *    from Grafana's absolute CDN (grafana-assets.grafana.net) and are NOT proxied.
 *  - The dashboard HTML is served at /public-dashboards/<token> (root, not under /dash)
 *    because the Grafana boot script matches window.location.pathname against
 *    /public-dashboards/.* to derive its public context.
 *  - Upstream Content-Encoding/Content-Length are stripped: the Workers runtime auto-
 *    decompresses the body, so forwarding those headers would make the browser try to
 *    decode already-decoded bytes.
 */
import type { Env } from './env';

const PREFIX = '/dash';

// Grafana SPA root-absolute prefixes. The public-dashboard app issues fetch('/api/...'),
// fetch('/bootdata'), etc. with ROOT-absolute paths that ignore <base href> and hit the
// Worker ROOT — so we must proxy them at the root, or the boot sequence gets this API's
// {"error":"not_found"} and shows "Failed to load Grafana". We ALSO serve the dashboard
// HTML at /public-dashboards/<token> (the boot script matches window.location.pathname
// against /public-dashboards/.* to derive its public context). `/bootdata` is the initial
// boot-data fetch (__grafana_boot_data_promise); `/apis/` is the newer resource API. None
// of these collide with this API's own routes (/healthz, /metrics, /stats, /leaderboard,
// /recent, /session, /score, /event, /events, /chaos/*), which use entirely different path names.
const GRAFANA_ROOT_PREFIXES = [
  '/api/',
  '/apis/',
  '/public/',
  '/avatar/',
  '/public-dashboards/',
  '/bootdata',
  '/-/', // Grafana internal endpoints, e.g. /-/fe-boot-error
];

/** True when the Worker should handle this request as a dashboard-proxy request. */
export function isProxyRequest(pathname: string): boolean {
  if (pathname === PREFIX || pathname.startsWith(`${PREFIX}/`)) return true;
  return GRAFANA_ROOT_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Frame/CSP headers that would block embedding — stripped from every proxied response. */
function stripFrameHeaders(h: Headers): void {
  h.delete('X-Frame-Options');
  h.delete('Content-Security-Policy');
  h.delete('Content-Security-Policy-Report-Only');
  // Grafana sets a strict CSP on the doc; once proxied same-origin it's not needed for the
  // embed, and leaving `frame-ancestors 'none'` would defeat the whole proxy.
}

/**
 * Proxy a Grafana public-dashboard request to the configured Grafana origin. Returns a 404
 * Response when the proxy is not configured. Handles both the `/public-dashboards/<token>`
 * HTML entry and the SPA's root-absolute sub-requests; strips the frame-blocking headers and
 * the stale Content-Encoding (the runtime auto-decompresses the body).
 */
export async function handleProxy(req: Request, env: Env): Promise<Response> {
  const base = (env.GRAFANA_PROXY_BASE ?? '').trim().replace(/\/$/, '');
  if (!base) {
    return new Response('dashboard proxy not configured', { status: 404 });
  }

  const method = req.method.toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    return new Response('method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  // Two shapes reach here:
  //   1) /dash/<rest>        → the dashboard HTML entry (and anything anchor-relative).
  //   2) /api|/public|/avatar → the SPA's ROOT-absolute fetches (panel queries, settings,
  //      assets) that ignore <base href>. Pass these straight through to Grafana.
  // In both cases the upstream path is the request path minus an optional /dash prefix.
  const path = url.pathname.startsWith(`${PREFIX}/`)
    ? url.pathname.slice(PREFIX.length) // '/dash/api/..' → '/api/..'
    : url.pathname === PREFIX
      ? '/'
      : url.pathname; // already root-absolute (/api, /public, /avatar)
  const target = `${base}${path}${url.search}`;

  // Forward the request. Only a minimal, safe header set is passed upstream; no cookies.
  const upstreamHeaders = new Headers();
  const accept = req.headers.get('Accept');
  const ct = req.headers.get('Content-Type');
  if (accept) upstreamHeaders.set('Accept', accept);
  if (ct) upstreamHeaders.set('Content-Type', ct);

  const upstream = await fetch(target, {
    method,
    headers: upstreamHeaders,
    body: method === 'POST' ? await req.arrayBuffer() : undefined,
    redirect: 'manual',
  });

  const resHeaders = new Headers(upstream.headers);
  stripFrameHeaders(resHeaders);
  // The Workers runtime transparently DECOMPRESSES the upstream body when we read/stream it,
  // but the upstream's `Content-Encoding` (gzip/br) + `Content-Length` headers describe the
  // ORIGINAL compressed bytes. Forwarding them tells the browser to decode an already-
  // decoded body → garbage → the Grafana app can't parse its JS and shows "Error loading
  // Grafana". Strip both so the browser reads the body as-is (Cloudflare re-applies its own
  // content-encoding on the way out).
  resHeaders.delete('Content-Encoding');
  resHeaders.delete('Content-Length');
  // Let the game origin read proxied responses if ever fetched via XHR (the iframe itself
  // doesn't need this, but it's harmless and future-proofs programmatic reads).
  resHeaders.set('Access-Control-Allow-Origin', '*');

  // The SPA fetches with ROOT-absolute paths (/api, /public, /avatar) which we proxy at the
  // Worker root, and its static assets load from Grafana's absolute CDN. So the document can
  // be served as-is; no <base href> rewrite is needed. We only strip the frame headers.
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}
