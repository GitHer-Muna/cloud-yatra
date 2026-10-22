/**
 * db.ts — all D1 (SQLite) reads/writes live here.
 *
 * Writes: ingest() persists one validated event, promotes bounded dimensions to columns
 * for fast grouping, and incrementally updates the per-session rollup, the cross-player
 * leaderboard (on level_completed), and the daily rollup. Everything is idempotent on the
 * client-supplied event_id so a retried batch never double-counts.
 *
 * Reads: leaderboard(), stats() power the shared board and the dashboard's /stats panels.
 */
import type { Env } from './env';
import { num, str, type EventEnvelope } from './events';

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface IngestResult {
  inserted: boolean; // false when the event_id already existed (idempotent replay)
}

/** Persist one validated event and update rollups. Returns whether it was newly inserted. */
export async function ingest(
  env: Env,
  ev: EventEnvelope,
  meta: { eventId: string; receivedAt: number; country: string | null },
): Promise<IngestResult> {
  const a = ev.attrs;
  const cause = str(a, 'cause', 32);
  const kind = str(a, 'kind', 32);
  const useCase = str(a, 'useCase', 32);
  const score = num(a, 'score');
  const points = num(a, 'points');
  const total = num(a, 'total');
  const lives = num(a, 'livesLeft') ?? num(a, 'lives');
  const progressPct = num(a, 'progressPct');
  const bucket = num(a, 'bucket');
  const avgFps = num(a, 'avgFps');
  const durationMs = num(a, 'durationMs') ?? num(a, 'timeMs');

  const insert = await env.DB.prepare(
    `INSERT OR IGNORE INTO events
       (event_id, schema_version, type, session_id, player_id, level_id, correlation_id,
        ts, t_ms, received_at, country, cause, kind, use_case,
        score, points, total, lives, progress_pct, bucket, avg_fps, duration_ms, attrs)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      meta.eventId,
      ev.schemaVersion,
      ev.type,
      ev.sessionId,
      ev.playerId,
      ev.levelId,
      ev.correlationId,
      ev.ts,
      ev.tMs,
      meta.receivedAt,
      meta.country,
      cause,
      kind,
      useCase,
      score,
      points,
      total,
      lives,
      progressPct,
      bucket,
      avgFps,
      durationMs,
      JSON.stringify(a).slice(0, 2048),
    )
    .run();

  // D1 returns meta.changes; 0 means the UNIQUE event_id already existed → idempotent skip.
  const inserted = (insert.meta?.changes ?? 0) > 0;
  if (!inserted) return { inserted: false };

  await updateSession(env, ev, meta.receivedAt, meta.country);
  await updateDaily(env, ev, meta.receivedAt);
  return { inserted: true };
}

async function updateSession(
  env: Env,
  ev: EventEnvelope,
  receivedAt: number,
  country: string | null,
): Promise<void> {
  const a = ev.attrs;
  const isStart = ev.type === 'game_started' ? 1 : 0;
  const isComplete = ev.type === 'level_completed' ? 1 : 0;
  const isDeath = ev.type === 'player_died' ? 1 : 0;
  const isJump = ev.type === 'player_jump' ? 1 : 0;
  const isCut = ev.type === 'obstacle_cut' ? 1 : 0;
  const isBell =
    ev.type === 'collectible_collected' && str(a, 'kind', 32)?.toLowerCase().includes('bell')
      ? 1
      : 0;
  const isCollect = ev.type === 'collectible_collected' && !isBell ? 1 : 0;
  const isFlag = ev.type === 'flag_planted' ? 1 : 0;
  const score = num(a, 'score') ?? 0;
  const progress = num(a, 'progressPct') ?? 0;
  const inputMode = str(a, 'inputMode', 16);

  await env.DB.prepare(
    `INSERT INTO sessions
       (session_id, first_seen, last_seen, country, input_mode,
        started, completed, deaths, jumps, cuts, collects, bells, flags,
        best_score, max_progress, event_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
     ON CONFLICT(session_id) DO UPDATE SET
       last_seen    = excluded.last_seen,
       country      = COALESCE(sessions.country, excluded.country),
       input_mode   = COALESCE(sessions.input_mode, excluded.input_mode),
       started      = sessions.started + excluded.started,
       completed    = sessions.completed + excluded.completed,
       deaths       = sessions.deaths + excluded.deaths,
       jumps        = sessions.jumps + excluded.jumps,
       cuts         = sessions.cuts + excluded.cuts,
       collects     = sessions.collects + excluded.collects,
       bells        = sessions.bells + excluded.bells,
       flags        = sessions.flags + excluded.flags,
       best_score   = MAX(sessions.best_score, excluded.best_score),
       max_progress = MAX(sessions.max_progress, excluded.max_progress),
       event_count  = sessions.event_count + 1`,
  )
    .bind(
      ev.sessionId,
      receivedAt,
      receivedAt,
      country,
      inputMode,
      isStart,
      isComplete,
      isDeath,
      isJump,
      isCut,
      isCollect,
      isBell,
      isFlag,
      score,
      progress,
    )
    .run();
}

async function updateDaily(env: Env, ev: EventEnvelope, receivedAt: number): Promise<void> {
  const day = utcDay(receivedAt);
  const isStart = ev.type === 'game_started' ? 1 : 0;
  const isComplete = ev.type === 'level_completed' ? 1 : 0;
  const isDeath = ev.type === 'player_died' ? 1 : 0;
  const score = num(ev.attrs, 'score') ?? 0;
  await env.DB.prepare(
    `INSERT INTO daily_rollup (day, sessions, events, completions, deaths, top_score)
     VALUES (?,?,1,?,?,?)
     ON CONFLICT(day) DO UPDATE SET
       sessions    = daily_rollup.sessions + excluded.sessions,
       events      = daily_rollup.events + 1,
       completions = daily_rollup.completions + excluded.completions,
       deaths      = daily_rollup.deaths + excluded.deaths,
       top_score   = MAX(daily_rollup.top_score, excluded.top_score)`,
  )
    .bind(day, isStart, isComplete, isDeath, score)
    .run();
}

export interface ScoreInput {
  name: string;
  score: number;
  timeMs?: number | null;
  levelId?: string | null;
  sessionId?: string | null;
  country?: string | null;
}

/** Upsert a cross-player score, keeping the BEST score per (case-insensitive) name. */
export async function submitScore(env: Env, input: ScoreInput): Promise<void> {
  const nameKey = input.name.trim().toLowerCase().slice(0, 48);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO scores (name_key, name, score, time_ms, level_id, session_id, country, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(name_key) DO UPDATE SET
       score      = MAX(scores.score, excluded.score),
       time_ms    = CASE WHEN excluded.score >= scores.score THEN excluded.time_ms ELSE scores.time_ms END,
       name       = excluded.name,
       level_id   = CASE WHEN excluded.score >= scores.score THEN excluded.level_id ELSE scores.level_id END,
       updated_at = excluded.updated_at`,
  )
    .bind(
      nameKey,
      input.name.trim().slice(0, 48),
      input.score,
      input.timeMs ?? null,
      input.levelId ?? null,
      input.sessionId ?? null,
      input.country ?? null,
      now,
      now,
    )
    .run();
}

export interface LeaderboardRow {
  name: string;
  score: number;
  timeMs: number | null;
  country: string | null;
}

/** Top N scores, highest first. */
export async function leaderboard(env: Env, limit = 20): Promise<LeaderboardRow[]> {
  const n = Math.min(Math.max(1, Math.floor(limit)), 100);
  const res = await env.DB.prepare(
    `SELECT name, score, time_ms AS timeMs, country
       FROM scores ORDER BY score DESC, updated_at ASC LIMIT ?`,
  )
    .bind(n)
    .all<LeaderboardRow>();
  return res.results ?? [];
}

/**
 * Per-session rollup for the "Your Run" dashboard row. Returns the single session's row
 * from the `sessions` table (the same anonymous per-tab rollup used for engagement),
 * shaped as a one-element array so the Infinity datasource can read it as a table.
 *
 * Privacy: the session id is an anonymous per-tab UUID (no PII). We echo it back only so
 * the dashboard can confirm which run is shown. An unknown/not-yet-seen session returns a
 * single zeroed row (never an error) so the panels render "0 / just started" instead of
 * going blank — exactly the always-present behavior the embed wants.
 */
export interface SessionRollup {
  sessionId: string;
  found: boolean;
  firstSeen: number | null;
  lastSeen: number | null;
  country: string | null;
  inputMode: string | null;
  started: number;
  completed: number;
  deaths: number;
  jumps: number;
  cuts: number;
  collects: number;
  bells: number;
  flags: number;
  bestScore: number;
  maxProgress: number;
  eventCount: number;
}

export async function sessionRollup(env: Env, sessionId: string): Promise<SessionRollup> {
  const row = await env.DB.prepare(
    `SELECT session_id   AS sessionId,
            first_seen   AS firstSeen,
            last_seen    AS lastSeen,
            country,
            input_mode   AS inputMode,
            started, completed, deaths, jumps, cuts, collects, bells, flags,
            best_score   AS bestScore,
            max_progress AS maxProgress,
            event_count  AS eventCount
       FROM sessions WHERE session_id = ?`,
  )
    .bind(sessionId)
    .first<Omit<SessionRollup, 'found'>>();

  if (!row) {
    return {
      sessionId,
      found: false,
      firstSeen: null,
      lastSeen: null,
      country: null,
      inputMode: null,
      started: 0,
      completed: 0,
      deaths: 0,
      jumps: 0,
      cuts: 0,
      collects: 0,
      bells: 0,
      flags: 0,
      bestScore: 0,
      maxProgress: 0,
      eventCount: 0,
    };
  }
  return { ...row, found: true };
}

export interface Stats {
  generatedAt: number;
  sessions: { total: number; active5m: number };
  today: { sessions: number; events: number; completions: number; deaths: number; topScore: number };
  totals: { events: number; completions: number; deaths: number };
  eventsByType: Array<{ type: string; count: number }>;
  deathsByCause: Array<{ cause: string; count: number }>;
  collectsByKind: Array<{ kind: string; count: number }>;
  byLevel: Array<{ level: string; events: number; deaths: number; completions: number }>;
  topCountries: Array<{ country: string; sessions: number }>;
  funnel: { started: number; reachedHills: number; reachedHimal: number; completed: number };
  avgFps: number | null;
}

/** Aggregate dashboard stats computed directly from D1. */
export async function stats(env: Env): Promise<Stats> {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const day = utcDay(now);

  const one = async <T>(sql: string, ...bind: unknown[]): Promise<T | null> =>
    (await env.DB.prepare(sql).bind(...bind).first<T>()) ?? null;

  const sessionsTotal = (await one<{ c: number }>(`SELECT COUNT(*) c FROM sessions`))?.c ?? 0;
  const active5m =
    (await one<{ c: number }>(`SELECT COUNT(*) c FROM sessions WHERE last_seen >= ?`, fiveMinAgo))
      ?.c ?? 0;

  const today =
    (await one<{ sessions: number; events: number; completions: number; deaths: number; top: number }>(
      `SELECT sessions, events, completions, deaths, top_score AS top FROM daily_rollup WHERE day = ?`,
      day,
    )) ?? { sessions: 0, events: 0, completions: 0, deaths: 0, top: 0 };

  const totalsEvents = (await one<{ c: number }>(`SELECT COUNT(*) c FROM events`))?.c ?? 0;
  const totalsCompletions =
    (await one<{ c: number }>(`SELECT COUNT(*) c FROM events WHERE type='level_completed'`))?.c ?? 0;
  const totalsDeaths =
    (await one<{ c: number }>(`SELECT COUNT(*) c FROM events WHERE type='player_died'`))?.c ?? 0;

  const eventsByType =
    (
      await env.DB.prepare(
        `SELECT type, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC`,
      ).all<{ type: string; count: number }>()
    ).results ?? [];

  const deathsByCause =
    (
      await env.DB.prepare(
        `SELECT COALESCE(cause,'unknown') AS cause, COUNT(*) AS count
           FROM events WHERE type='player_died' GROUP BY cause ORDER BY count DESC`,
      ).all<{ cause: string; count: number }>()
    ).results ?? [];

  const collectsByKind =
    (
      await env.DB.prepare(
        `SELECT COALESCE(kind,'unknown') AS kind, COUNT(*) AS count
           FROM events WHERE type='collectible_collected' GROUP BY kind ORDER BY count DESC`,
      ).all<{ kind: string; count: number }>()
    ).results ?? [];

  const byLevel =
    (
      await env.DB.prepare(
        `SELECT COALESCE(level_id,'unknown') AS level,
                COUNT(*) AS events,
                SUM(CASE WHEN type='player_died' THEN 1 ELSE 0 END) AS deaths,
                SUM(CASE WHEN type='level_completed' THEN 1 ELSE 0 END) AS completions
           FROM events GROUP BY level_id ORDER BY events DESC`,
      ).all<{ level: string; events: number; deaths: number; completions: number }>()
    ).results ?? [];

  const topCountries =
    (
      await env.DB.prepare(
        `SELECT COALESCE(country,'??') AS country, COUNT(*) AS sessions
           FROM sessions GROUP BY country ORDER BY sessions DESC LIMIT 10`,
      ).all<{ country: string; sessions: number }>()
    ).results ?? [];

  const started =
    (await one<{ c: number }>(`SELECT COUNT(DISTINCT session_id) c FROM events WHERE type='game_started'`))
      ?.c ?? 0;
  const reachedHills =
    (await one<{ c: number }>(`SELECT COUNT(DISTINCT session_id) c FROM events WHERE level_id='hills'`))
      ?.c ?? 0;
  const reachedHimal =
    (await one<{ c: number }>(`SELECT COUNT(DISTINCT session_id) c FROM events WHERE level_id='himal'`))
      ?.c ?? 0;
  const completedSessions =
    (await one<{ c: number }>(
      `SELECT COUNT(DISTINCT session_id) c FROM events WHERE type='level_completed'`,
    ))?.c ?? 0;

  const avgFpsRow = await one<{ v: number | null }>(
    `SELECT AVG(avg_fps) v FROM events WHERE type='client_perf' AND received_at >= ?`,
    now - 60 * 60 * 1000,
  );

  return {
    generatedAt: now,
    sessions: { total: sessionsTotal, active5m },
    today: {
      sessions: today.sessions,
      events: today.events,
      completions: today.completions,
      deaths: today.deaths,
      topScore: today.top,
    },
    totals: { events: totalsEvents, completions: totalsCompletions, deaths: totalsDeaths },
    eventsByType,
    deathsByCause,
    collectsByKind,
    byLevel,
    topCountries,
    funnel: { started, reachedHills, reachedHimal, completed: completedSessions },
    avgFps: avgFpsRow?.v ?? null,
  };
}
