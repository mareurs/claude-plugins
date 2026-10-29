#!/usr/bin/env bash
# Test for wake-on-job-end.mjs: the asyncRewake hook that wakes the session
# when a codescout background job (run_command run_in_background) ends.
#
# Contract under test: exit 2 + stderr message = deliberate wake-up; exit 0 =
# nothing to say (fail-open). No jq and no python3 here: JSON is built and read
# with node, so the suite runs on every CI platform.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/wake-on-job-end.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CODESCOUT_WAKE_DEADLINE_SECS=3
export CODESCOUT_WAKE_POLL_MS=100

# A pid that is certainly dead: a child that has been reaped.
true & DEAD=$!; wait "$DEAD" 2>/dev/null

# mkrec FILE STATE SERVER_PID JOB_PID  -> atomic-ish record write
mkrec() {
  node -e '
    const fs = require("fs");
    const [f, state, sp, jp] = process.argv.slice(1);
    const fin = state === "running" ? null : "2026-10-29T10:00:05Z";
    const rec = { schema: 1, handle: "@bg_00000001", command: "sleep 1",
      server_pid: Number(sp), job_pid: jp === "null" ? null : Number(jp),
      state, exit_code: state === "exited" ? 0 : null,
      error: state === "failed" ? "spawn boom" : null,
      started_at: "2026-10-29T10:00:00Z", finished_at: fin };
    fs.writeFileSync(f + ".tmp", JSON.stringify(rec));
    fs.renameSync(f + ".tmp", f);
  ' "$@"
}

# mkinput KIND RECORD -> hook input JSON on stdout
mkinput() {
  node -e '
    const [kind, rec] = process.argv.slice(1);
    const inner = {
      spawn:   { output_id: "@bg_00000001", record: rec },
      read:    { output_id: "@bg_00000001", record: rec, exit_code: 0 },
      pending: { pending_ack: "@ack_x" },
    }[kind === "ack" || kind === "agent" ? "spawn" : kind];
    const input = { tool_name: "mcp__codescout__run_command",
      tool_input: { command: kind === "ack" ? "@ack_x" : "sleep 1" },
      tool_response: [{ text: JSON.stringify(inner) }] };
    if (kind === "agent") input.agent_id = "agent-123";
    process.stdout.write(JSON.stringify(input));
  ' "$1" "$2"
}

# run_hook NAME INPUT [env assignments...] -> sets CODE and ERR
run_hook() {
  local name="$1" input="$2"; shift 2
  printf '%s' "$input" | env "$@" node "$HOOK" >"$TMP/$name.out" 2>"$TMP/$name.err"
  CODE=$?
  ERR=$(cat "$TMP/$name.err")
}

expect() { # NAME WANT_CODE SUBSTR(or "" = must be empty stderr)
  local name="$1" want="$2" sub="$3"
  if [ "$CODE" != "$want" ]; then fail "$name" "exit $CODE, want $want; stderr: $ERR"; return; fi
  if [ -z "$sub" ]; then
    [ -z "$ERR" ] && pass "$name" || fail "$name" "stderr not empty: $ERR"
  else
    case "$ERR" in *"$sub"*) pass "$name" ;; *) fail "$name" "stderr lacks '$sub': $ERR" ;; esac
  fi
}

PD="CLAUDE_PROJECT_DIR=$TMP"

# 1. spawn arms, record exited 0
R="$TMP/r1.json"; mkrec "$R" exited "$$" null
run_hook c1 "$(mkinput spawn "$R")" "$PD"
expect "spawn arms, record exited 0" 2 "ended: exited 0"

# 2. record failed
R="$TMP/r2.json"; mkrec "$R" failed "$$" null
run_hook c2 "$(mkinput spawn "$R")" "$PD"
expect "record failed" 2 "failed: spawn boom"

# 3. read response (has exit_code) does not arm
R="$TMP/r3.json"; mkrec "$R" exited "$$" null
run_hook c3 "$(mkinput read "$R")" "$PD"
expect "read response (has exit_code) does not arm" 0 ""

# 4. acked replay arms
R="$TMP/r4.json"; mkrec "$R" exited "$$" null
run_hook c4 "$(mkinput ack "$R")" "$PD"
expect "acked replay arms" 2 "ended:"

# 5. pending ack does not arm
R="$TMP/r5.json"; mkrec "$R" exited "$$" null
run_hook c5 "$(mkinput pending "$R")" "$PD"
expect "pending ack does not arm" 0 ""

