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
import { initializeFaro, getWebInstrumentations, type Faro } from '@grafana/faro-web-sdk';

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
    instrumentations: [
      // Errors, web vitals, session, console, etc. (Faro's standard web set.)
      ...getWebInstrumentations(),
    ],
  });
  return faro;
}

/** The active Faro instance, or null if not initialized. */
export function getFaro(): Faro | null {
  return faro;
}
