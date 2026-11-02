#!/usr/bin/env bash
# Test for native-call-record.mjs: a PostToolUse hook that appends ONE line per native tool call
# (Read, Grep, Glob, Agent, WebFetch) to a machine-local JSONL file, so usage analysis can count
# the calls codescout's own recorder never sees (codescout:docs/issues/2026-09-01-tool-call-recorder-cannot-see-the-arm-under-evaluation.md).
#
# Payload shapes below are the ones a real `claude -p` run delivered on 2026-11-02 (2.1.316): every
# payload has session_id, tool_use_id, tool_name, tool_input, duration_ms, cwd; agent_id and
# agent_type appear only on a subagent's own call.
#
# Invariants, in the order they matter:
#   - the hook never blocks and never speaks: exit 0, empty stdout, whatever happens
#   - the line never carries what was asked (path, pattern, prompt, URL path): only counts-grade fields
#   - a subagent call keeps its agent_id, because separating it from the main thread is the point
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="${NATIVE_CALL_HOOK:-$SCRIPT_DIR/native-call-record.mjs}"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
STATE="$TMP/state"
PROJ="$TMP/proj"; mkdir -p "$PROJ/.git" "$PROJ/sub/dir"
LOG_DIR="$STATE/codescout/native-calls"
month() { date -u +%Y-%m; }
LOG="$LOG_DIR/$(month).jsonl"

# run_hook <stdin-json> [extra env assignments...]; prints "<exit>|<stdout>" so a test can check both.
run_hook() {
  local payload="$1"; shift
  local out rc
  out=$(printf '%s' "$payload" | env XDG_STATE_HOME="$STATE" "$@" node "$HOOK" 2>/dev/null); rc=$?
  printf '%s|%s' "$rc" "$out"
}
lines() { [ -f "$LOG" ] && wc -l < "$LOG" | tr -d ' ' || echo 0; }
field() { # <line-number> <key>
  python3 -I -c "
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
v=rows[int(sys.argv[2])-1].get(sys.argv[3])
print('<absent>' if sys.argv[3] not in rows[int(sys.argv[2])-1] else v)
" "$LOG" "$1" "$2"
}

READ_MAIN='{"session_id":"s-1","tool_use_id":"toolu_A","tool_name":"Read","tool_input":{"file_path":"'"$PROJ"'/sub/dir/SECRET-notes.txt"},"duration_ms":12,"cwd":"'"$PROJ"'/sub/dir","hook_event_name":"PostToolUse"}'
READ_SUB='{"session_id":"s-1","agent_id":"aab88334f989e752c","agent_type":"general-purpose","tool_use_id":"toolu_B","tool_name":"Read","tool_input":{"file_path":"'"$PROJ"'/b.rs"},"duration_ms":7,"cwd":"'"$PROJ"'","hook_event_name":"PostToolUse"}'
GREP='{"session_id":"s-1","tool_use_id":"toolu_C","tool_name":"Grep","tool_input":{"path":"'"$PROJ"'/src","pattern":"SECRET-pattern"},"duration_ms":30,"cwd":"'"$PROJ"'"}'
AGENT='{"session_id":"s-1","tool_use_id":"toolu_D","tool_name":"Agent","tool_input":{"description":"d","prompt":"SECRET-prompt","subagent_type":"Explore"},"duration_ms":5,"cwd":"'"$PROJ"'"}'
FETCH='{"session_id":"s-1","tool_use_id":"toolu_E","tool_name":"WebFetch","tool_input":{"url":"https://example.org/SECRET/path?q=1","prompt":"p"},"duration_ms":400,"cwd":"'"$PROJ"'"}'
GLOB='{"session_id":"s-1","tool_use_id":"toolu_F","tool_name":"Glob","tool_input":{"pattern":"**/*.rs"},"duration_ms":3,"cwd":"'"$PROJ"'"}'

# 1. The hook never speaks and never fails, on a normal call.
res=$(run_hook "$READ_MAIN")
[ "$res" = "0|" ] && pass "a recorded call exits 0 with empty stdout" || fail "a recorded call exits 0 with empty stdout" "got '$res'"
[ "$(lines)" = "1" ] && pass "one call writes one line" || fail "one call writes one line" "lines=$(lines)"

