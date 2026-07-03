#!/usr/bin/env bash
# Test for session-start.sh — project-bootstrap activate_project nudge and the
# MSG-composition guard (the onboarding block must APPEND, not reset, or it
# clobbers the prepended bootstrap nudge). Machine-specific, like the sibling
# pre-tool-guard.test.sh: relies on codescout being configured for this user.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/session-start.sh"
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
    | bash "$HOOK" 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext // ""'
}

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