# 6. agent_id present does not arm
R="$TMP/r6.json"; mkrec "$R" exited "$$" null
run_hook c6 "$(mkinput agent "$R")" "$PD"
expect "agent_id present does not arm" 0 ""

# 7. no CLAUDE_PROJECT_DIR does not arm
R="$TMP/r7.json"; mkrec "$R" exited "$$" null
run_hook c7 "$(mkinput spawn "$R")" "-u" "CLAUDE_PROJECT_DIR"
expect "no CLAUDE_PROJECT_DIR does not arm" 0 ""

# 8. record vanishes after 0.5 s
R="$TMP/r8.json"; mkrec "$R" running "$$" null
( sleep 0.5; rm -f "$R" ) &
run_hook c8 "$(mkinput spawn "$R")" "$PD"
wait
expect "record vanishes" 2 "vanished"

# 9. two watchers race on one record: exactly one wakes (exit 2)
R="$TMP/r9.json"; mkrec "$R" running "$$" null
INP="$(mkinput spawn "$R")"
printf '%s' "$INP" | env "$PD" node "$HOOK" >"$TMP/c9a.out" 2>"$TMP/c9a.err" & PA=$!
printf '%s' "$INP" | env "$PD" node "$HOOK" >"$TMP/c9b.out" 2>"$TMP/c9b.err" & PB=$!
sleep 0.6; mkrec "$R" exited "$$" null
wait "$PA"; CA=$?; wait "$PB"; CB=$?
if { [ "$CA" = 2 ] && [ "$CB" = 0 ]; } || { [ "$CA" = 0 ] && [ "$CB" = 2 ]; }; then
  pass "two watchers race: exactly one exits 2 ($CA,$CB)"
else
  fail "two watchers race" "exit codes $CA,$CB, want one 2 and one 0"
fi

# 10. heartbeat: record stays running, live server_pid, deadline passes
R="$TMP/r10.json"; mkrec "$R" running "$$" null
START=$SECONDS
run_hook c10 "$(mkinput spawn "$R")" "$PD"
ELAPSED=$((SECONDS-START))
expect "heartbeat" 2 "still running"
[ "$ELAPSED" -le 5 ] && pass "heartbeat within 5 s (${ELAPSED}s)" || fail "heartbeat timing" "took ${ELAPSED}s"
[ ! -e "$R.watch" ] && pass "heartbeat removes <record>.watch" || fail "heartbeat watch file" "$R.watch still exists"

# 11. server dead, job alive
R="$TMP/r11.json"
sleep 1 & JOB=$!
mkrec "$R" running "$DEAD" "$JOB"
START=$SECONDS
run_hook c11 "$(mkinput spawn "$R")" "$PD"
ELAPSED=$((SECONDS-START))
# The hook must have WAITED for the job: it returns only after the job pid died.
if kill -0 "$JOB" 2>/dev/null; then fail "server dead, job alive: waits for the job" "job still alive when hook returned"; else pass "server dead, job alive: waits for the job (job dead on return)"; fi
wait "$JOB" 2>/dev/null
expect "server dead, job alive: no longer valid" 2 "no longer valid"
case "$ERR" in *"has also ended"*) pass "server dead, job alive: has also ended" ;; *) fail "server dead, job alive" "no 'has also ended': $ERR" ;; esac

# 11b. server dead, job outlives the deadline: still running as pid N
R="$TMP/r11b.json"
sleep 10 & JOB=$!
mkrec "$R" running "$DEAD" "$JOB"
run_hook c11b "$(mkinput spawn "$R")" "$PD"
kill "$JOB" 2>/dev/null; wait "$JOB" 2>/dev/null
expect "server dead, job still running at deadline" 2 "still running as pid $JOB"
case "$ERR" in *"no longer valid"*) pass "server dead, job running: no longer valid" ;; *) fail "server dead, job running" "no 'no longer valid': $ERR" ;; esac
case "$ERR" in *"tail -50"*) fail "server dead, job running" "stderr offers tail -50: $ERR" ;; *) pass "server dead, job running: no tail -50" ;; esac

# 12. server dead, job dead
R="$TMP/r12.json"; mkrec "$R" running "$DEAD" "$DEAD"
run_hook c12 "$(mkinput spawn "$R")" "$PD"
expect "server dead, job dead" 2 "state is unknown"
case "$ERR" in *"tail -50"*) fail "server dead, job dead" "stderr offers tail -50: $ERR" ;; *) pass "server dead, job dead: no tail -50" ;; esac

echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