# 2. Main-thread call: the fields that make a count useful, and no agent_id key value.
[ "$(field 1 tool)" = "Read" ] && pass "the tool name is recorded" || fail "the tool name is recorded" "$(field 1 tool)"
[ "$(field 1 session_id)" = "s-1" ] && pass "the session id is recorded (the join key to usage.db cc_session_id)" || fail "the session id is recorded" "$(field 1 session_id)"
[ "$(field 1 tool_use_id)" = "toolu_A" ] && pass "the tool_use_id is recorded" || fail "the tool_use_id is recorded" "$(field 1 tool_use_id)"
[ "$(field 1 duration_ms)" = "12" ] && pass "duration_ms is recorded" || fail "duration_ms is recorded" "$(field 1 duration_ms)"
[ "$(field 1 ext)" = "txt" ] && pass "only the file extension of a Read is kept" || fail "only the file extension of a Read is kept" "$(field 1 ext)"
[ "$(field 1 agent_id)" = "<absent>" ] && pass "a main-thread call has no agent_id key at all" || fail "a main-thread call has no agent_id key at all" "$(field 1 agent_id)"
[ "$(field 1 agent_type)" = "<absent>" ] && pass "a main-thread call has no agent_type key either" || fail "a main-thread call has no agent_type key either" "$(field 1 agent_type)"

# 3. The project is the enclosing root, not the subdirectory the call came from.
[ "$(field 1 project)" = "$PROJ" ] && pass "project is the enclosing root of a cwd in a subdirectory" || fail "project is the enclosing root" "$(field 1 project)"

# 4. A subagent call keeps its agent_id and agent_type.
run_hook "$READ_SUB" >/dev/null
[ "$(field 2 agent_id)" = "aab88334f989e752c" ] && pass "a subagent call keeps its agent_id" || fail "a subagent call keeps its agent_id" "$(field 2 agent_id)"
[ "$(field 2 agent_type)" = "general-purpose" ] && pass "a subagent call keeps its agent_type" || fail "a subagent call keeps its agent_type" "$(field 2 agent_type)"
[ "$(field 2 ext)" = "rs" ] && pass "a Rust file read is classed by extension" || fail "a Rust file read is classed by extension" "$(field 2 ext)"

# 5. Per-tool fields.
run_hook "$GREP" >/dev/null; run_hook "$AGENT" >/dev/null; run_hook "$FETCH" >/dev/null; run_hook "$GLOB" >/dev/null
[ "$(field 3 tool)" = "Grep" ] && pass "a Grep is recorded" || fail "a Grep is recorded" "$(field 3 tool)"
[ "$(field 4 subagent_type)" = "Explore" ] && pass "an Agent call records its subagent_type" || fail "an Agent call records its subagent_type" "$(field 4 subagent_type)"
[ "$(field 5 host)" = "example.org" ] && pass "a WebFetch records the host only" || fail "a WebFetch records the host only" "$(field 5 host)"
[ "$(field 6 tool)" = "Glob" ] && pass "a Glob is recorded" || fail "a Glob is recorded" "$(field 6 tool)"

# 6. PRIVACY: nothing of what was asked reaches the file.
leaked=0
for needle in "SECRET-notes" "SECRET-pattern" "SECRET-prompt" "/SECRET/path" "$PROJ/sub"; do
  grep -qF -- "$needle" "$LOG" && { leaked=1; echo "  leaked: $needle"; }
done
[ "$leaked" = "0" ] && pass "no path, pattern, prompt or URL path is written" || fail "no path, pattern, prompt or URL path is written" "see leaked lines above"

