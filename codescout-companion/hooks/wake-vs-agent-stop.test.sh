#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/wake-vs-agent-stop.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export XDG_STATE_HOME="$TMP/state"
WAKE="$XDG_STATE_HOME/codescout-companion/wake"
mkdir -p "$WAKE"

mkrec() {
  node -e '
    const fs=require("fs");
    const [f,state,sp]=process.argv.slice(1);
    const rec={schema:1,handle:"@bg_00000001",command:"sleep 1",server_pid:Number(sp),job_pid:null,state,exit_code:state==="exited"?0:null,error:state==="failed"?"spawn boom":null,started_at:"2026-11-18T14:30:00Z",finished_at:state==="exited"?"2026-11-18T14:30:03Z":null};
    fs.writeFileSync(f,JSON.stringify(rec));
  ' "$@"
}
mkmap() { printf '%s' "$2" >"$WAKE/map-$1-@bg_00000001"; }

true & DEAD=$!; wait "$DEAD" 2>/dev/null

R="$TMP/terminal.json"; mkrec "$R" exited "$$"; mkmap sess-terminal "$R"; rm -f "$R.delivered"
printf '%s' '{"hook_event_name":"Stop","session_id":"sess-terminal","stop_hook_active":false,"cwd":"/home/marius/work/claude/codescout"}' | env -u CLAUDE_PROJECT_DIR -u CLAUDE_CONFIG_DIR XDG_STATE_HOME="$TMP/state" COPILOT_WAKE_STOP_TIMEOUT_MS=2000 node "$HOOK" >"$TMP/o-terminal" 2>"$TMP/e-terminal"
O=$(cat "$TMP/o-terminal")
case "$O" in *'"decision":"block"'*'ended: exited 0'*) pass "terminal job: AgentStop blocks with wake" ;; *) fail "terminal job: AgentStop block" "got: $O" ;; esac
case "$O" in *'"hookSpecificOutput":{"hookEventName":"Stop","decision":"block"'*) pass "terminal job: Local-harness hookSpecificOutput" ;; *) fail "terminal job: hookSpecificOutput" "got: $O" ;; esac
[ -f "$R.delivered" ] && pass "terminal job: delivery claimed" || fail "terminal job: delivered" "missing $R.delivered"

R="$TMP/running.json"; mkrec "$R" running "$$"; mkmap sess-running @bg_00000001 >/dev/null 2>&1 || true
# The helper mkmap is fixed to handle 1, so the map name and record are enough here.
printf '%s' "$R" >"$WAKE/map-sess-running-@bg_00000001"
(printf '%s' '{"hook_event_name":"Stop","session_id":"sess-running","stop_hook_active":false,"cwd":"/home/marius/work/claude/codescout"}' | env -u CLAUDE_PROJECT_DIR -u CLAUDE_CONFIG_DIR XDG_STATE_HOME="$TMP/state" COPILOT_WAKE_STOP_TIMEOUT_MS=3000 node "$HOOK" >"$TMP/o-running" 2>"$TMP/e-running") & PW=$!
sleep 0.5
node -e 'const fs=require("fs");const [f,sp]=process.argv.slice(1);fs.writeFileSync(f,JSON.stringify({schema:1,handle:"@bg_00000001",command:"sleep 1",server_pid:Number(sp),job_pid:null,state:"exited",exit_code:0,error:null,started_at:"2026-11-18T14:31:00Z",finished_at:"2026-11-18T14:31:03Z"}))' "$R" "$$"
wait "$PW"
O=$(cat "$TMP/o-running")
case "$O" in *'"decision":"block"'*'ended: exited 0'*) pass "running to terminal: AgentStop blocks" ;; *) fail "running to terminal: AgentStop block" "got: $O" ;; esac

printf '%s' '{"hook_event_name":"Stop","session_id":"sess-none","stop_hook_active":false,"cwd":"/home/marius/work/claude/codescout"}' | env -u CLAUDE_PROJECT_DIR XDG_STATE_HOME="$TMP/state" node "$HOOK" >"$TMP/o-none"
[ -z "$(cat "$TMP/o-none")" ] && pass "no map: allow/empty" || fail "no map: output" "got: $(cat "$TMP/o-none")"

printf '%s' '{"hook_event_name":"Stop","session_id":"sess-terminal","stop_hook_active":true,"cwd":"/home/marius/work/claude/codescout"}' | env -u CLAUDE_PROJECT_DIR XDG_STATE_HOME="$TMP/state" node "$HOOK" >"$TMP/o-active"
[ -z "$(cat "$TMP/o-active")" ] && pass "already delivered: no second block" || fail "already delivered" "got: $(cat "$TMP/o-active")"

R="$TMP/dead.json"; mkrec "$R" running "$DEAD"; printf '%s' "$R" >"$WAKE/map-sess-dead-@bg_00000001"
T0=$(date +%s)
printf '%s' '{"hook_event_name":"Stop","session_id":"sess-dead","stop_hook_active":false,"cwd":"/x"}' | env -u CLAUDE_PROJECT_DIR XDG_STATE_HOME="$TMP/state" COPILOT_WAKE_STOP_TIMEOUT_MS=20000 node "$HOOK" >"$TMP/o-dead"
[ -z "$(cat "$TMP/o-dead")" ] && [ $(( $(date +%s) - T0 )) -lt 5 ] && pass "dead server: no hold" || fail "dead server" "held or blocked: $(cat "$TMP/o-dead")"

printf '%s' '{"hook_event_name":"Stop","session_id":"sess-terminal","stop_hook_active":false,"cwd":"/home/marius/work/claude/codescout"}' | CLAUDE_PROJECT_DIR=/home/marius/work/claude/codescout XDG_STATE_HOME="$TMP/state" node "$HOOK" >"$TMP/o-claude"
[ -z "$(cat "$TMP/o-claude")" ] && pass "Claude/Codex native channel: VS hook skips" || fail "Claude/Codex native channel" "got: $(cat "$TMP/o-claude")"

echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
