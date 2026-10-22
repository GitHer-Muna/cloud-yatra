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

/** The opt-in anonymous playerId, or null if not opted in. Never auto-created. */
export function getOptionalPlayerId(): string | null {
  try {
    return globalThis.localStorage?.getItem(PLAYER_ID_KEY) ?? null;
  } catch {
    return null;
  }
}

