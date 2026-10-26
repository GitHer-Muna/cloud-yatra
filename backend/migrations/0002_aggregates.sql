-- Cloud Yatra D1 schema (migration 0002) — incremental aggregate rollups.
--
-- WHY: /stats previously computed ~16 queries PER CALL, most of them full-table scans or
-- GROUP BYs over the append-only `events` table (COUNT(*), GROUP BY type/cause/kind/level,
-- and 4× COUNT(DISTINCT session_id) for the funnel). Every row-read scales with the total
-- events table size, and the in-page mini-observatory + Grafana panels poll /stats from
-- every open tab. On Cloudflare D1's free tier (a daily row-read cap) this exhausts the
-- budget and D1 starts returning error 7500, which blanks the dashboard tiles mid-demo.
--
-- FIX: maintain the same cumulative aggregates INCREMENTALLY as events arrive (exactly the
-- pattern `sessions` and `daily_rollup` already use), in tiny keyed rollup tables. /stats
-- then reads a handful of small tables (bounded by the number of distinct types/causes/
-- kinds/levels — all low-cardinality) instead of scanning all of `events`. The funnel is
-- derived from the small `sessions` table via per-session reached flags added here.
--
-- Idempotent + lossless: the aggregate tables are backfilled from the existing `events`
-- rows at the bottom of this migration, so a deploy against a populated database keeps all
-- historical counts. Migrations run once (tracked by wrangler), and INSERT OR IGNORE +
-- the GROUP BY backfill make re-runs safe.

-- ---------------------------------------------------------------------------
-- Events-by-type counter (one row per event type). Powers totals + eventsByType.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agg_type (
  type  TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- Deaths-by-cause counter (one row per death cause). Powers deathsByCause.
CREATE TABLE IF NOT EXISTS agg_cause (
  cause TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- Collectibles-by-kind counter (one row per collectible kind). Powers collectsByKind.
CREATE TABLE IF NOT EXISTS agg_kind (
  kind  TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- Per-level rollup (one row per level_id). Powers byLevel.
CREATE TABLE IF NOT EXISTS agg_level (
  level       TEXT PRIMARY KEY,
  events      INTEGER NOT NULL DEFAULT 0,
  deaths      INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Per-session funnel flags so the progression funnel is a cheap COUNT on the
-- small `sessions` table instead of COUNT(DISTINCT session_id) scans over events.
-- reached_hills / reached_himal are set the first time a session produces any
-- event tagged with that level_id (matching the old `WHERE level_id=...` semantics).
-- ---------------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN reached_hills INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN reached_himal INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Backfill the new aggregates from existing events so deploys against a populated
-- database keep every historical count. Safe on an empty table (inserts nothing).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO agg_type (type, count)
  SELECT type, COUNT(*) FROM events GROUP BY type;

INSERT OR IGNORE INTO agg_cause (cause, count)
  SELECT COALESCE(cause, 'unknown'), COUNT(*)
    FROM events WHERE type = 'player_died'
   GROUP BY COALESCE(cause, 'unknown');

INSERT OR IGNORE INTO agg_kind (kind, count)
  SELECT COALESCE(kind, 'unknown'), COUNT(*)
    FROM events WHERE type = 'collectible_collected'
   GROUP BY COALESCE(kind, 'unknown');

INSERT OR IGNORE INTO agg_level (level, events, deaths, completions)
  SELECT COALESCE(level_id, 'unknown'),
         COUNT(*),
         SUM(CASE WHEN type = 'player_died' THEN 1 ELSE 0 END),
         SUM(CASE WHEN type = 'level_completed' THEN 1 ELSE 0 END)
    FROM events GROUP BY COALESCE(level_id, 'unknown');

-- Backfill the per-session reached flags from the historical events.
UPDATE sessions SET reached_hills = 1
 WHERE session_id IN (SELECT DISTINCT session_id FROM events WHERE level_id = 'hills');
UPDATE sessions SET reached_himal = 1
 WHERE session_id IN (SELECT DISTINCT session_id FROM events WHERE level_id = 'himal');
