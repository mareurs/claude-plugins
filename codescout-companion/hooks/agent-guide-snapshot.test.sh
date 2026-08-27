#!/usr/bin/env bash
# Test: agent-guide-snapshot.mjs (SubagentStart) + agent-guide-restore.mjs
# (SubagentStop) — snapshot/restore the codescout guide-hints ledger around a
# subagent's lifetime, so a subagent's own get_guide-triggering tool calls
# don't silently mark topics delivered for the whole session, starving the
# parent of guidance the server believes it already handed over.
#
# codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md
#
# Ledger path mirrors src/tools/guide_ledger.rs's own resolution exactly:
# <XDG_STATE_HOME>/codescout/guide_hints/<sanitize(session_id)>.json, where
# sanitize maps anything outside [A-Za-z0-9_-] to '_'. Both sides must agree
# on this path or the hooks silently operate on the wrong file.
#
# --- What this suite could NOT catch, and what was added so it can ----------
#
# Until 2026-08-27 these hooks were wired to PreToolUse/PostToolUse:Agent, and
# the pair was a complete no-op: Agent dispatch is asynchronous, so the tool
# call returns at LAUNCH and PostToolUse fired in the same millisecond as
# SubagentStart — 3.4s before the subagent's first tool call, 17.2s before it
# finished. Every mark the subagent made landed after the restore meant to
# undo it.
#
# This suite was green throughout, and it was a good test of the wrong thing.
# It feeds hand-written payloads and calls the hooks in an order IT chooses, so
# it can never observe WHEN Claude Code invokes them. No shell test can — that
# needs a live session.
#
# The gate that closes it is therefore not an ordering assertion but a PAYLOAD
# CONTRACT: the bracket keys on agent_id, which appears on SubagentStart and
# SubagentStop and on NEITHER tool event. Case 6 feeds each hook a genuine
# tool-lifecycle payload and requires a diagnostic + a no-op. Re-wire either
# hook back to a tool event and it fails at runtime, loudly, instead of
# silently doing nothing for a week.
# docs/issues/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SNAPSHOT_HOOK="$HERE/agent-guide-snapshot.mjs"
RESTORE_HOOK="$HERE/agent-guide-restore.mjs"
HOOKS_JSON="$HERE/hooks.json"
MISWIRED_MARKER="cs-guide-bracket-miswired"
PASS=0
FAIL=0

check() {  # <label> <got> <expected>
  if [[ "$2" == "$3" ]]; then
    echo "PASS [$1]"; PASS=$((PASS+1))
  else
    echo "FAIL [$1]: expected=$3 got=$2"; FAIL=$((FAIL+1))
  fi
}

ok() {   echo "PASS [$1]"; PASS=$((PASS+1)); }
bad() {  echo "FAIL [$1]: $2"; FAIL=$((FAIL+1)); }

SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT

# Fixture: a project detect.mjs recognizes as codescout-configured.
PROJECT="$SANDBOX/project"
mkdir -p "$PROJECT"
cat > "$PROJECT/.mcp.json" <<'EOF'
{"mcpServers":{"codescout":{"command":"codescout"}}}
EOF

# XDG_STATE_HOME isolates the ledger to this test's own sandbox.
STATE_HOME="$SANDBOX/state"
mkdir -p "$STATE_HOME"
export XDG_STATE_HOME="$STATE_HOME"

# TMPDIR isolates the SNAPSHOT files, which is a separate directory from the
# ledger and was NOT covered before 2026-08-27: agentGuideSnapshotFile() writes
# to os.tmpdir(), not under XDG_STATE_HOME, so Case 3's deliberately-unconsumed
# second snapshot leaked a real file into the real /tmp on every run. Node reads
# TMPDIR on POSIX and TEMP/TMP on Windows; set all three so the trap's cleanup
# actually reaches them.
export TMPDIR="$SANDBOX/tmp"
export TEMP="$TMPDIR"
export TMP="$TMPDIR"
mkdir -p "$TMPDIR"

SESSION="conv-a"
LEDGER_DIR="$STATE_HOME/codescout/guide_hints"
LEDGER_FILE="$LEDGER_DIR/${SESSION}.json"
STDERR_FILE="$SANDBOX/stderr.txt"
mkdir -p "$LEDGER_DIR"

