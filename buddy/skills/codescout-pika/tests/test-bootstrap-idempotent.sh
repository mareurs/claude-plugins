#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDB=$(mktemp /tmp/pika-bootstrap-test.XXXXXX.db)
trap 'rm -f "$TMPDB" "$TMPDB-wal" "$TMPDB-shm"' EXIT

# Seed a minimal tool_calls table so FK targets exist
sqlite3 "$TMPDB" <<SQL
CREATE TABLE tool_calls (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name  TEXT NOT NULL,
    called_at  TEXT NOT NULL DEFAULT (datetime('now')),
    latency_ms INTEGER NOT NULL,
    outcome    TEXT NOT NULL,
    overflowed INTEGER NOT NULL DEFAULT 0,
    error_msg  TEXT,
    codescout_sha TEXT, project_sha TEXT, session_id TEXT,
    input_json TEXT, output_json TEXT, cc_session_id TEXT
);
SQL

# Run bootstrap three times
for i in 1 2 3; do
    sqlite3 "$TMPDB" < "$SKILL_DIR/sql/v1-bootstrap.sql"
done

# Assert exactly one row in pika_schema_version with version=1
COUNT=$(sqlite3 "$TMPDB" "SELECT COUNT(*) FROM pika_schema_version WHERE version=1;")
[[ "$COUNT" == "1" ]] || { echo "FAIL: expected 1 schema-version row, got $COUNT"; exit 1; }

# Assert pika_observations table exists with expected columns
COLS=$(sqlite3 "$TMPDB" "PRAGMA table_info(pika_observations);" | awk -F'|' '{print $2}' | sort | tr '\n' ',')
EXPECTED="bug_id,cc_session_id,created_at,h_id,id,kind,notes,predicate,recurrence,reviewed_at,severity,subkind,t_id,tool_call_id,u_id,verdict,"
[[ "$COLS" == "$EXPECTED" ]] || { echo "FAIL: column mismatch"; echo "got:      $COLS"; echo "expected: $EXPECTED"; exit 1; }

echo "PASS: bootstrap idempotent + schema correct"
