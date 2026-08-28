#!/bin/bash
# tests/run-all.sh — run all hook test scripts and report results

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FAILED=()

# Test isolation: one codescout state sandbox for the whole suite, removed on
# exit. Without it, any test piping a synthetic session_id into
# session-start.mjs stamps the LIVE codescout server's rendezvous slot — see
# tests/lib/fixtures.sh for the mechanism, and
# docs/issues/archive/2026-08-27-test-suite-rekeys-live-codescout-server.md. Exported
# here as well as in fixtures.sh because not every suite sources fixtures.sh.
CS_TEST_STATE_SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/cs-test-state-XXXXXX")"
export CS_TEST_STATE_SANDBOX
export XDG_STATE_HOME="$CS_TEST_STATE_SANDBOX"
trap 'rm -rf "$CS_TEST_STATE_SANDBOX"' EXIT

# tests/test-*.sh plus colocated hook tests (codescout-companion/hooks/*.test.sh)
HOOK_TESTS_DIR="$SCRIPT_DIR/../codescout-companion/hooks"

for f in "$SCRIPT_DIR"/test-*.sh "$HOOK_TESTS_DIR"/*.test.sh; do
  echo "▶ $(basename "$f")"
  if bash "$f"; then
    :
  else
    FAILED+=("$(basename "$f")")
  fi
  echo ""
done

# Local git hooks are opt-in per clone (never synced by git), so the pre-push
# guards can be silently absent — and absence reads exactly like "nothing to
# report". Notice only; never affects the exit code.
bash "$SCRIPT_DIR/../scripts/check-hooks-installed.sh" || true

if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "✓ All suites passed."
  exit 0
else
  echo "✗ Failed suites: ${FAILED[*]}"
  exit 1
fi
