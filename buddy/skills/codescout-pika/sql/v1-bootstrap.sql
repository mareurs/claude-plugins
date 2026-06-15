-- Pika observability — schema (v1 + v2)
-- Idempotent. Safe to re-run on every scan.
-- Anchored to codescout's existing tool_calls table.
-- v2 (2026-06-15): recency columns — distinguish lifetime (recurrence) from live
-- (recent_count, last_seen), and link a resolved family to the fix it died at
-- (resolved_at_sha, a codescout_sha/project_sha). See SKILL Heuristic 12 / Self-Trap 6.

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
    recurrence      INTEGER NOT NULL DEFAULT 1,   -- lifetime count (all-time)
    recent_count    INTEGER,                       -- v2: recency count (e.g. last 7d)
    last_seen       TEXT,                          -- v2: latest called_at for the pattern
    resolved_at_sha TEXT,                          -- v2: sha after which the family stopped (NULL = still live)
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
INSERT OR IGNORE INTO pika_schema_version (version) VALUES (2);

COMMIT;

-- This bootstrap is CREATE-only, so it stays exit-0 idempotent on every re-run.
-- Fresh DBs get the v2 columns (recent_count / last_seen / resolved_at_sha) straight
-- from the CREATE TABLE above. A pika_observations table created by a PRE-v2 bootstrap
-- is migrated ONCE (ALTER TABLE ADD COLUMN is not idempotent, so it is deliberately
-- NOT in this every-scan script):
--   for c in 'recent_count INTEGER' 'last_seen TEXT' 'resolved_at_sha TEXT'; do \
--     sqlite3 <db> "ALTER TABLE pika_observations ADD COLUMN $c" 2>/dev/null; done
-- The one pre-v2 table in this workspace (codescout's) was migrated at v2 rollout
-- (2026-06-15); other projects had no persisted pika_observations table.
