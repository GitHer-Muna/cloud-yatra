/**
 * validate.ts — server-side validation of incoming telemetry events.
 *
 * MIRRORS the client schema (game/src/telemetry/events.ts). We NEVER trust the client:
 * the backend re-validates every event and rejects malformed ones. Kept intentionally
 * small and dependency-free.
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
  'client_perf',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const MAX_EVENT_BYTES = 2048;
export const MAX_BATCH = 50; // reject oversized batches (abuse/cost guard)

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateEvent(e: unknown): ValidationResult {
  if (typeof e !== 'object' || e === null) return { ok: false, reason: 'not_an_object' };
  const ev = e as Record<string, unknown>;

  if (ev.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: 'bad_schema_version' };
  if (typeof ev.type !== 'string' || !EVENT_TYPES.includes(ev.type as EventType)) {
    return { ok: false, reason: 'unknown_type' };
  }
  if (typeof ev.sessionId !== 'string' || ev.sessionId.length < 8 || ev.sessionId.length > 64) {
    return { ok: false, reason: 'bad_session_id' };
  }
  if (!isFinite_(ev.ts) || !isFinite_(ev.tMs)) return { ok: false, reason: 'bad_timestamp' };
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

/** Validate a batch { events: [...] }. Returns accepted events + counts. */
export function validateBatch(body: unknown): {
  ok: boolean;
  reason?: string;
  accepted: Record<string, unknown>[];
  dropped: number;
} {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, reason: 'bad_body', accepted: [], dropped: 0 };
  }
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) return { ok: false, reason: 'events_not_array', accepted: [], dropped: 0 };
  if (events.length === 0) return { ok: false, reason: 'empty_batch', accepted: [], dropped: 0 };
  if (events.length > MAX_BATCH) return { ok: false, reason: 'batch_too_large', accepted: [], dropped: 0 };

  const accepted: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const ev of events) {
    if (validateEvent(ev).ok) accepted.push(ev as Record<string, unknown>);
    else dropped += 1;
  }
  return { ok: true, accepted, dropped };
}

function isFinite_(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
