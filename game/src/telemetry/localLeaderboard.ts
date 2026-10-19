/**
 * localLeaderboard.ts — a zero-server, zero-cost leaderboard kept in the browser's
 * localStorage. Used when no API is configured so the "Top Pilgrims" board is always a
 * real, working feature (your past runs persist and rank), not a dead "unavailable" box.
 *
 * Competitive model (matches how arcade games present boards):
 *   • ONE best score per pilgrim name (case-insensitive). Playing many times under the
 *     same name keeps only your highest run — the board reads as "best pilgrims", so one
 *     player can't flood the top with repeat runs. Anonymous runs are kept individually.
 *   • A small set of built-in "legendary" scores seed the board so a brand-new player
 *     always has aspirational targets to chase (clearly just part of the challenge).
 *   • getRankedBoard() merges your scores with the legends into one ranked list, and
 *     findRank() tells you where a given score sits — used to pin a "you are here" row.
 *
 * It stores scores for THIS browser only (localStorage), so the board is always available
 * with no network dependency.
 */
export interface LeaderboardEntry {
  score: number;
  name?: string;
  timeMs?: number;
}

const STORAGE_KEY = 'cy_local_leaderboard_v1';
const MAX_ENTRIES = 50;

interface StoredEntry {
  score: number;
  name?: string;
  timeMs?: number;
  ts: number;
}

/**
 * Built-in aspirational scores so the board is never empty and always gives a new player
 * something to beat. Marked `legend: true` so the UI can style them subtly if desired.
 * These are part of the single-player challenge, not real other users.
 */
export interface RankedEntry extends LeaderboardEntry {
  legend?: boolean;
}

const LEGENDS: RankedEntry[] = [
  { name: 'Tenzing (legend)', score: 2600, legend: true },
  { name: 'Snow Leopard (legend)', score: 2100, legend: true },
  { name: 'Guru Megh (legend)', score: 1700, legend: true },
  { name: 'Hill Sherpa (legend)', score: 1200, legend: true },
  { name: 'Trail Novice (legend)', score: 700, legend: true },
];

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

function write(entries: StoredEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage may be unavailable (private mode) — ignore */
  }
}

/** Case-insensitive key used to keep only the best score per named pilgrim. */
function nameKey(name?: string): string | null {
  const n = name?.trim();
  return n ? n.toLowerCase() : null;
}

/**
 * Collapse stored runs to ONE best entry per name (highest score wins; ties keep the
 * earlier run). Anonymous runs (no name) are each kept as their own entry.
 */
function dedupeBestPerName(entries: StoredEntry[]): StoredEntry[] {
  const bestByName = new Map<string, StoredEntry>();
  const anon: StoredEntry[] = [];
  for (const e of entries) {
    const key = nameKey(e.name);
    if (key === null) {
      anon.push(e);
      continue;
    }
    const prev = bestByName.get(key);
    if (!prev || e.score > prev.score || (e.score === prev.score && e.ts < prev.ts)) {
      bestByName.set(key, e);
    }
  }
  return [...bestByName.values(), ...anon];
}

function byScoreThenTime(a: StoredEntry, b: StoredEntry): number {
  return b.score - a.score || a.ts - b.ts;
}

/**
 * Record a completed run. Keeps only the best score per name. Returns the stable
 * timestamp id of the saved entry (used by the scene to highlight the player's own row).
 */
export function recordLocalScore(score: number, name?: string, timeMs?: number): number {
  const ts = Date.now();
  const entries = read();
  entries.push({ score, name: name?.trim() || undefined, timeMs, ts });
  const deduped = dedupeBestPerName(entries).sort(byScoreThenTime);
  write(deduped);
  return ts;
}

/** This browser's stored scores (best-per-name), ranked. Excludes seeded legends. */
export function getLocalLeaderboard(): LeaderboardEntry[] {
  return dedupeBestPerName(read())
    .sort(byScoreThenTime)
    .map((e) => ({ score: e.score, name: e.name, timeMs: e.timeMs }));
}

/**
 * The full board a player competes on: their best-per-name scores merged with the
 * built-in legends, ranked score-descending. This is what the UI should display so a
 * fresh player still sees targets to chase.
 */
export function getRankedBoard(): RankedEntry[] {
  const mine: RankedEntry[] = dedupeBestPerName(read())
    .sort(byScoreThenTime)
    .map((e) => ({ score: e.score, name: e.name, timeMs: e.timeMs }));
  return [...mine, ...LEGENDS].sort((a, b) => b.score - a.score);
}

/**
 * 1-based rank a given score would hold on the full board (ties: the player sits just
 * below equal-or-higher existing scores, which feels fair — "you need to beat them").
 * Returns the rank and the total number of competitors (incl. legends + this score).
 */
export function findRank(score: number): { rank: number; total: number } {
  const board = getRankedBoard();
  const higherOrEqual = board.filter((e) => e.score >= score).length;
  // If this exact score already appears in `board` (it will, right after recording),
  // `higherOrEqual` already counts it, so that is the player's rank directly.
  return { rank: Math.max(1, higherOrEqual), total: board.length };
}
