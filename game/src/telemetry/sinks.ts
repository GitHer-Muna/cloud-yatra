/**
 * sinks.ts — where telemetry events GO.
 *
 * A "sink" receives validated events. Keeping sinks small and swappable is the key
 * idea: gameplay always calls the same service; we change only the sink to change
 * destination (console/memory today; a networked batch sender to the backend later).
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
 * HttpBatchSink — buffers events and POSTs them to the backend `/event` endpoint in
 * small batches. This is what feeds the real backend → CloudWatch/custom metrics →
 * Grafana Cloud dashboard.
 *
 * Design goals:
 *  - NON-BLOCKING: never awaited from the render loop; failures are swallowed (telemetry
 *    must never break gameplay). Fire-and-forget fetch with keepalive.
 *  - BATCHED: flush on a timer, when the buffer reaches maxBatch, or on page hide/unload.
 *  - SHAPE MATCHES SERVER: sends `{ events: TelemetryEvent[] }`, which the /event Lambda
 *    re-validates (see backend/src/lib/validate.ts).
 *  - RESILIENT: on a failed flush, events are requeued (bounded) for the next attempt.
 *  - UNLOAD-SAFE: uses navigator.sendBeacon on pagehide so the last batch isn't lost.
 */
export class HttpBatchSink implements TelemetrySink {
  private buffer: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private disabled = false;

  constructor(
    private readonly endpoint: string, // full URL to POST, e.g. `${API}/event`
    private readonly opts: {
      maxBatch?: number;
      flushIntervalMs?: number;
      maxQueue?: number;
      maxFailures?: number;
    } = {},
  ) {
    const flushIntervalMs = opts.flushIntervalMs ?? 3000;
    // Periodic flush.
    this.timer = setInterval(() => void this.flush(), flushIntervalMs);
    // Best-effort flush when the tab is hidden or closed.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushBeacon());
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushBeacon();
      });
    }
  }

  emit(event: TelemetryEvent): void {
    if (this.disabled) return; // circuit open → drop silently (gameplay unaffected)
    const maxQueue = this.opts.maxQueue ?? 200;
    this.buffer.push(event);
    if (this.buffer.length > maxQueue) this.buffer.splice(0, this.buffer.length - maxQueue);
    if (this.buffer.length >= (this.opts.maxBatch ?? 20)) void this.flush();
  }

  /** Send the current buffer as one batch. Requeues on failure (bounded). */
  async flush(): Promise<void> {
    if (this.disabled || this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.opts.maxBatch ?? 20);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
      if (res.ok || res.status < 500) {
        this.failures = 0; // success (or a 4xx we shouldn't retry) → healthy
      } else {
        this.requeue(batch); // 5xx → retry
        this.noteFailure();
      }
    } catch {
      this.requeue(batch); // network/CORS error → retry next tick
      this.noteFailure();
    }
  }

  /**
   * Circuit breaker: after too many consecutive failures (e.g. CORS/offline), stop
   * sending so we don't hammer a broken endpoint or flood the console. Telemetry is
   * best-effort and must never degrade gameplay.
   */
  private noteFailure(): void {
    this.failures += 1;
    if (this.failures >= (this.opts.maxFailures ?? 5)) {
      this.disabled = true;
      this.buffer.length = 0;
      // eslint-disable-next-line no-console
      console.info('[telemetry] network sink disabled after repeated failures (gameplay unaffected).');
    }
  }

  /** Synchronous best-effort flush for page unload (fetch may be cancelled otherwise). */
  private flushBeacon(): void {
    if (
      this.disabled ||
      this.buffer.length === 0 ||
      typeof navigator === 'undefined' ||
      !navigator.sendBeacon
    ) {
      return;
    }
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const blob = new Blob([JSON.stringify({ events: batch })], { type: 'application/json' });
      const ok = navigator.sendBeacon(this.endpoint, blob);
      if (!ok) this.requeue(batch);
    } catch {
      this.requeue(batch);
    }
  }

  private requeue(batch: TelemetryEvent[]): void {
    const maxQueue = this.opts.maxQueue ?? 200;
    this.buffer = [...batch, ...this.buffer].slice(0, maxQueue);
  }

  /** For tests/teardown. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
