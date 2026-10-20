/**
 * api.ts — the browser's thin client for the optional Cloud Yatra backend Worker.
 *
 * The game works with NO backend: if VITE_API_BASE_URL is empty, apiBase() returns null
 * and every helper here falls back to the local, offline-safe behavior. When a backend IS
 * configured, these helpers talk to the Cloudflare Worker (telemetry ingest + a real,
 * shared, cross-player leaderboard) while keeping the local board as a resilient fallback.
 *
 * No secrets: the API base URL is public client config, like the Faro collector URL.
 */
import {
  getRankedBoard,
  recordLocalScore,
  type RankedEntry,
} from './localLeaderboard';

/** The configured backend base URL (no trailing slash), or null when unconfigured. */
export function apiBase(): string | null {
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const raw = env.VITE_API_BASE_URL;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

/** True when a backend is configured for this build. */
export function hasBackend(): boolean {
  return apiBase() !== null;
}

interface RemoteEntry {
  name?: string;
  score: number;
  timeMs?: number | null;
  country?: string | null;
}

/**
 * Fetch the shared leaderboard from the backend, MERGED with the local board + legends so
 * the player's own offline runs still appear. On any failure (offline, Worker down, CORS),
 * silently fall back to the purely local board — the board is never broken.
 */
export async function fetchLeaderboard(limit = 20, timeoutMs = 2500): Promise<RankedEntry[]> {
  const base = apiBase();
  const local = getRankedBoard();
  if (!base) return local;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/leaderboard?limit=${encodeURIComponent(limit)}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return local;
    const body = (await res.json()) as { entries?: RemoteEntry[] };
    const remote: RankedEntry[] = (body.entries ?? [])
      .filter((e) => Number.isFinite(e.score))
      .map((e) => ({ name: e.name, score: e.score, timeMs: e.timeMs ?? undefined }));

    // Merge remote (shared) with local legends so a fresh global board still has targets,
    // de-duplicating by name+score so the player's own submitted run isn't shown twice.
    const seen = new Set<string>();
    const merged: RankedEntry[] = [];
    for (const e of [...remote, ...local]) {
      const key = `${(e.name ?? '').toLowerCase()}|${e.score}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
    return merged.sort((a, b) => b.score - a.score);
  } catch {
    return local;
  }
}

/**
 * Submit a completed run to the backend (best-per-name) AND always record it locally so
 * the player's run persists offline. Fire-and-forget to the network; never blocks or
 * throws into gameplay.
 */
export function submitScore(
  score: number,
  name?: string,
  timeMs?: number,
  levelId?: string | null,
  sessionId?: string | null,
): void {
  // Always keep the local record (offline-safe, and used in the merged board).
  recordLocalScore(score, name, timeMs);

  const base = apiBase();
  if (!base || !name) return;

  const payload = JSON.stringify({ name, score, timeMs, levelId, sessionId });
  // Prefer sendBeacon so the submit survives the scene transition / page hide.
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(`${base}/score`, blob)) return;
    }
  } catch {
    /* fall through to fetch */
  }
  void fetch(`${base}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}
