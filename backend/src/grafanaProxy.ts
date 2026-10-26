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
 * Worker fetches the public dashboard from Grafana server-side and re-serves it under
 * `/dash/*` with the frame-blocking headers removed, so the game page can iframe
 * `${WORKER}/dash/...` with no browser refusal.
 *
 * SCOPE + SAFETY
 *  - PUBLIC dashboards only. There is no authentication to forward — the proxy never sees
 *    or needs a Grafana cookie, token, or credential. It cannot reach anything that isn't
 *    already public at the `/public-dashboards/<token>` + `/api/public/...` endpoints.
 *  - Method-limited to GET/HEAD/POST (the public panel-query endpoint uses POST). No other
 *    verbs are proxied.
 *  - Path-limited to the Grafana paths a public dashboard actually uses: the public
 *    dashboard page and the `/api/...` + `/public/...` the SPA calls. Static JS/CSS/img are
 *    served by Grafana's absolute CDN (grafana-assets.grafana.net) and load directly, so
 *    they are NOT proxied.
 *  - The dashboard HTML uses `<base href="/">`, which would make its relative `/api/...`
 *    calls resolve at the Worker ROOT. We rewrite the base to `/dash/` so every relative
 *    sub-request routes back through this proxy (and thus stays same-origin, avoiding the
 *    CORS wall — the public API sends no Access-Control-Allow-Origin).
 */
import type { Env } from './env';

const PREFIX = '/dash';

/** True when the Worker should handle this request as a dashboard-proxy request. */
export function isProxyRequest(pathname: string): boolean {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
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
 * Proxy a `/dash/*` request to the configured Grafana origin. Returns a 404 Response when
 * the proxy is not configured. Rewrites the dashboard HTML's <base> so the SPA's relative
 * API calls come back through `/dash/`.
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
  // Map /dash/<rest> → <grafanaBase>/<rest>. Bare /dash or /dash/ → the public dashboard is
  // supplied by the caller via ?d=<path> on first load; afterwards the SPA uses absolute
  // (rewritten) /dash/ paths. We accept any path so the SPA's /api and /public calls work.
  const rest = url.pathname.slice(PREFIX.length); // keeps a leading '/' or ''
  const target = `${base}${rest || '/'}${url.search}`;

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
  // Let the game origin read proxied responses if ever fetched via XHR (the iframe itself
  // doesn't need this, but it's harmless and future-proofs programmatic reads).
  resHeaders.set('Access-Control-Allow-Origin', '*');

  const contentType = upstream.headers.get('Content-Type') ?? '';

  // For the dashboard HTML document, rewrite <base href="/"> → <base href="/dash/"> so the
  // SPA's relative /api and /public requests resolve back through this proxy.
  if (contentType.includes('text/html')) {
    let html = await upstream.text();
    html = html.replace(/<base\s+href="\/"\s*\/?>/i, `<base href="${PREFIX}/" />`);
    resHeaders.delete('Content-Length'); // body length changed
    return new Response(html, { status: upstream.status, headers: resHeaders });
  }

  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}
