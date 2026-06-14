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

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