# Agent-lifecycle payloads: the shape SubagentStart / SubagentStop actually
# deliver, measured 2026-08-27. Note there is no tool_use_id and no tool_name
# on either — that is the whole point of the contract Case 6 pins.
run_start() {  # <session_id> <agent_id>
  jq -n --arg s "$1" --arg a "$2" --arg c "$PROJECT" \
    '{session_id:$s, agent_id:$a, agent_type:"general-purpose", cwd:$c,
      hook_event_name:"SubagentStart"}' | node "$SNAPSHOT_HOOK" 2>"$STDERR_FILE"
}
run_stop() {  # <session_id> <agent_id>
  jq -n --arg s "$1" --arg a "$2" --arg c "$PROJECT" \
    '{session_id:$s, agent_id:$a, agent_type:"general-purpose", cwd:$c,
      hook_event_name:"SubagentStop", stop_hook_active:false}' \
    | node "$RESTORE_HOOK" 2>"$STDERR_FILE"
}

# --- Case 1: ledger pre-exists with a parent-delivered topic; a subagent's
#     own fetch adds a new one; restore must bring back exactly the original,
#     not an empty ledger -- proving this is snapshot/restore, not a wipe. ---
echo '{"librarian":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
run_start "$SESSION" "agent_1" > /dev/null
# The sandbox must actually BE the sandbox. Without this, the leak check at the
# end of the suite is worthless: drop the TMPDIR export and it would scan an
# empty dir, find nothing, and pass green while writing into the real /tmp --
# which is exactly what this suite did until 2026-08-27.
SANDBOXED=$(find "$TMPDIR" -maxdepth 1 -name 'cs-guide-snapshot-*' 2>/dev/null | wc -l)
check "snapshot lands inside the sandbox, not the real tmpdir" "$SANDBOXED" "1"
# Simulate the subagent's own tool call marking a second topic delivered.
echo '{"librarian":"2026-08-01T00:00:00Z","workspace-state":"2026-08-01T00:05:00Z"}' > "$LEDGER_FILE"
run_stop "$SESSION" "agent_1" > /dev/null
GOT=$(cat "$LEDGER_FILE" 2>/dev/null | jq -S .)
WANT=$(echo '{"librarian":"2026-08-01T00:00:00Z"}' | jq -S .)
check "restores pre-dispatch content, not empty" "$GOT" "$WANT"

# --- Case 2: no ledger existed before dispatch; subagent's fetch creates
#     one; restore must delete it, returning to true absence. ---
rm -f "$LEDGER_FILE"
run_start "$SESSION" "agent_2" > /dev/null
echo '{"progressive-disclosure":"2026-08-01T00:10:00Z"}' > "$LEDGER_FILE"
run_stop "$SESSION" "agent_2" > /dev/null
if [[ -f "$LEDGER_FILE" ]]; then
  bad "restores true absence" "ledger file still exists"
else
  ok "restores true absence"
fi

# --- Case 3: concurrent dispatches (two distinct agent_id) must not
#     collide -- each pair operates on its own snapshot. This is why the key
#     is session_id+agent_id and not session_id alone. ---
echo '{"a":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
run_start "$SESSION" "agent_3a" > /dev/null
echo '{"a":"2026-08-01T00:00:00Z","b":"2026-08-01T00:01:00Z"}' > "$LEDGER_FILE"
run_start "$SESSION" "agent_3b" > /dev/null
echo '{"a":"2026-08-01T00:00:00Z","b":"2026-08-01T00:01:00Z","c":"2026-08-01T00:02:00Z"}' > "$LEDGER_FILE"
run_stop "$SESSION" "agent_3a" > /dev/null
GOT=$(cat "$LEDGER_FILE" | jq -S .)
WANT=$(echo '{"a":"2026-08-01T00:00:00Z"}' | jq -S .)
check "first dispatch restores its own pre-dispatch snapshot" "$GOT" "$WANT"

# Drain the sibling: every real dispatch gets a SubagentStop, so leaving
# agent_3b's snapshot behind models nothing and leaks a file.
run_stop "$SESSION" "agent_3b" > /dev/null

