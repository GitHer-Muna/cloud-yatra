-- Cloud Yatra D1 schema (migration 0001).
--
-- Design goals:
--   * Persist EVERY gameplay signal (jumps, cuts, collisions, flowers, bells, deaths,
--     progress, guru moments, perf, heartbeats) as append-only rows for deep analytics.
--   * Keep a per-session rollup so the dashboard can show sessions/engagement cheaply.
--   * Keep a real cross-player leaderboard (best score per pilgrim name).
--   * Keep a daily rollup so long-range dashboard panels never scan the raw events table.
--
-- Privacy: session_id is an anonymous per-tab UUID. No PII. player_name is a chosen
-- display handle only. No emails, no IPs stored (country is coarse, from CF edge).

-- ---------------------------------------------------------------------------
-- Raw gameplay / telemetry events (append-only, the analytical source of truth).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT    NOT NULL UNIQUE,           -- client-supplied idempotency key
  schema_version INTEGER NOT NULL,
  type           TEXT    NOT NULL,                  -- bounded vocabulary (see events.ts)
  session_id     TEXT    NOT NULL,                  -- anonymous per-tab UUID
  player_id      TEXT,                              -- opt-in only; usually NULL
  level_id       TEXT,                              -- terai | hills | himal | NULL
  correlation_id TEXT,
  ts             INTEGER NOT NULL,                  -- client epoch millis (wall clock)
  t_ms           INTEGER NOT NULL,                  -- ms since load (monotonic ordering)
  received_at    INTEGER NOT NULL,                  -- server epoch millis
  country        TEXT,                              -- coarse CF edge country (e.g. NP, US)
  -- Common, bounded, low-cardinality dimensions promoted to columns for fast grouping:
  cause          TEXT,                              -- eagle | rockfall | mist | monkey | fall
  kind           TEXT,                              -- flower/obstacle kind
  use_case       TEXT,                              -- guru_guidance use case
  -- Numeric measures (nullable; only set where the event carries them):
  score          REAL,
  points         REAL,
  total          REAL,
  lives          REAL,
  progress_pct   REAL,
  bucket         REAL,
  avg_fps        REAL,
  duration_ms    REAL,
  -- Full original attributes JSON for anything not promoted to a column:
  attrs          TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_received_at ON events (received_at);
CREATE INDEX IF NOT EXISTS idx_events_type_time   ON events (type, received_at);
CREATE INDEX IF NOT EXISTS idx_events_session     ON events (session_id);
CREATE INDEX IF NOT EXISTS idx_events_level_type  ON events (level_id, type);
CREATE INDEX IF NOT EXISTS idx_events_cause       ON events (cause);

-- ---------------------------------------------------------------------------
-- Per-session rollup (one row per anonymous session, upserted as events arrive).
-- Powers "sessions started", "active sessions", engagement, and funnel panels.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT PRIMARY KEY,
  player_name    TEXT,
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  country        TEXT,
  input_mode     TEXT,                              -- touch | keyboard
  started        INTEGER NOT NULL DEFAULT 0,        -- count of game_started
  completed      INTEGER NOT NULL DEFAULT 0,        -- count of level_completed
  deaths         INTEGER NOT NULL DEFAULT 0,
  jumps          INTEGER NOT NULL DEFAULT 0,
  cuts           INTEGER NOT NULL DEFAULT 0,
  collects       INTEGER NOT NULL DEFAULT 0,
  bells          INTEGER NOT NULL DEFAULT 0,
  flags          INTEGER NOT NULL DEFAULT 0,
  best_score     REAL    NOT NULL DEFAULT 0,
  max_progress   REAL    NOT NULL DEFAULT 0,
  event_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions (last_seen);

-- ---------------------------------------------------------------------------
-- Cross-player leaderboard (best score per pilgrim name, case-insensitive handle).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name_key    TEXT    NOT NULL UNIQUE,              -- lower(trim(name)) for dedupe
  name        TEXT    NOT NULL,                     -- display name as entered
  score       REAL    NOT NULL,
  time_ms     REAL,
  level_id    TEXT,
  session_id  TEXT,
  country     TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_score ON scores (score DESC);

-- ---------------------------------------------------------------------------
-- Daily rollup (one row per UTC day) for cheap long-range trend panels.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_rollup (
  day          TEXT PRIMARY KEY,                    -- YYYY-MM-DD (UTC)
  sessions     INTEGER NOT NULL DEFAULT 0,
  events       INTEGER NOT NULL DEFAULT 0,
  completions  INTEGER NOT NULL DEFAULT 0,
  deaths       INTEGER NOT NULL DEFAULT 0,
  top_score    REAL    NOT NULL DEFAULT 0
);
