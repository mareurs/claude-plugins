#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USAGE_DB="$HOME/work/claude/codescout/.codescout/usage.db"

[[ -f "$USAGE_DB" ]] || { echo "SKIP: $USAGE_DB not found"; exit 0; }

# Bootstrap schema against the real DB (idempotent — safe)
sqlite3 "$USAGE_DB" < "$SKILL_DIR/sql/v1-bootstrap.sql"

# Verify the new table is present
TABLE_PRESENT=$(sqlite3 "$USAGE_DB" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='pika_observations';")
[[ "$TABLE_PRESENT" == "1" ]] || { echo "FAIL: pika_observations not created"; exit 1; }

# Verify schema version
VERSION=$(sqlite3 "$USAGE_DB" "SELECT MAX(version) FROM pika_schema_version;")
[[ "$VERSION" == "1" ]] || { echo "FAIL: schema version is $VERSION, expected 1"; exit 1; }

# Run each Iron Law predicate against the real DB; counts are observational
SINCE_ID=0

IL1=$(sqlite3 "$USAGE_DB" \
    "SELECT COUNT(*) FROM tool_calls
     WHERE tool_name='read_file' AND outcome='success'
       AND (input_json LIKE '%\"path\":\"%.rs\"%'
         OR input_json LIKE '%\"path\":\"%.py\"%'
         OR input_json LIKE '%\"path\":\"%.ts\"%'
         OR input_json LIKE '%\"path\":\"%.tsx\"%'
         OR input_json LIKE '%\"path\":\"%.js\"%'
         OR input_json LIKE '%\"path\":\"%.go\"%'
         OR input_json LIKE '%\"path\":\"%.java\"%'
         OR input_json LIKE '%\"path\":\"%.kt\"%')
       AND id > $SINCE_ID")

IL2=$(sqlite3 "$USAGE_DB" \
    "SELECT COUNT(*) FROM tool_calls
     WHERE tool_name='edit_file' AND outcome='success'
       AND (input_json LIKE '%\"new_string\":\"%fn %'
         OR input_json LIKE '%\"new_string\":\"%class %'
         OR input_json LIKE '%\"new_string\":\"%struct %'
         OR input_json LIKE '%\"new_string\":\"%def %'
         OR input_json LIKE '%\"new_string\":\"%interface %'
         OR input_json LIKE '%\"new_string\":\"%trait %')
       AND id > $SINCE_ID")

IL3=$(sqlite3 "$USAGE_DB" \
    "SELECT COUNT(*) FROM tool_calls
     WHERE tool_name='run_command'
       AND (input_json LIKE '%| grep%'
         OR input_json LIKE '%| wc%'
         OR input_json LIKE '%| head%'
         OR input_json LIKE '%| tail%')
       AND id > $SINCE_ID")

echo "Meadow check against $USAGE_DB:"
echo "  Iron Law 1 (read_file on source):     $IL1 candidates"
echo "  Iron Law 2 (edit_file structural):    $IL2 candidates"
echo "  Iron Law 3 (run_command piped):       $IL3 candidates"
echo "  (Iron Law 4 requires JSON1 — skipping in smoke; see test-predicates.sh)"
echo "PASS: pipeline alive against real usage.db (counts above are observational, not asserted)"
