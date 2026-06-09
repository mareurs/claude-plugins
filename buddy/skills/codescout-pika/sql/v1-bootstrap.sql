-- Pika observability — schema v1
-- Idempotent. Safe to re-run on every scan.
-- Anchored to codescout's existing tool_calls table.

BEGIN;

CREATE TABLE IF NOT EXISTS pika_observations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_call_id    INTEGER NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN
                        ('iron_law', 'tool_bug', 'misusage', 'pattern')),
    subkind         TEXT,
    predicate       TEXT,
    verdict         TEXT CHECK (verdict IS NULL OR verdict IN
                        ('slip', 'habit', 'promoted', 'rejected')),
    severity        TEXT NOT NULL DEFAULT 'low' CHECK (severity IN
                        ('low', 'med', 'high')),
    recurrence      INTEGER NOT NULL DEFAULT 1,
    u_id            TEXT,
    h_id            TEXT,
    t_id            TEXT,
    bug_id          TEXT,
    notes           TEXT,
    cc_session_id   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at     TEXT
);

CREATE INDEX IF NOT EXISTS pika_obs_kind_verdict     ON pika_observations(kind, verdict);
CREATE INDEX IF NOT EXISTS pika_obs_session          ON pika_observations(cc_session_id);
CREATE INDEX IF NOT EXISTS pika_obs_tool_call        ON pika_observations(tool_call_id);
CREATE INDEX IF NOT EXISTS pika_obs_subkind_verdict  ON pika_observations(subkind, verdict);

CREATE TABLE IF NOT EXISTS pika_schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO pika_schema_version (version) VALUES (1);

COMMIT;
