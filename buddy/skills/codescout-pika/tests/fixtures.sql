-- Predicate-correctness fixtures for Pika queries.
-- Each row is hand-crafted to either match exactly one predicate or none.

-- Iron Law 1 fixtures (read_file on source)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('read_file', 10, 'ok',  '{"path":"src/lib.rs"}',    'sess-A'),   -- MATCH iron_law_1
    ('read_file', 10, 'ok',  '{"path":"docs/README.md"}', 'sess-A'),  -- no match (md)
    ('read_file', 10, 'ok',  '{"path":"src/lib.rs.bak"}', 'sess-A');  -- no match (trailing " forces exact extension)

-- Iron Law 2 fixtures (edit_file with structural keyword)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('edit_file', 10, 'ok',  '{"new_string":"// fn keyword in comment"}', 'sess-A'),  -- MATCH iron_law_2 (Pika will judge severity=low)
    ('edit_file', 10, 'ok',  '{"new_string":"const FOO: u32 = 5;"}',      'sess-A'); -- no match

-- Iron Law 3 fixtures (run_command with pipe)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('run_command', 10, 'ok', '{"command":"cargo test | grep FAILED"}', 'sess-A'),  -- MATCH iron_law_3
    ('run_command', 10, 'ok', '{"command":"echo hi"}',                  'sess-A'); -- no match

-- Iron Law 4 fixtures (workspace activate without restore)
-- session B: activate to foreign with NO restore (should match)
-- session C: activate to foreign + later activate to home (should NOT match)
-- session D: sole activate to home (should NOT match)
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, cc_session_id) VALUES
    ('workspace', 5, 'ok', '{"action":"activate","path":"foreign"}', 'sess-B'),
    ('workspace', 5, 'ok', '{"action":"activate","path":"foreign"}', 'sess-C'),
    ('workspace', 5, 'ok', '{"action":"activate","path":"home"}',    'sess-C'),
    ('workspace', 5, 'ok', '{"action":"activate","path":"home"}',    'sess-D');

-- Tool bug candidate fixtures
INSERT INTO tool_calls (tool_name, latency_ms, outcome, input_json, output_json, error_msg, cc_session_id) VALUES
    ('symbols', 50, 'error', '{"name":"X"}', NULL, 'LSP timeout',   'sess-E'),   -- MATCH tool_bug (outcome != ok)
    ('grep',    20, 'ok',    '{"pattern":"X"}', '{"matches":[]}',   NULL,        'sess-E'); -- no match
