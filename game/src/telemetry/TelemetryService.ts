/**
 * TelemetryService.ts — the ONE place gameplay code talks to for telemetry.
 *
 *  1. Owns anonymous CONTEXT: sessionId (per load), optional playerId, current levelId.
 *  2. ENRICHES each event with the full envelope (schemaVersion, ids, timestamps).
 *  3. VALIDATES the event; invalid events are dropped + counted, never thrown.
 *  4. FORWARDS valid events to a pluggable SINK (console today, network later).
 *
 * Centralizing enrichment/validation keeps call sites tiny and guarantees every event
 * is well-formed and privacy-safe the same way. No network, no Grafana credentials.
 */
import { SCHEMA_VERSION, validateEvent, type EventAttrs, type TelemetryEvent } from './events';
import { getSessionId, getOptionalPlayerId } from './ids';
import { ConsoleSink, type TelemetrySink } from './sinks';

export class TelemetryService {
  private readonly sessionId: string;
  private readonly playerId: string | null;
  private readonly startedAtMs: number;
  private readonly now: () => number;
  private levelId: string | null = null;
  private droppedCount = 0;

  constructor(
    private readonly sink: TelemetrySink = new ConsoleSink(),
    now: () => number = () => performance.now(),
  ) {
    this.sessionId = getSessionId();
    this.playerId = getOptionalPlayerId(); // null unless opted in
    this.now = now;
    this.startedAtMs = now();
  }

  getSessionId(): string {
    return this.sessionId;
  }
  sinceStartMs(): number {
    return Math.round(this.now() - this.startedAtMs);
  }
  getDroppedCount(): number {
    return this.droppedCount;
  }
  setLevel(levelId: string | null): void {
    this.levelId = levelId;
  }

  /** Best-effort bounded flush used before the post-victory leaderboard opens. */
  async flush(timeoutMs = 1500): Promise<void> {
    const flush = this.sink.flush?.();
    if (!flush) return;
    await Promise.race([
      Promise.resolve(flush),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /** Build the envelope, validate, forward. Returns true if accepted. */
  record(attrs: EventAttrs, correlationId: string | null = null): boolean {
    const { type, ...rest } = attrs;
    const event: TelemetryEvent = {
      schemaVersion: SCHEMA_VERSION,
      type,
      sessionId: this.sessionId,
      levelId: this.levelId,
      ts: Date.now(),
      tMs: Math.round(this.now() - this.startedAtMs),
      playerId: this.playerId,
      correlationId,
      attrs: rest,
    };

    const result = validateEvent(event);
    if (!result.ok) {
      this.droppedCount += 1;
      // eslint-disable-next-line no-console
      console.warn('[telemetry] dropped invalid event:', result.reason, type);
      return false;
    }
    this.sink.emit(event);
    return true;
  }
}
