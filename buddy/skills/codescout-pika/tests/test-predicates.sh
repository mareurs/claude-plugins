#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDB=$(mktemp /tmp/pika-predicate-test.XXXXXX.db)
trap 'rm -f "$TMPDB" "$TMPDB-wal" "$TMPDB-shm"' EXIT

# Seed minimal tool_calls + bootstrap
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
sqlite3 "$TMPDB" < "$SKILL_DIR/sql/v1-bootstrap.sql"
sqlite3 "$TMPDB" < "$SKILL_DIR/tests/fixtures.sql"

# === Iron Law 1: read_file on source ===
COUNT=$(sqlite3 "$TMPDB" \
    "SELECT COUNT(*) FROM tool_calls
     WHERE tool_name='read_file' AND outcome='success'
       AND (input_json LIKE '%\"path\":\"%.rs\"%'
         OR input_json LIKE '%\"path\":\"%.py\"%'
         OR input_json LIKE '%\"path\":\"%.ts\"%'
         OR input_json LIKE '%\"path\":\"%.tsx\"%'
         OR input_json LIKE '%\"path\":\"%.js\"%'
         OR input_json LIKE '%\"path\":\"%.go\"%'
         OR input_json LIKE '%\"path\":\"%.java\"%'
         OR input_json LIKE '%\"path\":\"%.kt\"%')")
[[ "$COUNT" == "1" ]] || { echo "FAIL: iron_law_1 expected 1 match, got $COUNT"; exit 1; }

# === Iron Law 2: edit_file with structural keywords ===
COUNT=$(sqlite3 "$TMPDB" \
    "SELECT COUNT(*) FROM tool_calls
     WHERE tool_name='edit_file' AND outcome='success'
       AND (input_json LIKE '%\"new_string\":\"%fn %'
         OR input_json LIKE '%\"new_string\":\"%class %'
         OR input_json LIKE '%\"new_string\":\"%struct %'
         OR input_json LIKE '%\"new_string\":\"%def %'
         OR input_json LIKE '%\"new_string\":\"%interface %'
         OR input_json LIKE '%\"new_string\":\"%trait %')")
[[ "$COUNT" == "1" ]] || { echo "FAIL: iron_law_2 expected 1 match, got $COUNT"; exit 1; }

# === Iron Law 3: run_command with pipe ===
COUNT=$(sqlite3 "$TMPDB" \
    "SELECT COUNT(*) FROM tool_calls
     WHERE tool_name='run_command'
       AND (input_json LIKE '%| grep%'
         OR input_json LIKE '%| wc%'
         OR input_json LIKE '%| head%'
         OR input_json LIKE '%| tail%')")
[[ "$COUNT" == "1" ]] || { echo "FAIL: iron_law_3 expected 1 match, got $COUNT"; exit 1; }

# === queries.sql must contain canonical Iron Law 4 block ===
grep -q "Iron Law 4: workspace activate without restore" "$SKILL_DIR/sql/queries.sql"
[[ $? -eq 0 ]] || { echo "FAIL: queries.sql missing canonical Iron Law 4 block"; exit 1; }

# === Iron Law 4: workspace activate without restore ===
# Use the CTE pattern with :home_project='home' and :since_id=0
COUNT=$(sqlite3 "$TMPDB" \
    "WITH activates AS (
        SELECT id, cc_session_id, called_at,
               json_extract(input_json, '\$.path')   AS target,
               json_extract(input_json, '\$.action') AS action
        FROM tool_calls
        WHERE tool_name = 'workspace'
          AND json_extract(input_json, '\$.action') = 'activate'
          AND id > 0
     )
     SELECT COUNT(*) FROM activates a
     WHERE a.target != 'home'
       AND NOT EXISTS (
           SELECT 1 FROM activates b
           WHERE b.cc_session_id = a.cc_session_id
             AND b.id > a.id
             AND b.target = 'home'
       );")
[[ "$COUNT" == "1" ]] || { echo "FAIL: iron_law_4 expected 1 match (session B), got $COUNT"; exit 1; }

# Verify the single match is session B specifically
SESS=$(sqlite3 "$TMPDB" \
    "WITH activates AS (
        SELECT id, cc_session_id,
               json_extract(input_json, '\$.path') AS target
        FROM tool_calls
        WHERE tool_name = 'workspace'
          AND json_extract(input_json, '\$.action') = 'activate'
          AND id > 0
     )
     SELECT a.cc_session_id FROM activates a
     WHERE a.target != 'home'
       AND NOT EXISTS (
           SELECT 1 FROM activates b
           WHERE b.cc_session_id = a.cc_session_id
             AND b.id > a.id
             AND b.target = 'home'
       );")
[[ "$SESS" == "sess-B" ]] || { echo "FAIL: iron_law_4 expected sess-B, got $SESS"; exit 1; }

# === queries.sql must contain canonical Tool Bug block ===
grep -q "Tool bug candidates (judgment-based)" "$SKILL_DIR/sql/queries.sql"
[[ $? -eq 0 ]] || { echo "FAIL: queries.sql missing canonical tool-bug block"; exit 1; }

# === Tool bug candidates ===
# Expected: 1 match from sess-E (the symbols-with-LSP-timeout error)
COUNT=$(sqlite3 "$TMPDB" \
    "SELECT COUNT(*) FROM tool_calls
     WHERE (outcome IN ('error', 'recoverable_error')
        OR LENGTH(output_json) > 100000
        OR error_msg IS NOT NULL)
       AND id > 0")
[[ "$COUNT" == "1" ]] || { echo "FAIL: tool_bug candidate expected 1, got $COUNT"; exit 1; }

# === Silent param-drop STEP 1: param-surface query (json_each) ===
# The undeclared key 'bogus_param' on a successful read_file must be surfaced.
COUNT=$(sqlite3 "$TMPDB" \
    "SELECT COUNT(*) FROM (
        SELECT tc.tool_name AS tn, je.key AS input_key
        FROM tool_calls tc, json_each(tc.input_json) je
        WHERE tc.outcome='success' AND tc.id > 0
        GROUP BY tc.tool_name, je.key
     ) WHERE tn='read_file' AND input_key='bogus_param'")
[[ "$COUNT" == "1" ]] || { echo "FAIL: param-surface expected to surface bogus_param once, got $COUNT"; exit 1; }

# === queries.sql must contain the silent param-drop detector block ===
grep -q "Silent param-drop candidates" "$SKILL_DIR/sql/queries.sql"
[[ $? -eq 0 ]] || { echo "FAIL: queries.sql missing silent param-drop block"; exit 1; }

echo "PASS: all predicates + tool-bug candidates + param-surface detect expected fixture rows"
