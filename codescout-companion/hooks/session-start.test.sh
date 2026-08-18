#!/usr/bin/env bash
# Test for session-start.sh — project-bootstrap activate_project nudge and the
# MSG-composition guard (the onboarding block must APPEND, not reset, or it
# clobbers the prepended bootstrap nudge). Machine-specific, like the sibling
# pre-tool-guard.test.sh: relies on codescout being configured for this user.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/session-start.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# HAS_CODESCOUT is config-based (not per-project). If codescout isn't configured
# on this machine the hook exits early and emits nothing — skip rather than fail.
eval "$(CWD="$TMP" HOME="$HOME" CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR-}" \
        python3 "$SCRIPT_DIR/../scripts/detect.py")"
if [ "${HAS_CODESCOUT:-false}" != "true" ]; then
  echo "SKIP: codescout not configured on this machine — session-start emits nothing."
  exit 0
fi

# Run the hook for a given source against the (non-git, non-onboarded) temp cwd
# and print the injected additionalContext.
ctx() {
  printf '{"cwd":"%s","source":"%s","session_id":"sst-%s"}' "$TMP" "$1" "$1" \
    | XDG_STATE_HOME="${XDG_STATE_HOME:-$TMP/state}" node "$HOOK" 2>/dev/null \
    | jq -r '.hookSpecificOutput.additionalContext // ""'
}

# --- rendezvous: the hook stamps slots whose ppid is on our ancestry ---
RV="$TMP/state/codescout/servers"; mkdir -p "$RV"
MYPPID=$(ps -o ppid= -p $$ | tr -d ' ')
printf '{"pid":999001,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$MYPPID" > "$RV/999001.json"
printf '{"pid":999002,"ppid":1,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' > "$RV/999002.json"

XDG_STATE_HOME="$TMP/state" ctx startup >/dev/null

jq -e '.session == "sst-startup" and .hook_at != null' "$RV/999001.json" >/dev/null \
  && pass "rendezvous: entry on our ancestry is stamped" \
  || fail "rendezvous: entry on our ancestry was NOT stamped"

jq -e '.session == null and .hook_at == null' "$RV/999002.json" >/dev/null \
  && pass "rendezvous: unrelated entry is left alone" \
  || fail "rendezvous: unrelated entry was stamped — selection is too broad"

# The Rust Entry struct has no #[serde(default)] on ANY field — a partial
# write-back (e.g. just {session, hook_at}) parses fine here but fails silently
# on the server's next poll(). Assert every original field survived the stamp.
jq -e --arg ppid "$MYPPID" \
  '.pid == 999001 and (.ppid|tostring) == $ppid and .started_at == "2026-01-01T00:00:00Z" and .cwd == "/"' \
  "$RV/999001.json" >/dev/null \
  && pass "rendezvous: stamp round-trips every original field (pid/ppid/started_at/cwd)" \
  || fail "rendezvous: stamp dropped a field — server's poll() would silently fail to parse"

# The Rust side declares hook_at: Option<chrono::DateTime<Utc>> — an RFC3339
# string, not a JSON number. `Date.now()` in place of `.toISOString()` would
# stay valid JSON and pass every other assertion here while the server's
# poll() silently fails to parse it forever. Pin the wire shape.
jq -e '.hook_at | test("^[0-9]{4}-.*(Z|[+-][0-9]{2}:[0-9]{2})$")' "$RV/999001.json" >/dev/null \
  && pass "rendezvous: hook_at is an RFC3339 string, not a numeric timestamp" \
  || fail "rendezvous: hook_at is not RFC3339 — server's poll() would fail to parse Option<DateTime<Utc>>"

# --- rendezvous: a missing/empty session_id must not stamp (rekey("") hazard) ---
# The server's rekey("") would repoint the ledger to "<dir>/.json" (empty
# basename). The outer `if (sessionId)` guard exists to prevent that; assert a
# matching slot is left completely untouched when session_id is absent.
NOSID_ENTRY="$RV/999004.json"
printf '{"pid":999004,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$MYPPID" > "$NOSID_ENTRY"
printf '{"cwd":"%s","source":"startup"}' "$TMP" \
  | XDG_STATE_HOME="$TMP/state" node "$HOOK" >/dev/null 2>&1
jq -e '.session == null and .hook_at == null' "$NOSID_ENTRY" >/dev/null \
  && pass "rendezvous: missing session_id leaves a matching slot untouched" \
  || fail "rendezvous: missing session_id stamped a slot — rekey(\"\") hazard"

# --- rendezvous: a comm field containing spaces/parens must not shift ppid parsing ---
# Regression for the /proc/<pid>/stat hazard: field 2 (comm) can itself contain
# spaces and parens (the `claude` and `node` wrappers routinely produce this),
# which shifts every later whitespace-split field and silently yields the wrong
# ppid. The other rendezvous assertions above never exercise this: nothing in
# this test's own process tree (bash/node) has a weird comm. Fabricate one: a
# python3 process renames itself via prctl(PR_SET_NAME) to a name containing
# both a space and unbalanced-looking parens, then spawns node (running the
# hook) as its child — so the hook's grandparent-hop must correctly climb PAST
# a weird-comm process to reach us ($$, this test script).
if [ "$(uname)" = "Linux" ] && command -v python3 >/dev/null 2>&1; then
  WEIRD_ENTRY="$RV/999003.json"
  printf '{"pid":999003,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$$" > "$WEIRD_ENTRY"

  XDG_STATE_HOME="$TMP/state" python3 - "$HOOK" "$TMP" <<'PYEOF' >/dev/null 2>&1
