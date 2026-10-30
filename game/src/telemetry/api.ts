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

/**
 * Reads the raw VITE_API_BASE_URL from the build-time env. Extracted as its own function
 * so tests can override it (import.meta.env is populated from a developer's local .env and
 * can't be reliably stubbed in Vitest, which would otherwise make this module's tests
 * depend on whether a .env happens to exist). Production behavior is unchanged.
 */
let readApiBaseEnv = (): string | undefined => {
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_API_BASE_URL;
};

/** Test-only hook to override how the backend URL is read. */
export function __setApiBaseEnvReader(fn: () => string | undefined): void {
  readApiBaseEnv = fn;
}

/** The configured backend base URL (no trailing slash), or null when unconfigured. */
export function apiBase(): string | null {
  const raw = readApiBaseEnv();
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
 *
 * Anonymous runs ARE submitted: if the player didn't type a name, we derive a friendly,
 * per-session name like "Pilgrim-a3f9" from the session id. This keeps the shared board
 * lively (like arcade leaderboards) instead of empty, while the backend's best-per-name
 * dedup means one anonymous player maps to one stable row (not a flood). A missing session
 * id falls back to a random suffix so we never collapse every anon run into a single row.
 */
function anonPilgrimName(sessionId?: string | null): string {
  const raw = (sessionId ?? '').replace(/[^a-z0-9]/gi, '');
  // 4 hex-ish chars from the session id give a stable, readable, low-collision suffix.
  const suffix = raw.length >= 4 ? raw.slice(0, 4) : Math.random().toString(16).slice(2, 6);
  return `Pilgrim-${suffix}`;
}

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
  if (!base) return;
  // Submit even when the player stayed anonymous — default to a per-session friendly name
  // so the shared leaderboard fills up instead of silently dropping nameless runs.
  const submitName = (name && name.trim()) || anonPilgrimName(sessionId);

  const payload = JSON.stringify({ name: submitName, score, timeMs, levelId, sessionId });
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
    // sendBeacon (above) always sends credentials mode "include"; this fetch fallback does
    // not need cookies, so omit credentials to keep the CORS contract as simple as possible.
    credentials: 'omit',
  }).catch(() => undefined);
}

// --- Chaos Mode client -----------------------------------------------------------------
// Chaos Mode is the admin-only "watch the dashboard react" demo control. These helpers
// talk to the backend's /chaos/* endpoints. The start/stop calls require an admin token
// (NOT a secret baked into the build — it's entered by the operator at demo time and held
// only in memory / sessionStorage). Everything is offline-safe: with no backend configured
// the helpers resolve to an inert, inactive status and never throw into the UI.

export interface ChaosStatus {
  active: boolean;
  remainingMs: number;
  profile: { latencyMs: number; errorRate: number };
  startedBy: string | null;
  injected: number;
}

const INACTIVE: ChaosStatus = {
  active: false,
  remainingMs: 0,
  profile: { latencyMs: 0, errorRate: 0 },
  startedBy: null,
  injected: 0,
};

/** Read the current chaos status (unauthenticated, read-only). Never throws. */
export async function getChaosStatus(timeoutMs = 2500): Promise<ChaosStatus> {
  const base = apiBase();
  if (!base) return INACTIVE;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/chaos/status`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return INACTIVE;
    return (await res.json()) as ChaosStatus;
  } catch {
    return INACTIVE;
  }
}

export interface ChaosResult {
  ok: boolean;
  status: ChaosStatus;
  error?: 'no_backend' | 'no_token' | 'unauthorized' | 'disabled' | 'network';
}

/**
 * Start a chaos window (admin-gated). `token` is the CHAOS_ADMIN_TOKEN configured on the
 * Worker. Optional profile overrides are clamped server-side. Returns a structured result
 * so the UI can show "unauthorized" / "disabled" without exceptions.
 */
export async function startChaos(
  token: string,
  opts: { durationMs?: number; latencyMs?: number; errorRate?: number } = {},
): Promise<ChaosResult> {
  const base = apiBase();
  if (!base) return { ok: false, status: INACTIVE, error: 'no_backend' };
  if (!token) return { ok: false, status: INACTIVE, error: 'no_token' };
  try {
    const res = await fetch(`${base}/chaos/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chaos-Token': token,
      },
      body: JSON.stringify({ ...opts, startedBy: 'admin' }),
    });
    if (res.status === 401) return { ok: false, status: INACTIVE, error: 'unauthorized' };
    if (res.status === 503) return { ok: false, status: INACTIVE, error: 'disabled' };
    if (!res.ok) return { ok: false, status: INACTIVE, error: 'network' };
    const body = (await res.json()) as { status: ChaosStatus };
    return { ok: true, status: body.status };
  } catch {
    return { ok: false, status: INACTIVE, error: 'network' };
  }
}

/** Stop the chaos window immediately (admin-gated). */
export async function stopChaos(token: string): Promise<ChaosResult> {
  const base = apiBase();
  if (!base) return { ok: false, status: INACTIVE, error: 'no_backend' };
  if (!token) return { ok: false, status: INACTIVE, error: 'no_token' };
  try {
    const res = await fetch(`${base}/chaos/stop`, {
      method: 'POST',
      headers: { 'X-Chaos-Token': token },
    });
    if (res.status === 401) return { ok: false, status: INACTIVE, error: 'unauthorized' };
    if (res.status === 503) return { ok: false, status: INACTIVE, error: 'disabled' };
    if (!res.ok) return { ok: false, status: INACTIVE, error: 'network' };
    const body = (await res.json()) as { status: ChaosStatus };
    return { ok: true, status: body.status };
  } catch {
    return { ok: false, status: INACTIVE, error: 'network' };
  }
}
