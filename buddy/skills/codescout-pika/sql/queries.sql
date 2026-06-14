-- Pika queries against codescout's tool_calls — Iron Law predicate matrix
-- + judgment-based tool-bug candidate query.
-- Each query takes :since_id (and Iron Law 4 also takes :home_project).
-- NOTE: codescout writes outcome ∈ {'success','error','recoverable_error'} (src/usage/db.rs)
-- — NOT 'ok'. Any predicate filtering on outcome MUST use these values; an earlier
-- 'ok' assumption made Iron Law 1/2 match zero rows and the tool-bug query match every row.

-- === Iron Law 1: read_file on source ===
-- Anchor: subkind = 'iron_law_1'
-- INTENT: read_file on .rs/.py/.ts/.tsx/.js/.go/.java/.kt should have been symbols(...)
SELECT id, called_at, input_json
FROM tool_calls
WHERE tool_name = 'read_file'
  AND outcome = 'success'
  AND (input_json LIKE '%"path":"%.rs"%'
    OR input_json LIKE '%"path":"%.py"%'
    OR input_json LIKE '%"path":"%.ts"%'
    OR input_json LIKE '%"path":"%.tsx"%'
    OR input_json LIKE '%"path":"%.js"%'
    OR input_json LIKE '%"path":"%.go"%'
    OR input_json LIKE '%"path":"%.java"%'
    OR input_json LIKE '%"path":"%.kt"%')
  AND id > :since_id;

-- === Iron Law 2: edit_file with structural keywords ===
-- Anchor: subkind = 'iron_law_2'
-- INTENT: edit_file containing fn/class/struct/def/interface/trait should have been edit_code
SELECT id, called_at, input_json
FROM tool_calls
WHERE tool_name = 'edit_file'
  AND outcome = 'success'
  AND (input_json LIKE '%"new_string":"%fn %'
    OR input_json LIKE '%"new_string":"%class %'
    OR input_json LIKE '%"new_string":"%struct %'
    OR input_json LIKE '%"new_string":"%def %'
    OR input_json LIKE '%"new_string":"%interface %'
    OR input_json LIKE '%"new_string":"%trait %')
  AND id > :since_id;

-- === Iron Law 3: run_command with pipe ===
-- Anchor: subkind = 'iron_law_3'
-- INTENT: piping defeats the @cmd_* buffer system
-- NOTE on self-exclusion: pika's own scan/insert queries falsely match the
-- base predicate because the SQL text passed to sqlite3 contains the pipe
-- pattern as a literal substring. Two discriminators filter those out:
--
--   1. INSTR('''%|') > 0  → the literal substring `'%|` (single-quote +
--      percent + pipe, adjacent) appears only inside SQL `LIKE '%| grep%'`
--      patterns, never in real shell commands.
--   2. INSTR('pika_observations') > 0  → only pika touches that table.
--      Catches INSERT statements that embed violation text (e.g.
--      "cargo test 2>&1 | tail -3") in notes columns; the LIKE-pipe-pattern
--      then matches the notes content, not a real pipe.
--
-- (Earlier attempt used LIKE '%''%|%' which was broken: SQL `%` between
-- '' and | is a wildcard, not a literal, so it matched any command with
-- both a `'` and a later `|` — far too broad. Use INSTR for literal
-- substring matching.)
-- False-positive class observed 2026-05-17.
SELECT id, called_at, input_json
FROM tool_calls
WHERE tool_name = 'run_command'
  AND (input_json LIKE '%| grep%'
    OR input_json LIKE '%| wc%'
    OR input_json LIKE '%| head%'
    OR input_json LIKE '%| tail%')
  AND INSTR(input_json, '''%|') = 0
  AND INSTR(input_json, 'pika_observations') = 0
  AND id > :since_id;

-- === Iron Law 4: workspace activate without restore ===
-- Anchor: subkind = 'iron_law_4'
-- INTENT: workspace activate to a non-home project must be paired with a later
--         activate back to home in the same cc_session_id. Unpaired activates
--         pollute the shared MCP server state for the next session.
-- NOTE: requires SQLite JSON1 (json_extract). Falls back to LIKE if unavailable.
WITH activates AS (
    SELECT id, cc_session_id, called_at,
           json_extract(input_json, '$.path')   AS target,
           json_extract(input_json, '$.action') AS action
    FROM tool_calls
    WHERE tool_name = 'workspace'
      AND json_extract(input_json, '$.action') = 'activate'
      AND id > :since_id
)
SELECT a.id, a.called_at, a.target, a.cc_session_id
FROM activates a
WHERE a.target != :home_project
  AND NOT EXISTS (
      SELECT 1 FROM activates b
      WHERE b.cc_session_id = a.cc_session_id
        AND b.id > a.id
        AND b.target = :home_project
  );

-- === Tool bug candidates (judgment-based) ===
-- Anchor: kind = 'tool_bug', subkind set by Pika at write time
-- INTENT: surface candidate rows for Pika to judge. Pika decides if each is
--         a real bug, then writes pika_observations row with verdict.
SELECT id, tool_name, outcome, error_msg, output_json, called_at
FROM tool_calls
WHERE (outcome IN ('error', 'recoverable_error')
   OR LENGTH(output_json) > 100000
   OR error_msg IS NOT NULL)
  AND id > :since_id;

-- === Silent param-drop candidates (kind='misusage', subkind='silent_param_drop') ===
-- INTENT: caller passed a parameter the tool SILENTLY IGNORED on this code path — the
-- call returns outcome='success' with default/wrong content, normal-sized, no error_msg.
-- This class NEVER trips the error-gated tool-bug query above; it is the
-- read_file(offset/limit on @buffer) bug class (codescout fix shipped 2026-06-14).
--
-- Detection is two-step; STEP 2 is Pika's judgment pass, not pure SQL.
--
-- STEP 1 (this query): enumerate, per tool, the distinct top-level input keys callers
-- actually sent on successful calls. Requires SQLite JSON1 (json_each).
SELECT tc.tool_name, je.key AS input_key, COUNT(*) AS n
FROM tool_calls tc, json_each(tc.input_json) je
WHERE tc.outcome = 'success'
  AND tc.id > :since_id
GROUP BY tc.tool_name, je.key
ORDER BY tc.tool_name, n DESC;
--
-- STEP 2 (Pika judges): for each tool, compare the keys above against the tool's DECLARED
-- params (read its input_schema from codescout's tool list, or get_guide). The MCP layer
-- forwards UNDECLARED params straight into the tool's input, so a key callers send that the
-- schema does not declare — and that the code path does not consume — is a silent param-drop:
-- the tool returns default content with outcome='success'. Confirm the path ignores the key
-- (read the tool's handler), then write a pika_observations row: kind='misusage',
-- subkind='silent_param_drop', severity by blast radius (calls x wrongness), notes naming
-- the tool + ignored key. Recurrence across sessions promotes the finding to a tool_bug.
