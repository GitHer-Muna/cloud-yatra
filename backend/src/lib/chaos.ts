/**
 * chaos.ts (lib) — Phase 7 Chaos Mode shared logic.
 *
 * WHAT CHAOS MODE IS: an admin-gated switch that makes OUR OWN backend inject temporary
 * latency and errors for a short window (~60s, auto-expiring) so the Grafana dashboard
 * visibly reacts — rising latency + 5xx rate — then recovers on its own. It is
 * SELF-ONLY: it never touches any external service, and it only degrades Cloud Yatra's
 * own request handling. Strictly bounded and auto-recovering.
 *
 * STATE: a single DynamoDB item (PK=CHAOS#STATE, SK=CURRENT) holds the active window's
 * end time. `expiresAt` doubles as a DynamoDB TTL attribute so a forgotten window is
 * reaped automatically even if /chaos/stop is never called.
 *
 * DESIGN: the INJECTION DECISION is a pure function (injectionFor) so it is fully unit
 * testable without AWS. The state read/write wrap DynamoDB and fail OPEN (no chaos) on
 * any error — chaos must never break normal play or leak internal errors.
 */
import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './db';

export const CHAOS_PK = 'CHAOS#STATE';
export const CHAOS_SK = 'CURRENT';

/** Default chaos window length (seconds) if the caller doesn't specify one. */
export const DEFAULT_CHAOS_SECONDS = 60;
/** Hard cap on a chaos window so an admin can't accidentally run it forever. */
export const MAX_CHAOS_SECONDS = 120;

/** Added latency per affected request, in ms. */
export const CHAOS_LATENCY_MS = 1200;
/** Probability (0..1) a given request gets extra latency while chaos is active. */
export const CHAOS_LATENCY_RATE = 0.7;
/** Probability (0..1) a given request fails with 503 while chaos is active. */
export const CHAOS_ERROR_RATE = 0.3;

export interface ChaosState {
  active: boolean;
  until: number; // epoch ms when the window ends (0 when inactive)
}

export interface Injection {
  delayMs: number; // extra latency to apply before responding (0 = none)
  fail: boolean; // whether to short-circuit with a 503
}

/**
 * Pure decision: given the chaos state and two random rolls (0..1), decide what to
 * inject. Deterministic for a given input, so it is unit-testable. `rErr` decides a
 * forced error; `rLat` decides added latency. Error takes precedence (no point delaying
 * a request we're about to fail).
 */
export function injectionFor(
  state: ChaosState,
  now: number,
  rErr: number,
  rLat: number,
): Injection {
  if (!state.active || now >= state.until) return { delayMs: 0, fail: false };
  if (rErr < CHAOS_ERROR_RATE) return { delayMs: 0, fail: true };
  if (rLat < CHAOS_LATENCY_RATE) return { delayMs: CHAOS_LATENCY_MS, fail: false };
  return { delayMs: 0, fail: false };
}

/** Clamp a requested window length to the allowed range. */
export function clampSeconds(seconds: unknown): number {
  const n = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.floor(seconds) : DEFAULT_CHAOS_SECONDS;
  return Math.max(1, Math.min(MAX_CHAOS_SECONDS, n));
}

/** Read the current chaos state. Fails OPEN (inactive) on any error. */
export async function getChaosState(now = Date.now()): Promise<ChaosState> {
  try {
    const res = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: CHAOS_PK, SK: CHAOS_SK } }),
    );
    const until = Number(res.Item?.until ?? 0);
    return { active: until > now, until: until > now ? until : 0 };
  } catch {
    return { active: false, until: 0 };
  }
}

/** Start a chaos window of `seconds`. Returns the window end time (epoch ms). */
export async function startChaos(seconds: number, now = Date.now()): Promise<number> {
  const until = now + clampSeconds(seconds) * 1000;
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: CHAOS_PK,
        SK: CHAOS_SK,
        until,
        startedAt: now,
        // TTL (epoch SECONDS): reap the item shortly after the window ends even if
        // /chaos/stop is never called. Padded so TTL never cuts a window short.
        expiresAt: Math.floor(until / 1000) + 300,
      },
    }),
  );
  return until;
}

/** Stop chaos immediately by deleting the state item. */
export async function stopChaos(): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: CHAOS_PK, SK: CHAOS_SK } }),
  );
}

/** Small promise sleep used to apply injected latency. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Apply chaos to a request handler path. Reads state, rolls the dice, and either:
 *  - returns { fail: true } so the caller responds 503 (a self-inflicted error), or
 *  - sleeps for the injected latency and returns { fail: false }.
 * Never throws. When chaos is inactive this is a single cheap DynamoDB GET.
 */
export async function applyChaos(now = Date.now()): Promise<{ fail: boolean; delayedMs: number }> {
  const state = await getChaosState(now);
  if (!state.active) return { fail: false, delayedMs: 0 };
  const decision = injectionFor(state, now, Math.random(), Math.random());
  if (decision.fail) return { fail: true, delayedMs: 0 };
  if (decision.delayMs > 0) {
    await sleep(decision.delayMs);
    return { fail: false, delayedMs: decision.delayMs };
  }
  return { fail: false, delayedMs: 0 };
}
