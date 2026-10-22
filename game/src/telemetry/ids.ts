/**
 * ids.ts — anonymous identifiers for telemetry.
 *
 * PRIVACY FIRST:
 *  - `sessionId`: random UUID created fresh each page load; memory only; not a person.
 *  - `playerId`: OPTIONAL, OFF by default; only read from localStorage if present. Never
 *    auto-created, and never a real identity.
 *
 * We never collect names, emails, IPs, or browser fingerprints here.
 */

/** RFC-4122-ish v4 UUID. Uses web crypto when available, falls back for tests. */
export function createUuid(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const PLAYER_ID_KEY = 'cloud-yatra.playerId';
const SESSION_ID_KEY = 'cloud-yatra.sessionId';

/**
 * The anonymous per-tab session id, shared by the telemetry pipeline AND the embedded
 * Grafana dashboard (which reads the same sessionStorage key to filter "Your Run" panels).
 *
 * It is created once per tab and persisted in sessionStorage so that:
 *  - every telemetry event in this tab carries the SAME session id, and
 *  - the dashboard iframe can be told exactly which run to show (var-session=<id>).
 *
 * sessionStorage is per-tab and cleared when the tab closes — still anonymous, still not a
 * person. Falls back to an in-memory id if sessionStorage is unavailable (e.g. tests).
 */
let memorySessionId: string | null = null;
export function getSessionId(): string {
  try {
    const store = globalThis.sessionStorage;
    if (store) {
      const existing = store.getItem(SESSION_ID_KEY);
      if (existing && existing.length >= 8) return existing;
      const fresh = createUuid();
      store.setItem(SESSION_ID_KEY, fresh);
      return fresh;
    }
  } catch {
    /* sessionStorage blocked (private mode / tests) → fall back to memory */
  }
  if (!memorySessionId) memorySessionId = createUuid();
  return memorySessionId;
}

/** The opt-in anonymous playerId, or null if not opted in. Never auto-created. */
export function getOptionalPlayerId(): string | null {
  try {
    return globalThis.localStorage?.getItem(PLAYER_ID_KEY) ?? null;
  } catch {
    return null;
  }
}

