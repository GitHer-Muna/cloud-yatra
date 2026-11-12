/**
 * faro.ts — initialize Grafana Faro Web SDK for Real User Monitoring (RUM).
 *
 * WHAT FARO GIVES US (out of the box via getWebInstrumentations):
 *   - uncaught JS errors + unhandled promise rejections
 *   - web vitals (LCP, CLS, INP, ...)
 *   - session + page meta
 * PLUS we forward our own gameplay events + sampled FPS via a FaroSink (see sinks).
 *
 * PUBLIC-BY-DESIGN: Faro's collector URL and app key are PUBLIC browser config (not
 * secrets) — they only allow WRITING RUM data to your app receiver. They come from
 * `VITE_FARO_URL` / `VITE_FARO_APP_KEY`, injected at build time by Vite.
 *
 * INERT WHEN UNSET: if the env vars are missing (local dev without a key), initFaro()
 * returns null and the game runs normally with console telemetry only — nothing is
 * sent anywhere. This lets us build/verify without a Grafana account and switch it on
 * later by just supplying the public key.
 */
import { initializeFaro, getWebInstrumentations, InternalLoggerLevel, type Faro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';
import { ReplayInstrumentation } from '@grafana/faro-instrumentation-replay';

let faro: Faro | null = null;

/** Initialize Faro if a public collector URL is configured; otherwise stay inert. */
export function initFaro(appVersion = '0.1.0'): Faro | null {
  // Vite exposes VITE_* vars on import.meta.env. Guard for non-Vite (test) contexts.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const url = env.VITE_FARO_URL;
  const appKey = env.VITE_FARO_APP_KEY;

  if (!url) {
    // No public receiver configured → do nothing (dev/local). Not an error.
    return null;
  }

  faro = initializeFaro({
    url,
    apiKey: appKey, // public app key (optional depending on receiver config)
    app: {
      name: 'cloud-yatra',
      version: appVersion,
      environment: env.MODE ?? 'development',
    },
    // Don't trace/instrument the embedded Grafana dashboard's own proxied traffic. Faro
    // already auto-ignores its collector URL (the Worker `/faro` path); these patterns add
    // the dashboard reverse-proxy paths so the dashboard iframe's internal requests aren't
    // captured as the game's RUM. Patterns are matched against the full request URL.
    // Faro's own diagnostics ("Delivery retries exhausted", "Permanent delivery failure")
    // go to the player's console whenever a network or ad-blocker drops a batch. RUM is
    // best-effort; keep the console clean for players.
    internalLoggerLevel: InternalLoggerLevel.OFF,
    // Drop RUM items while offline instead of retrying (and spamming the console).
    beforeSend: (item) => (typeof navigator !== 'undefined' && navigator.onLine === false ? null : item),
    ignoreUrls: [/\/dash(\/|$)/, /\/public-dashboards\//, /\/apis\/.*\.grafana\.app/],
    instrumentations: [
      // Errors, web vitals, session, console, etc. (Faro's standard web set.)
      ...getWebInstrumentations(),
      // HTTP/XHR tracing adds browser request timing and trace correlation. Faro auto-
      // excludes its OWN collector URL (now the Worker's first-party `/faro` path) from
      // tracing, derived from the configured transport — so ingest isn't self-traced. The
      // config-level `ignoreUrls` below additionally excludes the dashboard-proxy traffic.
      new TracingInstrumentation(),
      // Replay is intentionally sampled (10%) and records the page DOM (HUD overlays,
      // dashboard, Chaos panel). Canvas recording is OFF: rrweb captures every WebGL draw
      // call of the Phaser canvas with no sampling, producing multi-MB batches that the
      // collector rejects with 413 (console errors + lost RUM). All form/input text is masked.
      new ReplayInstrumentation({
        maskAllInputs: true,
        maskTextSelector: '.grafana-mask, [contenteditable]',
        blockSelector: '.grafana-block, input[type="hidden"]',
        ignoreSelector: '.grafana-ignore',
        recordCanvas: false,
        samplingRate: 0.1,
        inactivityThresholdMs: 60000,
        recordAfter: 'DOMContentLoaded',
        sanitizeMetaHref: true,
        // Belt and braces: never ship a single replay event larger than 256 KB.
        beforeSend: (event) => (JSON.stringify(event).length > 256_000 ? null : event),
      }),
    ],
  });
  return faro;
}

/** The active Faro instance, or null if not initialized. */
export function getFaro(): Faro | null {
  return faro;
}
