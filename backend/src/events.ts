/**
 * events.ts — the SERVER-SIDE copy of the telemetry vocabulary + validation.
 *
 * Kept deliberately in sync with game/src/telemetry/events.ts so the Worker accepts
 * exactly the events the game emits and rejects anything malformed or oversized. This is
 * the trust boundary: never trust the client; validate every event here before writing.
 */
export const SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
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
  'journey_progress',
  'guru_guidance',
  'session_heartbeat',
  'client_perf',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** The common envelope wrapped around every event (matches the client). */
export interface EventEnvelope {
  schemaVersion: number;
  type: EventType;
  sessionId: string;
  levelId: string | null;
  ts: number;
  tMs: number;
  playerId: string | null;
  correlationId: string | null;
  attrs: Record<string, unknown>;
}

export const MAX_EVENT_BYTES = 2048;
export const MAX_BATCH = 100;

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Non-throwing validation. Callers reject invalid events with the reason. */
export function validateEvent(e: unknown): ValidationResult {
  if (typeof e !== 'object' || e === null) return { ok: false, reason: 'not_an_object' };
  const ev = e as Partial<EventEnvelope>;

  if (ev.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: 'bad_schema_version' };
  if (typeof ev.type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(ev.type)) {
    return { ok: false, reason: 'unknown_type' };
  }
  if (typeof ev.sessionId !== 'string' || ev.sessionId.length < 8 || ev.sessionId.length > 128) {
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

/** Safe numeric read from an attrs object (returns null if not a finite number). */
export function num(attrs: Record<string, unknown>, key: string): number | null {
  const v = attrs[key];
  return isFiniteNumber(v) ? v : null;
}

/** Safe short-string read (bounded length; returns null if missing/too long). */
export function str(attrs: Record<string, unknown>, key: string, max = 64): string | null {
  const v = attrs[key];
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}
