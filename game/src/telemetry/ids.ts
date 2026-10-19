/**
 * ids.ts — anonymous identifiers for telemetry.
 *
 * PRIVACY FIRST:
 *  - `sessionId`: random UUID created fresh each page load; memory only; not a person.
 *  - `playerId`: OPTIONAL, OFF by default; only exists if the player explicitly opts in
 *    (random anonymous value in localStorage). Never a real identity.
 *  - `correlationId`: random short id available for local signal correlation.
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

/** A short random id (12 hex chars) for local signal correlation. */
export function createCorrelationId(): string {
  return createUuid().replace(/-/g, '').slice(0, 12);
}

const PLAYER_ID_KEY = 'cloud-yatra.playerId';

/** The opt-in anonymous playerId, or null if not opted in. Never auto-created. */
export function getOptionalPlayerId(): string | null {
  try {
    return globalThis.localStorage?.getItem(PLAYER_ID_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Explicitly opt in to a persistent anonymous playerId (call only from a user action). */
export function enablePlayerId(): string | null {
  try {
    let id = globalThis.localStorage?.getItem(PLAYER_ID_KEY) ?? null;
    if (!id) {
      id = createUuid();
      globalThis.localStorage?.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Forget the persistent playerId (privacy control). */
export function disablePlayerId(): void {
  try {
    globalThis.localStorage?.removeItem(PLAYER_ID_KEY);
  } catch {
    /* ignore */
  }
}
