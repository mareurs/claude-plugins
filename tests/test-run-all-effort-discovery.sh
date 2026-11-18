#!/usr/bin/env bash
# tests/test-run-all-effort-discovery.sh — run-all.sh finds effort-steering suites at ANY depth.
#
# WHY THIS EXISTS. The effort-steering glob was `effort-steering/*/*.test.mjs`: it
# reaches exactly one directory level. The Claude Code adapter (ES-3) will live in
# `effort-steering/adapter/claude-code/`, two levels down. A test there would never
# be discovered, and the runner would still print "All suites passed" -- the same
# silent-uncovering failure the nullglob guard in run-all.sh exists to prevent.
#
# HOW IT TESTS. It copies the REAL run-all.sh into a throwaway tree (so SCRIPT_DIR
# resolves there and the real suites never run) and plants tiny suites at several
# depths. It checks the output, and that a FAILING deep suite fails the run: a suite
# that is listed but not executed would pass the first check and fail the second.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/run-all-discovery-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# make_tree <dir>: a minimal repo layout around a copy of the real runner.
make_tree() {
  local root="$1"
  mkdir -p "$root/tests" "$root/scripts"
  cp "$REPO/tests/run-all.sh" "$root/tests/run-all.sh"
  printf '#!/bin/bash\nexit 0\n' > "$root/scripts/check-hooks-installed.sh"
  # node, not bash: the runner dispatches *.mjs through node.
  mkdir -p "$root/effort-steering/core" \
           "$root/effort-steering/adapter/claude-code" \
           "$root/effort-steering/adapter/claude-code/lib"
  echo "console.log('RAN_DEPTH_1');" > "$root/effort-steering/core/one.test.mjs"
  echo "console.log('RAN_DEPTH_2');" > "$root/effort-steering/adapter/claude-code/two.test.mjs"
  echo "console.log('RAN_DEPTH_3');" > "$root/effort-steering/adapter/claude-code/lib/three.test.mjs"
}

echo "── run-all.sh effort-steering discovery depth ──"

# 1. Suites at depth 1, 2 and 3 are all executed.
T1="$TMP/pass"; make_tree "$T1"
OUT="$(bash "$T1/tests/run-all.sh" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "all-passing tree exits 0" || fail "all-passing tree exits 0 (rc=$RC)"
for d in 1 2 3; do
  echo "$OUT" | grep -q "RAN_DEPTH_$d" \
    && ok "suite at depth $d was executed" \
    || fail "suite at depth $d was NOT executed"
done

# 2. A failing deep suite fails the run (it is executed, not merely listed).
T2="$TMP/fail"; make_tree "$T2"
echo "process.exit(1);" > "$T2/effort-steering/adapter/claude-code/lib/three.test.mjs"
OUT2="$(bash "$T2/tests/run-all.sh" 2>&1)"; RC2=$?
[ "$RC2" -ne 0 ] && ok "failing depth-3 suite fails the run" || fail "failing depth-3 suite fails the run (rc=$RC2)"
echo "$OUT2" | grep -q "Failed suites: three.test.mjs" \
  && ok "failure names three.test.mjs" || fail "failure names three.test.mjs"

# 3. node_modules is not scanned: a vendored package's tests are not ours.
T3="$TMP/vendor"; make_tree "$T3"
mkdir -p "$T3/effort-steering/node_modules/pkg"
echo "console.log('RAN_VENDORED');" > "$T3/effort-steering/node_modules/pkg/vendored.test.mjs"
OUT3="$(bash "$T3/tests/run-all.sh" 2>&1)"
echo "$OUT3" | grep -q "RAN_VENDORED" \
  && fail "node_modules suite must not run" || ok "node_modules suite does not run"

# 4. An effort-steering dir with no suites still trips the empty-population guard.
T4="$TMP/empty"; mkdir -p "$T4/tests" "$T4/scripts" "$T4/effort-steering/core"
cp "$REPO/tests/run-all.sh" "$T4/tests/run-all.sh"
printf '#!/bin/bash\nexit 0\n' > "$T4/scripts/check-hooks-installed.sh"
OUT4="$(bash "$T4/tests/run-all.sh" 2>&1)"; RC4=$?
[ "$RC4" -ne 0 ] && echo "$OUT4" | grep -q "no test suites discovered" \
  && ok "zero discovered suites is an error, not a pass" \
  || fail "zero discovered suites is an error, not a pass (rc=$RC4)"

echo "  ── run-all effort discovery: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
