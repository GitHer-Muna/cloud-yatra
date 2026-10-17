/**
 * localLeaderboard.ts — a zero-backend, zero-cost leaderboard kept in the browser's
 * localStorage. Used when no API is configured so the "Top Pilgrims" board is always a
 * real, working feature (your past runs persist and rank), not a dead "unavailable" box.
 *
 * It stores the top scores for this browser only. If/when a real backend is wired up,
 * the scene prefers the backend and this remains a graceful offline fallback.
 */
import type { LeaderboardEntry } from './leaderboardClient';

const STORAGE_KEY = 'cy_local_leaderboard_v1';
const MAX_ENTRIES = 50;

interface StoredEntry {
  score: number;
  name?: string;
  timeMs?: number;
  ts: number;
}

function read(): StoredEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r) => {
        const score = Number((r as StoredEntry)?.score);
        if (!Number.isFinite(score)) return null;
        const e: StoredEntry = { score, ts: Number((r as StoredEntry)?.ts) || 0 };
        const name = (r as StoredEntry)?.name;
        if (typeof name === 'string' && name.trim()) e.name = name.trim();
        const timeMs = Number((r as StoredEntry)?.timeMs);
        if (Number.isFinite(timeMs)) e.timeMs = timeMs;
        return e;
      })
      .filter((e): e is StoredEntry => e !== null);
  } catch {
    return [];
  }
}

/** Record a completed run. Returns the stable timestamp id of the saved entry (for
 * highlighting the player's own row even when scores tie). */
export function recordLocalScore(score: number, name?: string, timeMs?: number): number {
  const ts = Date.now();
  try {
    const entries = read();
    entries.push({ score, name: name?.trim() || undefined, timeMs, ts });
    entries.sort((a, b) => b.score - a.score || a.ts - b.ts);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage may be unavailable (private mode) — ignore */
  }
  return ts;
}

/** Top entries, score-descending, normalized for the UI. */
export function getLocalLeaderboard(): LeaderboardEntry[] {
  return read()
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .map((e) => ({ score: e.score, name: e.name, timeMs: e.timeMs }));
}