import ctypes, subprocess, sys
libc = ctypes.CDLL('libc.so.6')
libc.prctl(15, b'weird (na) x\0', 0, 0, 0)  # PR_SET_NAME
hook, tmp = sys.argv[1], sys.argv[2]
payload = ('{"cwd":"%s","source":"startup","session_id":"sst-weirdcomm"}' % tmp).encode()
subprocess.run(['node', hook], input=payload,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
PYEOF

  jq -e '.session == "sst-weirdcomm" and .hook_at != null' "$WEIRD_ENTRY" >/dev/null \
    && pass "rendezvous: ppid parsing survives a comm field with spaces/parens" \
    || fail "rendezvous: comm-with-spaces broke ppid parsing (whitespace-split regression)"
else
  pass "rendezvous: comm-with-spaces test N/A (not Linux or no python3)"
fi

STARTUP=$(ctx startup)
COMPACT=$(ctx compact)

echo "$STARTUP" | grep -q "PROJECT BOOTSTRAP" \
  && pass "startup → activate_project bootstrap nudge present" \
  || fail "bootstrap nudge missing on startup"

echo "$STARTUP" | grep -q 'workspace(action="activate"' \
  && pass "nudge names the workspace activate call" \
  || fail "nudge missing the workspace(action=\"activate\") call"

if echo "$COMPACT" | grep -q "PROJECT BOOTSTRAP"; then
  fail "bootstrap nudge should be suppressed on compact (post-compact owns the workspace call)"
else
  pass "compact → bootstrap suppressed"
fi

# Resume must NOT re-inject the nudge (startup-only): a same-process re-attach
# reuses the already-active project; a real resume re-runs activate at most lazily.
RESUME=$(ctx resume)
if echo "$RESUME" | grep -q "PROJECT BOOTSTRAP"; then
  fail "bootstrap nudge should be suppressed on resume (startup-only)"
else
  pass "resume → bootstrap suppressed"
fi

# Append-not-reset guard: a non-onboarded temp project emits the onboarding
# nudge too. Both must coexist — if the onboarding block reset MSG (the old
# bug), the prepended bootstrap line would vanish.
if echo "$STARTUP" | grep -q "not yet onboarded"; then
  echo "$STARTUP" | grep -q "PROJECT BOOTSTRAP" \
    && pass "bootstrap survives the onboarding MSG block (append, not reset)" \
    || fail "onboarding block clobbered the bootstrap nudge (MSG reset regression)"
else
  pass "temp project already onboarded — append-guard N/A"
fi

# --- Tracker-hygiene overdue nudge ---
# Ledger absent (all earlier ctx calls ran without it): no nudge.
if echo "$STARTUP" | grep -q "TRACKER HYGIENE"; then
  fail "hygiene nudge must be silent when no ledger exists"
else
  pass "no ledger → no hygiene nudge"
fi

mkdir -p "$TMP/docs/trackers"
LEDGER="$TMP/docs/trackers/tracker-hygiene-log.md"

# Overdue date → nudge present, names the due date and the skill.
printf -- '---\nkind: tracker\nstatus: active\ntitle: Tracker hygiene log\nnext-sweep-due: 2020-01-01\nsweep-interval-days: 30\n---\n# Tracker hygiene log\n' > "$LEDGER"
OVERDUE=$(ctx startup)
echo "$OVERDUE" | grep -q "TRACKER HYGIENE: sweep overdue (due 2020-01-01)" \
  && pass "overdue ledger → hygiene nudge with due date" \
  || fail "overdue ledger did not produce the hygiene nudge"
echo "$OVERDUE" | grep -q "codescout-companion:tracker-hygiene" \
  && pass "nudge names the skill invocation" \
  || fail "nudge missing the skill name"

# Future date → silent.
printf -- '---\nkind: tracker\nstatus: active\ntitle: Tracker hygiene log\nnext-sweep-due: 2099-01-01\nsweep-interval-days: 30\n---\n# Tracker hygiene log\n' > "$LEDGER"
FUTURE=$(ctx startup)
if echo "$FUTURE" | grep -q "TRACKER HYGIENE"; then
  fail "future due date must not nudge"
else
  pass "future due date → silent"
fi

# Malformed date → silent (never nudge on garbage).
printf -- '---\nnext-sweep-due: soonish\n---\n' > "$LEDGER"
BAD=$(ctx startup)
if echo "$BAD" | grep -q "TRACKER HYGIENE"; then
  fail "malformed date must not nudge"
else
  pass "malformed date → silent"
fi
rm -f "$LEDGER"

# --- Tracker-hygiene nudge: guard-hardening (numeric-malformed) ---
# A numeric-but-invalid value sorts BEFORE today and would wrongly nudge if the
# ISO regex guard regressed; asserting silence here actually exercises the guard
# (a letter-led value stays silent with or without the guard — vacuous).
mkdir -p "$TMP/docs/trackers"
LEDGER="$TMP/docs/trackers/tracker-hygiene-log.md"
printf -- '---\nnext-sweep-due: 202\n---\n' > "$LEDGER"
NUMBAD=$(ctx startup)
if echo "$NUMBAD" | grep -q "TRACKER HYGIENE"; then
  fail "numeric-malformed date (202) must not nudge — ISO guard regressed"
else
  pass "numeric-malformed date → silent (ISO guard exercised)"
fi

# --- Tracker-hygiene nudge: due==today boundary ---
printf -- '---\nnext-sweep-due: %s\n---\n' "$(date +%F)" > "$LEDGER"
DUETODAY=$(ctx startup)
if echo "$DUETODAY" | grep -q "TRACKER HYGIENE: sweep overdue (due $(date +%F))"; then
  pass "due today → nudge fires (boundary: today counts as due)"
else
  fail "due today must nudge (today counts as due)"
fi
rm -f "$LEDGER"

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
