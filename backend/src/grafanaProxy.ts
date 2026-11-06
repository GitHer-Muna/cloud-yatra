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
  '/ofrep/', // OpenFeature flag evaluation (POST /ofrep/v1/evaluate/flags) — else the SPA
  //            logs a 404 and "Failed to initialize OpenFeature provider" on boot.
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

// Grafana's app-platform resource APIs (served under /apis/<group>.grafana.app/...) require
// an AUTHENTICATED session. A PUBLIC dashboard has none, so Grafana always answers these
// probes with 401 — and the SPA is built to EXPECT that 401 and fall back to its embedded
// bootdata (see the browser log "plugin meta failed to load so Grafana is falling back to
// bootdata"). Proxying them upstream just does a wasted round-trip to fetch a 401 we already
// know is coming, which also shows up as a slow failed request in the console. Short-circuit
// them with the same 401 locally: identical outcome for the SPA, no upstream hop. The path to
// match is the request path minus an optional /dash prefix (the SPA uses root-absolute /apis).
function isUnauthenticatedResourceApi(path: string): boolean {
  const p = path.startsWith(`${PREFIX}/`) ? path.slice(PREFIX.length) : path;
  return p.startsWith('/apis/');
}

/** Frame/CSP headers that would block embedding — stripped from every proxied response. */
function stripFrameHeaders(h: Headers): void {
  h.delete('X-Frame-Options');
  h.delete('Content-Security-Policy');
  h.delete('Content-Security-Policy-Report-Only');
  // Grafana sets a strict CSP on the doc; once proxied same-origin it's not needed for the
  // embed, and leaving `frame-ancestors 'none'` would defeat the whole proxy.
  // Grafana also sends a `Permissions-Policy` listing features (attribution-reporting,
  // private-aggregation, join-ad-interest-group, run-ad-auction) that some browsers don't
  // recognize and log as "Unrecognized feature" console errors. The embedded dashboard
  // doesn't need any of them, so drop the header entirely to keep the console clean.
  h.delete('Permissions-Policy');
  h.delete('Feature-Policy');
}

/**
 * Rewrite Grafana's boot/settings JSON to DISABLE every third-party analytics + telemetry
 * integration the public dashboard would otherwise try to load. Those scripts
 * (Google Analytics, Rudderstack → FullStory, and Grafana's own embedded Faro
 * "grafanaJavascriptAgent") are routinely blocked by browser shields and ad/tracker
 * blockers, producing a stream of `ERR_BLOCKED_BY_CLIENT` / "Tracking Prevention blocked"
 * console errors that have nothing to do with the dashboard. The dashboard itself does not
 * need any of them, so we strip them at the source: if the SPA never sees the config, it
 * never issues the request, and the console stays clean. Only known analytics keys are
 * touched; all dashboard/datasource settings pass through untouched. Returns the original
 * text unchanged if it isn't parseable JSON (so non-JSON bodies are never corrupted).
 */
function stripAnalyticsFromJson(text: string): string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return text; // not JSON — leave as-is
  }
  if (data === null || typeof data !== 'object') return text;

  // Grafana's boot payload nests config under `settings`; the /api/frontend/settings
  // endpoint returns the settings object at the top level. Handle both.
  const root = data as Record<string, unknown>;
  const settings =
    root.settings && typeof root.settings === 'object'
      ? (root.settings as Record<string, unknown>)
      : root;

  // Blank out string-valued IDs/keys so the SPA sees "not configured".
  for (const k of [
    'googleAnalyticsId',
    'googleAnalytics4Id',
    'rudderstackWriteKey',
    'rudderstackDataPlaneUrl',
    'rudderstackSdkUrl',
    'rudderstackV3SdkUrl',
    'rudderstackConfigUrl',
    'rudderstackIntegrationsUrl',
    'applicationInsightsConnectionString',
    'applicationInsightsEndpointUrl',
  ]) {
    if (k in settings) settings[k] = '';
  }

  // Turn off boolean analytics/feedback switches.
  for (const k of [
    'GoogleAnalytics4SendManualPageViews',
    'applicationInsightsAutoRouteTracking',
    'feedbackLinksEnabled',
    'externalUserMngAnalytics',
    'reportingEnabled',
  ]) {
    if (k in settings) settings[k] = false;
  }

  // Disable Grafana's embedded Faro agent (the faro-collector-* requests).
  if (settings.grafanaJavascriptAgent && typeof settings.grafanaJavascriptAgent === 'object') {
    (settings.grafanaJavascriptAgent as Record<string, unknown>).enabled = false;
  }
  if (settings.analytics && typeof settings.analytics === 'object') {
    (settings.analytics as Record<string, unknown>).enabled = false;
  }

  // Clear the per-user analytics identifier (present in /bootdata under `user`).
  if (root.user && typeof root.user === 'object') {
    const user = root.user as Record<string, unknown>;
    if (user.analytics && typeof user.analytics === 'object') {
      (user.analytics as Record<string, unknown>).identifier = '';
    }
  }

  return JSON.stringify(data);
}

/** True for the boot/settings endpoints whose JSON carries the analytics config. */
function isBootOrSettings(path: string): boolean {
  const p = path.startsWith(`${PREFIX}/`) ? path.slice(PREFIX.length) : path;
  return p === '/bootdata' || p === '/api/frontend/settings';
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

  // Short-circuit the authenticated-only app-platform resource APIs (/apis/*.grafana.app).
  // A public dashboard can never authenticate to these; Grafana returns 401 and the SPA
  // falls back to bootdata. Return that 401 directly instead of a wasted upstream hop.
  if (isUnauthenticatedResourceApi(url.pathname)) {
    return new Response('{"message":"Unauthorized"}', {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
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

  // For the boot/settings JSON, rewrite the body to disable every third-party analytics +
  // telemetry integration (GA, Rudderstack/FullStory, Grafana's embedded Faro). These are
  // what the browser's shields block with ERR_BLOCKED_BY_CLIENT / "Tracking Prevention"
  // console errors; removing them from the config stops the SPA ever requesting them. We
  // must buffer the body (not stream) to rewrite it, which is fine — these payloads are
  // small and fetched once at boot.
  if (isBootOrSettings(url.pathname) && upstream.status === 200) {
    const original = await upstream.text();
    const rewritten = stripAnalyticsFromJson(original);
    return new Response(rewritten, { status: upstream.status, headers: resHeaders });
  }

  // The SPA fetches with ROOT-absolute paths (/api, /public, /avatar) which we proxy at the
  // Worker root, and its static assets load from Grafana's absolute CDN. So the document can
  // be served as-is; no <base href> rewrite is needed. We only strip the frame headers.
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}
