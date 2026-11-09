#!/usr/bin/env bash
# tests/test-opencode-adapter.sh — the OpenCode host bridge stays wired to the Claude-side hooks
#
# WHY THIS EXISTS
#
# harnesses/opencode/codescout-companion.js is a bridge, not a fork: it translates an
# OpenCode tool call into the stdin/stdout JSON dialect pre-tool-guard.mjs already speaks.
# That coupling is invisible to both files. Rename a field in lib.mjs, change the shape of
# a deny payload, or move a hook, and the bridge stops enforcing while still exiting
# cleanly — the silent-no-op failure class this repo keeps being bitten by. Nothing else in
# the suite touches harnesses/opencode/.
#
# Also checks install.sh parses and still points at a real plugin file: an installer whose
# path drifted installs nothing and reports success.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADAPTER="$ROOT/harnesses/opencode/codescout-companion.js"
TESTS="$ROOT/harnesses/opencode/codescout-companion.test.mjs"
INSTALLER="$ROOT/harnesses/opencode/install.sh"
PASS=0; FAIL=0; SKIP=0

echo "── opencode-adapter ──"

if ! command -v node >/dev/null 2>&1; then
  echo "  SKIP: node not found — OpenCode bridge NOT checked"; exit 0
fi
[ -f "$ADAPTER" ] || { echo "  FAIL: adapter missing at $ADAPTER"; exit 1; }

# The bridge shells out to exactly these two hooks. If either moves, the bridge stops
# enforcing and nothing fails — so this is an assertion, not a comment.
for h in pre-tool-guard.mjs cs-liveness.mjs lib.mjs detect.mjs; do
  if [ -f "$ROOT/codescout-companion/hooks/$h" ]; then
    echo "  PASS: hook the bridge depends on exists: $h"; PASS=$((PASS+1))
  else
    echo "  FAIL: bridge calls $h but it is absent from codescout-companion/hooks/"; FAIL=$((FAIL+1))
  fi
done

# Syntax, before behaviour: a broken adapter throws inside opencode's plugin loader, and
# the host's own failure mode there is not visible to us.
if node --check "$ADAPTER" 2>/dev/null; then
  echo "  PASS: adapter parses"; PASS=$((PASS+1))
else
  echo "  FAIL: adapter does not parse"; FAIL=$((FAIL+1))
fi
if bash -n "$INSTALLER" 2>/dev/null; then
  echo "  PASS: install.sh parses"; PASS=$((PASS+1))
else
  echo "  FAIL: install.sh does not parse"; FAIL=$((FAIL+1))
fi

if grep -q 'codescout-companion.js' "$INSTALLER" && [ -f "$ADAPTER" ]; then
  echo "  PASS: install.sh targets a file that exists"; PASS=$((PASS+1))
else
  echo "  FAIL: install.sh references an adapter that is not there"; FAIL=$((FAIL+1))
fi

# The real behaviour suite (deny/allow/fail-open), run bare and summarised here.
if [ -f "$TESTS" ]; then
  out="$(node "$TESTS" 2>&1)"; rc=$?
  p=$(printf '%s\n' "$out" | grep -c '^  PASS:'); f=$(printf '%s\n' "$out" | grep -c '^  FAIL:')
  PASS=$((PASS+p)); FAIL=$((FAIL+f))
  if [ "$rc" -ne 0 ] && [ "$f" -eq 0 ]; then
    echo "  FAIL: adapter suite exited $rc with no FAIL line — it crashed"; FAIL=$((FAIL+1))
    printf '%s\n' "$out" | sed 's/^/      /'
  fi
else
  echo "  FAIL: adapter suite missing at $TESTS"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
