#!/usr/bin/env bash
# tests/test-run-all-deps-notice.sh — run-all.sh names the missing `ws` dependency.
#
# WHY THIS EXISTS. node_modules/ is gitignored and codescout-companion/package.json has
# no scripts, so a fresh clone or `git worktree add` has no `ws`. The seven suites that
# import it (six codex-*.test.mjs plus test-background-wake-package.sh) then fail with
# `Cannot find package 'ws'`. Measured 2026-11-10 on main: the run printed seven failed
# suites and nothing that pointed at the cause. `npm ci` made all seven pass.
#
# CONTRACT. The notice is a NOTICE, never a gate: it must not change the exit code, and
# the other suites must still run. It appears twice: at the start, and again beside the
# failed-suite list, because the start scrolls away in a long run.
#
# HOW IT TESTS. Same shape as test-run-all-effort-discovery.sh: copy the REAL run-all.sh
# into a throwaway tree so SCRIPT_DIR resolves there and the real suites never run.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/run-all-deps-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# make_tree <dir>: a minimal repo layout around a copy of the real runner, with one
# passing background-wake suite so the wake population is non-empty.
make_tree() {
  local root="$1"
  mkdir -p "$root/tests" "$root/scripts" "$root/codescout-companion/background-wake/adapters"
  cp "$REPO/tests/run-all.sh" "$root/tests/run-all.sh"
  printf '#!/bin/bash\nexit 0\n' > "$root/scripts/check-hooks-installed.sh"
  echo "console.log('RAN_WAKE');" > "$root/codescout-companion/background-wake/adapters/x.test.mjs"
}

# Clean env: the runner must not read the caller's CLAUDE_CONFIG_DIR or similar state.
run_runner() { env -u CLAUDE_CONFIG_DIR bash "$1/tests/run-all.sh" 2>&1; }

echo "── run-all.sh missing-dependency notice ──"

# 1. ws absent: notice names the cause and the fix, and the run still passes.
T1="$TMP/absent"; make_tree "$T1"
OUT1="$(run_runner "$T1")"; RC1=$?
echo "$OUT1" | grep -q "npm ci" \
  && ok "missing ws: notice tells the user to run npm ci" \
  || fail "missing ws: notice tells the user to run npm ci"
echo "$OUT1" | grep -q "codescout-companion" \
  && ok "missing ws: notice names the codescout-companion directory" \
  || fail "missing ws: notice names the codescout-companion directory"
[ "$RC1" -eq 0 ] \
  && ok "missing ws: notice does not change the exit code" \
  || fail "missing ws: notice does not change the exit code (rc=$RC1)"
echo "$OUT1" | grep -q "RAN_WAKE" \
  && ok "missing ws: suites still run" \
  || fail "missing ws: suites still run"
N1="$(echo "$OUT1" | grep -c "npm ci")"
[ "$N1" -eq 1 ] \
  && ok "all suites pass: notice appears once, at the start" \
  || fail "all suites pass: notice appears once, at the start (count=$N1)"

# 2. ws absent and a suite fails: notice repeats next to the failed-suite list.
T2="$TMP/absent-fail"; make_tree "$T2"
echo "process.exit(1);" > "$T2/codescout-companion/background-wake/adapters/x.test.mjs"
OUT2="$(run_runner "$T2")"; RC2=$?
[ "$RC2" -ne 0 ] \
  && ok "missing ws + failing suite: run still fails" \
  || fail "missing ws + failing suite: run still fails (rc=$RC2)"
N2="$(echo "$OUT2" | grep -c "npm ci")"
[ "$N2" -eq 2 ] \
  && ok "missing ws + failing suite: notice repeats beside the failure list" \
  || fail "missing ws + failing suite: notice repeats beside the failure list (count=$N2)"

# 3. ws present: no notice.
T3="$TMP/present"; make_tree "$T3"
mkdir -p "$T3/codescout-companion/node_modules/ws"
OUT3="$(run_runner "$T3")"; RC3=$?
echo "$OUT3" | grep -q "npm ci" \
  && fail "ws present: no notice" || ok "ws present: no notice"
[ "$RC3" -eq 0 ] && ok "ws present: run passes" || fail "ws present: run passes (rc=$RC3)"

# 4. No background-wake suites at all: nothing needs ws, so no notice.
T4="$TMP/no-wake"; make_tree "$T4"
rm -rf "$T4/codescout-companion/background-wake"
printf '#!/bin/bash\nexit 0\n' > "$T4/tests/test-dummy.sh"
OUT4="$(run_runner "$T4")"
echo "$OUT4" | grep -q "npm ci" \
  && fail "no wake suites: no notice" || ok "no wake suites: no notice"

echo "  ── run-all deps notice: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
