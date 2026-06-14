-- Predicate-correctness fixtures for Pika queries.
-- Each row is hand-crafted to either match exactly one predicate or none.

-- Iron Law 1 fixtures (read_file on source)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('read_file', 10, 'success',  '{"path":"src/lib.rs"}',    'sess-A'),   -- MATCH iron_law_1
    ('read_file', 10, 'success',  '{"path":"docs/README.md"}', 'sess-A'),  -- no match (md)
    ('read_file', 10, 'success',  '{"path":"src/lib.rs.bak"}', 'sess-A');  -- no match (trailing " forces exact extension)

-- Iron Law 2 fixtures (edit_file with structural keyword)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('edit_file', 10, 'success',  '{"new_string":"// fn keyword in comment"}', 'sess-A'),  -- MATCH iron_law_2 (Pika will judge severity=low)
    ('edit_file', 10, 'success',  '{"new_string":"const FOO: u32 = 5;"}',      'sess-A'); -- no match

-- Iron Law 3 fixtures (run_command with pipe)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('run_command', 10, 'success', '{"command":"cargo test | grep FAILED"}', 'sess-A'),  -- MATCH iron_law_3
    ('run_command', 10, 'success', '{"command":"echo hi"}',                  'sess-A'); -- no match

-- Iron Law 4 fixtures (workspace activate without restore)
-- session B: activate to foreign with NO restore (should match)
-- session C: activate to foreign + later activate to home (should NOT match)
-- session D: sole activate to home (should NOT match)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('workspace', 5, 'success', '{"action":"activate","path":"foreign"}', 'sess-B'),
    ('workspace', 5, 'success', '{"action":"activate","path":"foreign"}', 'sess-C'),
    ('workspace', 5, 'success', '{"action":"activate","path":"home"}',    'sess-C'),
    ('workspace', 5, 'success', '{"action":"activate","path":"home"}',    'sess-D');

-- Tool bug candidate fixtures
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, output_json, error_msg, cc_session_id) VALUES
    ('symbols', 50, 'error', '{"name":"X"}', NULL, 'LSP timeout',   'sess-E'),   -- MATCH tool_bug (outcome IN error/recoverable_error)
    ('grep',    20, 'success',    '{"pattern":"X"}', '{"matches":[]}',   NULL,        'sess-E'); -- no match (success, no error_msg, small output) — proves the de-flood

-- Silent param-drop fixture (STEP 1 param-surface query via json_each).
-- A successful read_file carrying a param the schema does not declare ('bogus_param').
-- path "x" has no source extension, so it does NOT match Iron Law 1.
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('read_file', 10, 'success', '{"path":"x","bogus_param":"1"}', 'sess-F');  -- param-surface surfaces key 'bogus_param'
