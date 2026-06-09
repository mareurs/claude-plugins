#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDB=$(mktemp /tmp/pika-concurrent-test.XXXXXX.db)
trap 'rm -f "$TMPDB" "$TMPDB-wal" "$TMPDB-shm"' EXIT

sqlite3 "$TMPDB" <<SQL
PRAGMA journal_mode = WAL;
CREATE TABLE tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL, latency_ms INTEGER NOT NULL, outcome TEXT NOT NULL,
    overflowed INTEGER NOT NULL DEFAULT 0,
    input_json TEXT, output_json TEXT, error_msg TEXT, cc_session_id TEXT,
    called_at TEXT NOT NULL DEFAULT (datetime('now'))
);
SQL
sqlite3 "$TMPDB" < "$SKILL_DIR/sql/v1-bootstrap.sql"

# Seed 200 tool_calls (FK targets for 200 observations)
sqlite3 "$TMPDB" <<SQL
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 200)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json)
SELECT 'test', 1, 'ok', '{}' FROM seq;
SQL

# Two parallel writers, each insert 100 observations
writer() {
    local start=$1
    for i in $(seq $start $((start+99))); do
        sqlite3 -cmd "PRAGMA busy_timeout=5000;" "$TMPDB" \
            "INSERT INTO pika_observations (tool_call_id, kind, subkind, verdict, severity) VALUES ($i, 'iron_law', 'iron_law_1', 'slip', 'low');"
    done
}

writer 1 &
PID1=$!
writer 101 &
PID2=$!
wait $PID1 $PID2

COUNT=$(sqlite3 "$TMPDB" "SELECT COUNT(*) FROM pika_observations;")
[[ "$COUNT" == "200" ]] || { echo "FAIL: concurrent writes expected 200, got $COUNT"; exit 1; }

echo "PASS: 200 concurrent writes from 2 writers succeed"
