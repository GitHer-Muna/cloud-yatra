/**
 * leaderboardClient.ts — tiny, non-throwing client for the public leaderboard.
 *
 *  - fetchLeaderboard(): GET `${base}/leaderboard?level=…`, returns a normalized,
 *    score-descending array. Never throws — returns [] on any failure/timeout.
 *  - submitScore(): POST a `level_completed` event batch to `${base}/ingest`.
 *    Fire-and-forget; swallows all errors so gameplay is never blocked.
 *
 * Both use a short timeout so a slow/broken backend can't hang the UI.
 */

import { SCHEMA_VERSION } from './events';

/** A normalized leaderboard row as consumed by the UI. */
export interface LeaderboardEntry {
  score: number;
  name?: string;
  timeMs?: number;
}

/** Raw shape the backend returns from GET /leaderboard. */
interface RawLeaderboardResponse {
  level?: string;
  entries?: Array<{ score?: unknown; timeMs?: unknown; ts?: unknown; name?: unknown }>;
}

const DEFAULT_TIMEOUT_MS = 6000;

/** fetch() with an AbortController timeout. Never throws for timeouts here. */
function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function trimBase(base: string): string {
  return (base ?? '').replace(/\/$/, '');
}

/**
 * Fetch the top pilgrims for a level, normalized and sorted score-descending.
 * Returns [] on any error (missing base, network failure, timeout, bad JSON).
 */
export type LeaderboardFetchStatus = 'ok' | 'empty' | 'unavailable';

export interface LeaderboardFetchResult {
  entries: LeaderboardEntry[];
  status: LeaderboardFetchStatus;
}

export async function fetchLeaderboardStatus(
  base: string,
  level = 'himal_rajya',
): Promise<LeaderboardFetchResult> {
  const trimmed = trimBase(base);
  if (!trimmed) return { entries: [], status: 'unavailable' };
  try {
    const url = `${trimmed}/leaderboard?level=${encodeURIComponent(level)}`;
    const res = await fetchWithTimeout(url, { method: 'GET' });
    if (!res.ok) return { entries: [], status: 'unavailable' };
    const data = (await res.json()) as RawLeaderboardResponse;
    const rows = Array.isArray(data?.entries) ? data.entries : [];
    const normalized: LeaderboardEntry[] = rows
      .map((r) => {
        const score = Number(r?.score);
        if (!Number.isFinite(score)) return null;
        const entry: LeaderboardEntry = { score };
        if (typeof r?.name === 'string' && r.name.trim()) entry.name = r.name.trim();
        const timeMs = Number(r?.timeMs);
        if (Number.isFinite(timeMs)) entry.timeMs = timeMs;
        return entry;
      })
      .filter((e): e is LeaderboardEntry => e !== null);
    normalized.sort((a, b) => b.score - a.score);
    return { entries: normalized, status: normalized.length > 0 ? 'ok' : 'empty' };
  } catch {
    return { entries: [], status: 'unavailable' };
  }
}

export async function fetchLeaderboard(
  base: string,
  level = 'himal_rajya',
): Promise<LeaderboardEntry[]> {
  return (await fetchLeaderboardStatus(base, level)).entries;
}

/** Arguments for submitting a completed-run score. */
export interface SubmitScoreArgs {
  name?: string;
  score: number;
  timeMs?: number;
  sessionId: string;
}

/**
 * Post a `level_completed` event batch to /ingest. Non-blocking and error-swallowing:
 * a failed submit never surfaces to the caller.
 */
export async function submitScore(base: string, args: SubmitScoreArgs): Promise<void> {
  const trimmed = trimBase(base);
  if (!trimmed) return;
  try {
    const body = {
      events: [
        {
          schemaVersion: SCHEMA_VERSION,
          type: 'level_completed',
          sessionId: args.sessionId,
          ts: Date.now(),
          tMs: 0,
          levelId: 'himal_rajya',
          attrs: {
            score: args.score,
            timeMs: args.timeMs,
            name: args.name,
          },
        },
      ],
    };
    await fetchWithTimeout(`${trimmed}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Swallow — score submission is best-effort telemetry, never blocks the player.
  }
}
