/**
 * sinks.ts — where telemetry events GO.
 *
 * A "sink" receives validated events. Keeping sinks small and swappable is the key
 * idea: gameplay always calls the same service; we change only the sink to change
 * destination (console/memory in development and Faro in the browser).
 *
 * No network code here yet — nothing sends off-device.
 */
import type { TelemetryEvent } from './events';
import type { Faro } from '@grafana/faro-web-sdk';

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
  flush?(): Promise<void> | void;
}

/** Logs every event to the browser console — default during development. */
export class ConsoleSink implements TelemetrySink {
  emit(event: TelemetryEvent): void {
    // eslint-disable-next-line no-console
    console.log('[telemetry]', event.type, event);
  }
}

/** Keeps events in memory — perfect for local tests (assert on `sink.events`). */
export class MemorySink implements TelemetrySink {
  readonly events: TelemetryEvent[] = [];
  emit(event: TelemetryEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
}

/** Fan out to several sinks at once (e.g., console + memory, or console + network later). */
export class MultiSink implements TelemetrySink {
  constructor(private readonly sinks: TelemetrySink[]) {}
  emit(event: TelemetryEvent): void {
    for (const sink of this.sinks) sink.emit(event);
  }
  async flush(): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.flush?.()));
  }
}

/**
 * FaroSink — forwards validated events to Grafana Faro (frontend RUM → Grafana Cloud).
 *
 *  - Gameplay events → `faro.api.pushEvent(name, attributes)`. Faro attributes are
 *    string→string, so we stringify values and keep them small/low-cardinality.
 *  - Sampled FPS (`client_perf`) → `faro.api.pushMeasurement` as a numeric value so it
 *    can be charted as a metric-like signal.
 *
 * The Faro instance is injected; if it's null (no public key configured) this sink is
 * simply never constructed — see main.ts. No secrets here (Faro keys are public).
 */
export class FaroSink implements TelemetrySink {
  constructor(private readonly faro: Faro) {}

  emit(event: TelemetryEvent): void {
    if (event.type === 'client_perf') {
      const attrs = event.attrs as { avgFps?: number };
      if (typeof attrs.avgFps === 'number') {
        this.faro.api.pushMeasurement(
          {
            type: 'game_client_perf',
            values: { fps: attrs.avgFps },
          },
          { context: { level: String(event.levelId ?? 'unknown') } },
        );
      }
      return;
    }

    if (event.type === 'session_heartbeat') {
      const attrs = event.attrs as {
        uptimeMs?: number;
        score?: number;
        progressPct?: number;
        lives?: number;
        combo?: number;
      };
      const values: Record<string, number> = {};
      for (const [key, value] of Object.entries(attrs)) {
        if (typeof value === 'number' && Number.isFinite(value)) values[key] = value;
      }
      if (Object.keys(values).length > 0) {
        this.faro.api.pushMeasurement(
          { type: 'game_state', values },
          { context: { level: String(event.levelId ?? 'unknown') } },
        );
      }
    }

    // Flatten attrs to string values (Faro event attributes are strings). The `gameplay`
    // domain lets Grafana distinguish our bounded game signals from Faro's auto-RUM events.
    const attributes: Record<string, string> = {
      level: String(event.levelId ?? ''),
      session: event.sessionId, // log/trace field via Faro session, NOT a metric label
    };
    for (const [k, v] of Object.entries(event.attrs as Record<string, unknown>)) {
      attributes[k] = String(v);
    }
    this.faro.api.pushEvent(event.type, attributes, 'gameplay');
  }
}


/**
 * HttpBatchSink — forwards validated events to the Cloud Yatra backend Worker (which
 * persists them in Cloudflare D1 and emits backend logs/metrics/traces to Grafana).
 *
 * Design for a game loop:
 *   - BATCHES events (default up to 20, or every ~4s) so we make few, small requests and
 *     stay well inside Cloudflare's free tier. No per-frame requests ever.
 *   - OFFLINE-SAFE: a failed send simply drops that batch (telemetry is best-effort); it
 *     NEVER throws into gameplay and NEVER blocks. The game plays identically if the
 *     backend is down or unreachable.
 *   - flush() uses sendBeacon when possible so the final batch survives the page hiding
 *     (e.g. the victory → leaderboard transition).
 *
 * The base URL is injected (public config); if null this sink is simply never constructed.
 */
export class HttpBatchSink implements TelemetrySink {
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly maxBatch = 20,
    private readonly flushIntervalMs = 4000,
  ) {}

  emit(event: TelemetryEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxBatch) {
      void this.send();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => void this.send(), this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    await this.send(true);
  }

  private async send(useBeacon = false): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.maxBatch);
    const url = `${this.baseUrl}/events`;
    const payload = JSON.stringify({ events: batch });

    if (useBeacon) {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([payload], { type: 'application/json' });
          if (navigator.sendBeacon(url, blob)) return;
        }
      } catch {
        /* fall through to fetch */
      }
    }

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      });
    } catch {
      // Best-effort telemetry: drop the batch on any network failure. Never surface.
    }
  }
}