# 7. Every line is valid JSON with a schema version and a timestamp.
bad=$(python3 -I -c "
import json,sys
n=0
for l in open(sys.argv[1]):
    if not l.strip(): continue
    m=json.loads(l)
    if m.get('v')!=1 or not m.get('ts'): n+=1
print(n)
" "$LOG")
[ "$bad" = "0" ] && pass "every line carries v=1 and a ts" || fail "every line carries v=1 and a ts" "$bad bad"

# 8. The hook is silent and exits 0 on garbage, on empty stdin, and when the state dir cannot be written.
before=$(lines)
res=$(run_hook "not json at all"); [ "$res" = "0|" ] && pass "garbage stdin: exit 0, silent" || fail "garbage stdin: exit 0, silent" "got '$res'"
res=$(run_hook ""); [ "$res" = "0|" ] && pass "empty stdin: exit 0, silent" || fail "empty stdin: exit 0, silent" "got '$res'"
res=$(run_hook '{"tool_name":"Read"}'); [ "$res" = "0|" ] && pass "a payload without session or cwd: exit 0, silent" || fail "a payload without session or cwd" "got '$res'"
[ "$(lines)" = "$((before + 1))" ] && pass "a payload with a tool but no session is still counted once; garbage and empty are not" || fail "garbage/empty write nothing, a bare tool writes one" "before=$before after=$(lines)"
ro="$TMP/ro"; mkdir -p "$ro"; chmod 0555 "$ro"
res=$(printf '%s' "$READ_MAIN" | env XDG_STATE_HOME="$ro/nope" node "$HOOK" 2>/dev/null; echo "rc=$?")
chmod 0755 "$ro"
case "$res" in *"rc=0") pass "an unwritable state dir: exit 0" ;; *) fail "an unwritable state dir: exit 0" "got '$res'" ;; esac

# 9. The opt-out switch writes nothing.
before=$(lines)
res=$(run_hook "$READ_MAIN" CS_NATIVE_CALL_LOG=off)
[ "$res" = "0|" ] && [ "$(lines)" = "$before" ] && pass "CS_NATIVE_CALL_LOG=off writes nothing" || fail "CS_NATIVE_CALL_LOG=off writes nothing" "res='$res' lines $before -> $(lines)"

# 10. A tool outside the set is not recorded (the matcher is the first filter, this is the second).
before=$(lines)
run_hook '{"session_id":"s-1","tool_name":"mcp__codescout__symbols","tool_input":{},"cwd":"'"$PROJ"'"}' >/dev/null
[ "$(lines)" = "$before" ] && pass "a codescout MCP call is not recorded here (usage.db has it)" || fail "a codescout MCP call is not recorded here" "lines $before -> $(lines)"

# 11. Concurrent writers do not tear lines: 40 writers, every line parses.
before=$(lines)
for i in $(seq 1 40); do
  ( printf '%s' "$READ_MAIN" | XDG_STATE_HOME="$STATE" node "$HOOK" >/dev/null 2>&1 ) &
done
wait
broken=$(python3 -I -c "
import json,sys
b=0
for l in open(sys.argv[1]):
    if not l.strip(): continue
    try: json.loads(l)
    except Exception: b+=1
print(b)
" "$LOG")
[ "$broken" = "0" ] && [ "$(lines)" = "$((before + 40))" ] && pass "40 concurrent writers: 40 whole lines, none torn" || fail "40 concurrent writers: 40 whole lines" "broken=$broken lines $before -> $(lines)"

# 12. REGISTRATION: the hook is wired in hooks.json for exactly the recorded tools, and ASYNC. Measured
# 2026-11-02 with a real `claude -p` run and a hook that sleeps 4 s: no hook 6.6 s, sync 13.8 s,
# async 5.9 s. A synchronous registration adds this process (about 43 ms) to every native call;
# async takes it off the call path. A green hook with a sync registration would pass every case above.
reg=$(python3 -I -c "
import json,sys
d=json.load(open(sys.argv[1]))
hits=[(e.get('matcher'),h.get('async')) for e in d['hooks']['PostToolUse'] for h in e['hooks'] if 'native-call-record.mjs' in h.get('command','')]
print(hits[0] if len(hits)==1 else ('count',len(hits)))
" "$SCRIPT_DIR/hooks.json")
[ "$reg" = "('Read|Grep|Glob|Agent|WebFetch', True)" ] && pass "hooks.json registers the hook once, for the five native tools, async" || fail "hooks.json registers the hook once, for the five native tools, async" "got $reg"

echo; echo "native-call-record: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
