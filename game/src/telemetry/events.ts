/**
 * events.ts — the game's TELEMETRY VOCABULARY (schema as code).
 *
 * Defines the shared ENVELOPE and per-event ATTRIBUTES as strongly-typed TS. It
 * mirrors `.kiro/specs/cloud-yatra/design.md §4`. Events are created and enriched by
 * TelemetryService; this file also provides `validateEvent()` so malformed telemetry
 * is caught locally and never crashes gameplay.
 *
 * No network, no Grafana, no external dependencies here.
 */

/** Bump when the event shape changes in a breaking way. */
export const SCHEMA_VERSION = 1;

export type EventType =
  | 'game_started'
  | 'game_over'
  | 'level_started'
  | 'player_jump'
  | 'collectible_collected'
  | 'player_damaged'
  | 'player_died'
  | 'flag_planted'
  | 'level_completed'
  | 'game_restarted'
  | 'obstacle_cut'
  | 'player_stomp'
  | 'session_heartbeat' // low-volume liveness ping (~15s) for active-sessions/duration panels
  | 'client_perf'; // sampled FPS (not per-frame)

/** Per-event attribute shapes (discriminated union on `type`). */
export type EventAttrs =
  | { type: 'game_started'; loadMs?: number }
  | { type: 'game_over'; reason: 'died' | 'quit' | 'completed'; score: number; durationMs?: number }
  | { type: 'level_started'; attempt?: number }
  | { type: 'player_jump'; x: number; y: number }
  | { type: 'collectible_collected'; kind: string; total: number; points?: number }
  | { type: 'player_damaged'; cause: string; livesLeft: number; x?: number; y?: number }
  | { type: 'player_died'; cause: string; x?: number; y?: number }
  | { type: 'flag_planted'; checkpoint: number }
  | { type: 'level_completed'; score: number; timeMs: number; name?: string }
  | { type: 'game_restarted'; fromReason?: 'died' | 'completed' | 'manual' }
  | { type: 'obstacle_cut'; kind: string; total: number; points?: number }
  | { type: 'player_stomp'; total: number; points?: number }
  | { type: 'session_heartbeat'; uptimeMs: number }
  | { type: 'client_perf'; avgFps: number };

/** The common envelope wrapped around every event. */
export interface EventEnvelope {
  schemaVersion: number;
  type: EventType;
  sessionId: string; // anonymous, per-tab. LOG/TRACE field only — never a metric label.
  levelId: string | null;
  ts: number; // epoch millis (wall clock)
  tMs: number; // ms since load (monotonic, for ordering)
  playerId: string | null; // opt-in only
  correlationId: string | null;
}

/** A fully-formed telemetry event = envelope + event-specific attrs. */
export type TelemetryEvent = EventEnvelope & { attrs: Omit<EventAttrs, 'type'> };

export const EVENT_TYPES: readonly EventType[] = [
  'game_started',
  'game_over',
  'level_started',
  'player_jump',
  'collectible_collected',
  'player_damaged',
  'player_died',
  'flag_planted',
  'level_completed',
  'game_restarted',
  'obstacle_cut',
  'player_stomp',
  'session_heartbeat',
  'client_perf',
];

/** Max serialized size (bytes) accepted — defensive against bloat/abuse. */
export const MAX_EVENT_BYTES = 2048;

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Basic, non-throwing validation. Returns ok/false + a reason. Callers DROP invalid
 * events (and may count them) rather than crash the game.
 */
export function validateEvent(e: unknown): ValidationResult {
  if (typeof e !== 'object' || e === null) return { ok: false, reason: 'not_an_object' };
  const ev = e as Partial<EventEnvelope> & { attrs?: unknown };

  if (ev.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: 'bad_schema_version' };
  if (typeof ev.type !== 'string' || !EVENT_TYPES.includes(ev.type as EventType)) {
    return { ok: false, reason: 'unknown_type' };
  }
  if (typeof ev.sessionId !== 'string' || ev.sessionId.length < 8) {
    return { ok: false, reason: 'bad_session_id' };
  }
  if (!isFiniteNumber(ev.ts) || !isFiniteNumber(ev.tMs)) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  if (!(ev.levelId === null || typeof ev.levelId === 'string')) {
    return { ok: false, reason: 'bad_level_id' };
  }
  if (typeof ev.attrs !== 'object' || ev.attrs === null) {
    return { ok: false, reason: 'missing_attrs' };
  }
  try {
    if (JSON.stringify(ev).length > MAX_EVENT_BYTES) return { ok: false, reason: 'too_large' };
  } catch {
    return { ok: false, reason: 'not_serializable' };
  }
  return { ok: true };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