# --- Case 4: restore with no prior snapshot (SubagentStart never ran) is a
#     no-op. ---
echo '{"z":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
run_stop "$SESSION" "agent_never_snapshotted" > /dev/null
GOT=$(cat "$LEDGER_FILE" | jq -S .)
WANT=$(echo '{"z":"2026-08-01T00:00:00Z"}' | jq -S .)
check "restore no-ops without a matching snapshot" "$GOT" "$WANT"

# --- Case 5: missing agent_id degrades to a safe no-op on both sides. ---
echo '{"q":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
run_start "$SESSION" "" > /dev/null
echo '{"q":"2026-08-01T00:00:00Z","r":"2026-08-01T00:01:00Z"}' > "$LEDGER_FILE"
run_stop "$SESSION" "" > /dev/null
GOT=$(cat "$LEDGER_FILE" | jq -S .)
WANT=$(echo '{"q":"2026-08-01T00:00:00Z","r":"2026-08-01T00:01:00Z"}' | jq -S .)
check "missing agent_id is a safe no-op, not a crash" "$GOT" "$WANT"

# --- Case 6: THE REGRESSION GATE. Feed each hook a real tool-lifecycle
#     payload -- exactly what PreToolUse/PostToolUse:Agent deliver, carrying
#     tool_use_id and NO agent_id. Both must (a) leave the ledger untouched
#     and (b) say so on stderr. This is what fails if either hook is ever
#     re-wired to a tool event; the pre-2026-08-27 wiring passed every other
#     case in this file while doing nothing at all. ---
tool_payload() {  # <hook_event_name>
  jq -n --arg s "$SESSION" --arg c "$PROJECT" --arg e "$1" \
    '{session_id:$s, tool_use_id:"toolu_01ABC", tool_name:"Agent", cwd:$c,
      hook_event_name:$e, tool_input:{}}'
}

echo '{"parent":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
tool_payload "PreToolUse" | node "$SNAPSHOT_HOOK" > /dev/null 2>"$STDERR_FILE"
if grep -q "$MISWIRED_MARKER" "$STDERR_FILE"; then
  ok "snapshot on a tool-lifecycle payload reports mis-wiring"
else
  bad "snapshot on a tool-lifecycle payload reports mis-wiring" \
      "no '$MISWIRED_MARKER' on stderr -- a tool-event wiring would fail silently again"
fi

# The subagent's marks land here in the real world; a mis-wired restore must
# not undo them on the strength of a snapshot it never legitimately took.
echo '{"parent":"2026-08-01T00:00:00Z","subagent":"2026-08-01T00:05:00Z"}' > "$LEDGER_FILE"
tool_payload "PostToolUse" | node "$RESTORE_HOOK" > /dev/null 2>"$STDERR_FILE"
if grep -q "$MISWIRED_MARKER" "$STDERR_FILE"; then
  ok "restore on a tool-lifecycle payload reports mis-wiring"
else
  bad "restore on a tool-lifecycle payload reports mis-wiring" \
      "no '$MISWIRED_MARKER' on stderr -- a tool-event wiring would fail silently again"
fi

GOT=$(cat "$LEDGER_FILE" | jq -S .)
WANT=$(echo '{"parent":"2026-08-01T00:00:00Z","subagent":"2026-08-01T00:05:00Z"}' | jq -S .)
check "tool-lifecycle payload leaves the ledger untouched" "$GOT" "$WANT"

# --- Wiring: the bracket must sit on the AGENT lifecycle, both ends. ---
hook_events() {  # <script basename> -> newline-separated event names
  jq -r --arg s "$1" '
    .hooks | to_entries[]
    | .key as $ev | .value[]
    | select(any(.hooks[]?; ((.args // []) | join(" ")) | test($s)))
    | $ev' "$HOOKS_JSON" | sort -u
}

check "snapshot hook wired to SubagentStart" \
  "$(hook_events 'agent-guide-snapshot\.mjs')" "SubagentStart"
check "restore hook wired to SubagentStop" \
  "$(hook_events 'agent-guide-restore\.mjs')" "SubagentStop"

# --- Hygiene: no snapshot file may outlive the suite. Before 2026-08-27 this
#     could not even be checked -- the writes went to the real /tmp. ---
LEAKED=$(find "$TMPDIR" -maxdepth 1 -name 'cs-guide-snapshot-*' 2>/dev/null | wc -l)
check "no snapshot files leak out of the suite" "$LEAKED" "0"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
