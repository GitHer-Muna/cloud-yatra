-- Cloud Yatra D1 schema (migration 0003) — shared Chaos Mode state.
--
-- Cloudflare runs many Worker isolates, so in-memory state would only be seen by the
-- isolate that handled "start". A single keyed row makes the window visible to all of
-- them. Isolates cache the row for ~2s, so this costs one tiny read per isolate per 2s.
CREATE TABLE IF NOT EXISTS chaos_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  until       INTEGER NOT NULL DEFAULT 0,   -- epoch ms the window expires (0 = inactive)
  latency_ms  INTEGER NOT NULL DEFAULT 600,
  error_rate  REAL    NOT NULL DEFAULT 0.25,
  started_by  TEXT,
  events      TEXT    NOT NULL DEFAULT '[]' -- recent start/stop/expire markers (JSON)
);
