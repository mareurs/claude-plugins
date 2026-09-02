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

# tests/test-*.sh plus colocated tests: hooks (codescout-companion/hooks/*.test.sh)
# and skills (codescout-companion/skills/<skill>/*.test.sh). The skill glob is one
# level deeper because a skill is a DIRECTORY, not a file — and until 2026-09-03 it
# was absent, so a test colocated with a skill was never run and its suite reported
# "All suites passed" exactly as if it had.
HOOK_TESTS_DIR="$SCRIPT_DIR/../codescout-companion/hooks"
SKILL_TESTS_DIR="$SCRIPT_DIR/../codescout-companion/skills"

shopt -s nullglob
SUITES=("$SCRIPT_DIR"/test-*.sh "$HOOK_TESTS_DIR"/*.test.sh "$SKILL_TESTS_DIR"/*/*.test.sh)
shopt -u nullglob

# LOAD-BEARING. Without nullglob a non-matching glob survives as a literal path and
# `bash <literal>` fails loudly; with it, the list silently empties and the summary
# below prints "All suites passed" over zero suites — the one outcome this runner
# cannot otherwise report. Assert the population, never the globs.
if [ "${#SUITES[@]}" -eq 0 ]; then
  echo "✗ no test suites discovered — the globs in $0 match nothing" >&2
  exit 1
fi

for f in "${SUITES[@]}"; do
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
