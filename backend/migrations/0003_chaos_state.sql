-- Cloud Yatra D1 schema (migration 0003) — shared Chaos Mode state.
--
-- WHY: Chaos Mode state used to live in one Worker isolate's memory. Cloudflare runs many
-- isolates, so "start" could land on one while status polls and gameplay requests hit
-- others that still read "idle". A single keyed row makes the window visible everywhere.
-- Isolates cache the row for a couple of seconds, so this adds ~1 tiny read per isolate
-- per 2s, not one per request.
CREATE TABLE IF NOT EXISTS chaos_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  until       INTEGER NOT NULL DEFAULT 0,   -- epoch ms the window expires (0 = inactive)
  latency_ms  INTEGER NOT NULL DEFAULT 600,
  error_rate  REAL    NOT NULL DEFAULT 0.25,
  started_by  TEXT,
  events      TEXT    NOT NULL DEFAULT '[]' -- recent start/stop/expire markers (JSON)
);
