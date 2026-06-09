#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDB=$(mktemp /tmp/pika-cascade-test.XXXXXX.db)
trap 'rm -f "$TMPDB" "$TMPDB-wal" "$TMPDB-shm"' EXIT

sqlite3 "$TMPDB" <<SQL
CREATE TABLE tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL, latency_ms INTEGER NOT NULL, outcome TEXT NOT NULL,
    overflowed INTEGER NOT NULL DEFAULT 0,
    input_json TEXT, output_json TEXT, error_msg TEXT, cc_session_id TEXT,
    called_at TEXT NOT NULL DEFAULT (datetime('now'))
);
PRAGMA foreign_keys = ON;
SQL
sqlite3 "$TMPDB" < "$SKILL_DIR/sql/v1-bootstrap.sql"

# Insert a tool_call + an observation referencing it
sqlite3 "$TMPDB" "PRAGMA foreign_keys=ON; INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json) VALUES ('test', 1, 'ok', '{}');"
TID=$(sqlite3 "$TMPDB" "SELECT id FROM tool_calls LIMIT 1;")
sqlite3 "$TMPDB" "PRAGMA foreign_keys=ON; INSERT INTO pika_observations (tool_call_id, kind, subkind, verdict, severity) VALUES ($TID, 'iron_law', 'iron_law_1', 'slip', 'low');"

BEFORE=$(sqlite3 "$TMPDB" "SELECT COUNT(*) FROM pika_observations;")
[[ "$BEFORE" == "1" ]] || { echo "FAIL: observation insert failed ($BEFORE rows)"; exit 1; }

# Delete the tool_call; observation should cascade
sqlite3 "$TMPDB" "PRAGMA foreign_keys=ON; DELETE FROM tool_calls WHERE id=$TID;"

AFTER=$(sqlite3 "$TMPDB" "SELECT COUNT(*) FROM pika_observations;")
[[ "$AFTER" == "0" ]] || { echo "FAIL: CASCADE did not fire ($AFTER rows remain)"; exit 1; }

echo "PASS: FK CASCADE removes orphaned observations"
