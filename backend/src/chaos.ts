/**
 * chaos.ts — Chaos Mode: an admin-gated, self-only fault injector for the live demo.
 *
 * This is Cloud Yatra's signature "watch the dashboard react" feature. An operator flips
 * chaos ON for a bounded window (~60s, auto-expiring). While active, the Worker injects
 * extra latency and a fraction of synthetic 503s onto the GAMEPLAY ingest routes ONLY
 * (/event, /events, /score). It NEVER touches /healthz, /metrics, or the /chaos/* control
 * plane (so the operator can always see state and turn it off), and it NEVER touches any
 * external service — the fault is entirely within our own backend, by design.
 *
 * State is in-isolate (module scope). Cloudflare may run several isolates, so chaos is
 * "mostly on" during a demo rather than globally atomic — which is exactly what we want:
 * a visible, bounded perturbation, not an outage. The authoritative signal for the
 * dashboard is the `cy_chaos_active` gauge + the `/chaos/events` annotation feed.
 *
 * SAFETY: gated behind CHAOS_ADMIN_TOKEN (a Wrangler secret). With no token configured the
 * control endpoints refuse to start chaos (503 chaos_disabled), so a forgotten deploy can
 * never be perturbed by a stranger.
 */

export interface ChaosProfile {
  /** Fixed added latency (ms) applied to every gameplay request while active. */
  latencyMs: number;
  /** Probability [0..1] a gameplay request is failed with a synthetic 503. */
  errorRate: number;
}

export interface ChaosState {
  active: boolean;
  /** epoch ms when the current window expires (0 when inactive). */
  until: number;
  profile: ChaosProfile;
  /** who/what started it (bounded label, e.g. "admin"); null when inactive. */
  startedBy: string | null;
  /** count of requests perturbed in this isolate since process start (observability). */
  injected: number;
}

export interface ChaosEvent {
  kind: 'chaos_start' | 'chaos_stop' | 'chaos_expire';
  ts: number; // epoch ms
  profile?: ChaosProfile;
  reason?: string;
}

/** Hard ceilings so a typo can't turn a demo into a real outage. */
export const MAX_DURATION_MS = 120_000; // never longer than 2 minutes
export const DEFAULT_DURATION_MS = 60_000; // ~60s per the product brief
export const MAX_LATENCY_MS = 3_000;
export const DEFAULT_LATENCY_MS = 600;
export const DEFAULT_ERROR_RATE = 0.25;
/** Routes chaos is allowed to perturb. The control/observability plane is never touched. */
export const CHAOS_TARGET_ROUTES = new Set(['/event', '/events', '/score']);
const MAX_RING = 20; // keep only the most recent N chaos events for annotations

const state: ChaosState = {
  active: false,
  until: 0,
  profile: { latencyMs: DEFAULT_LATENCY_MS, errorRate: DEFAULT_ERROR_RATE },
  startedBy: null,
  injected: 0,
};

const ring: ChaosEvent[] = [];

function record(ev: ChaosEvent): void {
  ring.push(ev);
  while (ring.length > MAX_RING) ring.shift();
}

/** Lazily expire the window. Call before reading state so status is always truthful. */
function reconcile(now: number): void {
  if (state.active && now >= state.until) {
    state.active = false;
    state.until = 0;
    state.startedBy = null;
    record({ kind: 'chaos_expire', ts: now });
  }
}

/** Start (or extend) a chaos window. Returns the resulting public status. */
export function startChaos(
  opts: { durationMs?: number; latencyMs?: number; errorRate?: number; startedBy?: string } = {},
  now: number = Date.now(),
): ChaosStatus {
  reconcile(now);
  const durationMs = clamp(opts.durationMs ?? DEFAULT_DURATION_MS, 1_000, MAX_DURATION_MS);
  const latencyMs = clamp(opts.latencyMs ?? DEFAULT_LATENCY_MS, 0, MAX_LATENCY_MS);
  const errorRate = clamp(opts.errorRate ?? DEFAULT_ERROR_RATE, 0, 1);
  state.active = true;
  state.until = now + durationMs;
  state.profile = { latencyMs, errorRate };
  state.startedBy = (opts.startedBy ?? 'admin').slice(0, 32);
  record({ kind: 'chaos_start', ts: now, profile: state.profile });
  return getStatus(now);
}

/** Stop chaos immediately. Returns the resulting public status. */
export function stopChaos(now: number = Date.now()): ChaosStatus {
  reconcile(now);
  if (state.active) {
    state.active = false;
    state.until = 0;
    state.startedBy = null;
    record({ kind: 'chaos_stop', ts: now });
  }
  return getStatus(now);
}

export interface ChaosStatus {
  active: boolean;
  remainingMs: number;
  profile: ChaosProfile;
  startedBy: string | null;
  injected: number;
}

/** Truthful public status (expires lazily). Safe to expose unauthenticated (read-only). */
export function getStatus(now: number = Date.now()): ChaosStatus {
  reconcile(now);
  return {
    active: state.active,
    remainingMs: state.active ? Math.max(0, state.until - now) : 0,
    profile: { ...state.profile },
    startedBy: state.startedBy,
    injected: state.injected,
  };
}

/**
 * Decide whether to perturb a given request. Returns the action to take; the caller
 * applies the latency and/or short-circuits with a 503. Only gameplay routes are eligible.
 */
export interface ChaosDecision {
  active: boolean;
  delayMs: number;
  fail: boolean;
}

export function decide(route: string, now: number = Date.now()): ChaosDecision {
  reconcile(now);
  if (!state.active || !CHAOS_TARGET_ROUTES.has(route)) {
    return { active: false, delayMs: 0, fail: false };
  }
  state.injected += 1;
  const fail = Math.random() < state.profile.errorRate;
  return { active: true, delayMs: state.profile.latencyMs, fail };
}

/** Recent chaos episodes, newest last — shaped for a Grafana annotation query. */
export function recentEvents(now: number = Date.now()): ChaosEvent[] {
  reconcile(now);
  return ring.slice();
}

/** True when chaos is currently active (gauge source). */
export function isActive(now: number = Date.now()): boolean {
  reconcile(now);
  return state.active;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Test-only reset so each test starts from a clean, inactive state. */
export function __resetChaos(): void {
  state.active = false;
  state.until = 0;
  state.profile = { latencyMs: DEFAULT_LATENCY_MS, errorRate: DEFAULT_ERROR_RATE };
  state.startedBy = null;
  state.injected = 0;
  ring.length = 0;
}
