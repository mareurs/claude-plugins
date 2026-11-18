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
PI_EXTENSION_TESTS_DIR="$SCRIPT_DIR/../codescout-companion/.pi/extensions"
SKILL_TESTS_DIR="$SCRIPT_DIR/../codescout-companion/skills"
# effort-steering/**/*.test.mjs at ANY depth — a new top-level plugin directory is
# otherwise never scanned, and a one-level glob misses the adapter's tests two levels
# down (effort-steering/adapter/claude-code/); the runner would still print
# "All suites passed". `find` rather than globstar so node_modules can be pruned.
EFFORT_TESTS_DIR="$SCRIPT_DIR/../effort-steering"
EFFORT_SUITES=()
if [ -d "$EFFORT_TESTS_DIR" ]; then
  while IFS= read -r -d '' f; do EFFORT_SUITES+=("$f"); done < <(
    find "$EFFORT_TESTS_DIR" -name node_modules -prune -o -type f -name '*.test.mjs' -print0 | sort -z
  )
fi

SDD_HOOK_TESTS_DIR="$SCRIPT_DIR/../sdd/hooks"
WAKE_TESTS_DIR="$SCRIPT_DIR/../codescout-companion/background-wake"
WAKE_SUITES=()
if [ -d "$WAKE_TESTS_DIR" ]; then
  WAKE_TESTS_DIR="$(cd "$WAKE_TESTS_DIR" && pwd)"
  while IFS= read -r -d '' f; do WAKE_SUITES+=("$f"); done < <(
    find "$WAKE_TESTS_DIR" -name node_modules -prune -o -type f -name '*.test.mjs' -print0 | sort -z
  )
fi

# Harness test runners: harnesses/<harness>/tests/test-*.sh. The OpenCode runner runs that
# harness's test-*.mjs itself (and a sandboxed install), so only the .sh is listed here.
shopt -s nullglob
SUITES=("$SCRIPT_DIR"/test-*.sh "$SCRIPT_DIR"/../harnesses/*/tests/test-*.sh "$HOOK_TESTS_DIR"/*.test.sh "$SKILL_TESTS_DIR"/*/*.test.sh "$HOOK_TESTS_DIR"/*.test.mjs "$SDD_HOOK_TESTS_DIR"/*.test.mjs "$PI_EXTENSION_TESTS_DIR"/*.test.mjs ${EFFORT_SUITES[@]+"${EFFORT_SUITES[@]}"} ${WAKE_SUITES[@]+"${WAKE_SUITES[@]}"})
shopt -u nullglob

if [ "${1:-}" = "--list" ]; then
  printf '%s\n' "${SUITES[@]}"
  exit 0
fi
if [ "$#" -ne 0 ]; then
  echo 'usage: tests/run-all.sh [--list]' >&2
  exit 2
fi

# LOAD-BEARING. Without nullglob a non-matching glob survives as a literal path and
# `bash <literal>` fails loudly; with it, the list silently empties and the summary
# below prints "All suites passed" over zero suites — the one outcome this runner
# cannot otherwise report. Assert the population, never the globs.
if [ "${#SUITES[@]}" -eq 0 ]; then
  echo "✗ no test suites discovered — the globs in $0 match nothing" >&2
  exit 1
fi

# Missing-dependency NOTICE, never a gate. node_modules/ is gitignored and
# codescout-companion/package.json has no scripts, so a fresh clone or `git worktree
# add` has no `ws`, and the seven suites that import it (the codex-* suites and
# test-background-wake-package.sh) fail with `Cannot find package 'ws'` — a message that
# names the symptom but not the fix. Measured 2026-11-10: `npm ci` turned all seven
# green. The exit code is left alone and the other suites still run, so a missing
# dependency never hides unrelated failures. Printed again beside the failed-suite list
# below, because this line scrolls away in a long run.
# Tests: tests/test-run-all-deps-notice.sh.
WS_NOTICE=""
if [ "${#WAKE_SUITES[@]}" -ne 0 ] && [ ! -d "$SCRIPT_DIR/../codescout-companion/node_modules/ws" ]; then
  WS_NOTICE="⚠ codescout-companion/node_modules/ws is missing: the background-wake and codex suites import it and will fail with \"Cannot find package 'ws'\".
  Fix: (cd codescout-companion && npm ci)"
  echo "$WS_NOTICE"
  echo ""
fi

# Runtime-prerequisite SKIP, never a failure (issue #18, item 1). The wake engine refuses to run
# below its floor, Node 22 (platform-node.mjs) or Python 3.12 (receipt_txn.py), and
# docs/background-wake.md says so. Running its suites anyway on an older host printed about 80
# `not ok` lines and 27 failed suites, which reads as a broken release and not as a missing
# prerequisite. So the wake suites are skipped, once, with a notice that names each UNMET
# requirement and what the host has. A skip is counted as SKIPPED, not passed, in the summary
# below, and nothing else changes: other suites run, and a failing one still fails the run.
# `--list` exits above this block, so discovery does not depend on the runtime.
# The two numbers below are the engine's floor. tests/test-wake-runtime-floor.sh fails when they
# differ from the engine's gates, the docs or CI: change all of them together.
# Tests: tests/test-run-all-runtime-notice.sh (pins versions with tests/lib/runtime-shims.sh).
WAKE_MIN_NODE=22
WAKE_MIN_PY_MINOR=12
RUNTIME_UNMET=()
WAKE_RUNTIME_SKIPPED=0
if [ "${#WAKE_SUITES[@]}" -ne 0 ]; then
  node_v="$(node --version 2>/dev/null || true)"
  py_v="$(python3 --version 2>&1 || true)"
  if [[ "$node_v" =~ ^v([0-9]+) ]]; then
    node_major="${BASH_REMATCH[1]}"
    [ "$node_major" -ge "$WAKE_MIN_NODE" ] || RUNTIME_UNMET+=("Node $WAKE_MIN_NODE or newer (found ${node_v#v})")
  else
    RUNTIME_UNMET+=("Node $WAKE_MIN_NODE or newer (\`node --version\` gave no readable version)")
  fi
  if [[ "$py_v" =~ ^Python\ ([0-9]+)\.([0-9]+) ]]; then
    py_major="${BASH_REMATCH[1]}"; py_minor="${BASH_REMATCH[2]}"
    if [ "$py_major" -lt 3 ] || { [ "$py_major" -eq 3 ] && [ "$py_minor" -lt "$WAKE_MIN_PY_MINOR" ]; }; then
      RUNTIME_UNMET+=("Python 3.$WAKE_MIN_PY_MINOR or newer (found ${py_v#Python })")
    fi
  else
    RUNTIME_UNMET+=("Python 3.$WAKE_MIN_PY_MINOR or newer (\`python3 --version\` gave no readable version)")
  fi
  if [ "${#RUNTIME_UNMET[@]}" -ne 0 ]; then
    echo "⚠ background-wake suites need a newer runtime on this host and are SKIPPED, not run:"
    for unmet in "${RUNTIME_UNMET[@]}"; do echo "  - $unmet"; done
    echo "  Fix: put a newer node and python3 first on PATH. docs/background-wake.md lists the requirements."
    echo ""
  fi
fi

# CS_TEST_SKIP — space-separated suite basenames to skip. A DENY-list on purpose:
# discovery stays glob-driven, so a suite added tomorrow runs by default and only
# the names written here are excluded. An allow-list would silently un-cover every
# new suite, which is the failure the nullglob guard above exists to prevent one
# layer down.
SKIPPED=()
UNMATCHED=()
for name in ${CS_TEST_SKIP:-}; do
  found=""
  for f in "${SUITES[@]}"; do
    [ "$(basename "$f")" = "$name" ] && { found=1; break; }
  done
  [ -n "$found" ] || UNMATCHED+=("$name")
done
# A skip naming no discovered suite is an ERROR, not a no-op. Renaming a suite
# would otherwise leave a stale entry here that silently stops excluding anything
# — or worse, reads as coverage that a name in the list is being handled.
if [ "${#UNMATCHED[@]}" -ne 0 ]; then
  echo "✗ CS_TEST_SKIP names suites that do not exist: ${UNMATCHED[*]}" >&2
  echo "  Discovery is by glob; a renamed or deleted suite must be removed here too." >&2
  exit 1
fi

for f in "${SUITES[@]}"; do
  base="$(basename "$f")"
  if [[ " ${CS_TEST_SKIP:-} " == *" $base "* ]]; then
    echo "▷ $base — SKIPPED via CS_TEST_SKIP"
    SKIPPED+=("$base")
    echo ""
    continue
  fi
  if [ "${#RUNTIME_UNMET[@]}" -ne 0 ]; then
    is_wake=""
    for w in "${WAKE_SUITES[@]}"; do [ "$w" = "$f" ] && { is_wake=1; break; }; done
    if [ -n "$is_wake" ]; then
      # Silent on purpose: the notice at the top and the SKIPPED line below say it once.
      WAKE_RUNTIME_SKIPPED=$((WAKE_RUNTIME_SKIPPED + 1))
      continue
    fi
  fi
  echo "▶ $base"
  if case "$f" in
    *.mjs) node --experimental-strip-types "$f" ;;
    *) bash "$f" ;;
  esac
  then
    :
  else
    FAILED+=("$base")
  fi
  echo ""
done

# Printed unconditionally when non-empty: an exclusion nobody sees is
# indistinguishable from coverage.
if [ "${#SKIPPED[@]}" -ne 0 ]; then
  echo "▷ ${#SKIPPED[@]} suite(s) SKIPPED, not passed: ${SKIPPED[*]}"
  echo ""
fi
if [ "$WAKE_RUNTIME_SKIPPED" -ne 0 ]; then
  echo "▷ $WAKE_RUNTIME_SKIPPED background-wake suite(s) SKIPPED, not passed: runtime too old (see the notice at the top)"
  echo ""
fi

# Local git hooks are opt-in per clone (never synced by git), so the pre-push
# guards can be silently absent — and absence reads exactly like "nothing to
# report". Notice only; never affects the exit code.
bash "$SCRIPT_DIR/../scripts/check-hooks-installed.sh" || true

if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "✓ All suites passed."
  exit 0
else
  echo "✗ Failed suites: ${FAILED[*]}"
  [ -n "$WS_NOTICE" ] && { echo ""; echo "$WS_NOTICE"; }
  exit 1
fi
