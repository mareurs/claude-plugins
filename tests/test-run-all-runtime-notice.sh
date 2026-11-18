#!/usr/bin/env bash
# tests/test-run-all-runtime-notice.sh — run-all.sh skips the background-wake suites, with ONE
# notice, when the host runtimes are too old for them.
#
# WHY THIS EXISTS (issue #18, item 1). The wake engine refuses runtimes below its floor, Node 22
# and Python 3.12 (platform-node.mjs, receipt_txn.py, docs/background-wake.md). Until 2026-11-17
# the floor was Node 24 and Python 3.13. run-all.sh ran every wake suite on a host below the floor
# anyway, so such a machine printed about 80 `not ok` lines and 27 failed suites, which reads as
# a broken release and not as a missing prerequisite. Versions below are chosen against the
# current floor; tests/test-wake-runtime-floor.sh pins that the floor is one number everywhere.
#
# CONTRACT.
#  - Node < 22 or Python < 3.12, and wake suites exist: print one notice that names each unmet
#    requirement, and do not run the wake suites.
#  - A skipped suite is never a pass: it is counted in a "SKIPPED, not passed" line.
#  - The skip is not a gate on anything else: other suites still run, and a failing one still
#    fails the run.
#  - No wake suites, or runtimes new enough: no notice, nothing skipped.
#
# HOW IT TESTS. Same shape as test-run-all-deps-notice.sh: a copy of the REAL run-all.sh in a
# throwaway tree, so the real suites never run. tests/lib/runtime-shims.sh pins the versions
# run-all.sh sees, so the result does not depend on the host's own Node and Python.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/runtime-shims.sh
. "$REPO/tests/lib/runtime-shims.sh"
PASS=0
FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/run-all-runtime-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# make_tree <dir>: a runner copy, one wake suite (prints RAN_WAKE) and one ordinary suite
# (prints RAN_DUMMY). ws is present, so the unrelated missing-dependency notice stays silent.
make_tree() {
  local root="$1"
  mkdir -p "$root/tests" "$root/scripts" "$root/codescout-companion/background-wake/adapters" \
           "$root/codescout-companion/node_modules/ws"
  cp "$REPO/tests/run-all.sh" "$root/tests/run-all.sh"
  printf '#!/bin/bash\nexit 0\n' > "$root/scripts/check-hooks-installed.sh"
  echo "console.log('RAN_WAKE');" > "$root/codescout-companion/background-wake/adapters/x.test.mjs"
  printf '#!/bin/bash\necho RAN_DUMMY\n' > "$root/tests/test-dummy.sh"
}

# run_with <tree> <node-version> <python-version>: run the tree's runner under pinned runtimes.
# The output goes to $OUT and the exit code to $RC (a subshell would lose them).
run_with() {
  local shims="$TMP/shims-$2-$3"
  make_runtime_shims "$shims" "$2" "$3"
  OUT="$(env -u CLAUDE_CONFIG_DIR PATH="$shims:$PATH" bash "$1/tests/run-all.sh" 2>&1)"; RC=$?
}

echo "── run-all.sh runtime prerequisite notice ──"

# 1. Node below the floor: notice names Node 22, the wake suite is skipped, the rest runs, exit 0.
T1="$TMP/old-node"; make_tree "$T1"; run_with "$T1" 20.19.0 3.12.0
echo "$OUT" | grep -q "Node 22" \
  && ok "old Node: the notice names the Node 22 requirement" \
  || fail "old Node: the notice names the Node 22 requirement"
echo "$OUT" | grep -q "RAN_WAKE" \
  && fail "old Node: the wake suite must not run" \
  || ok "old Node: the wake suite does not run"
echo "$OUT" | grep -q "RAN_DUMMY" \
  && ok "old Node: an ordinary suite still runs" \
  || fail "old Node: an ordinary suite still runs"
[ "$RC" -eq 0 ] \
  && ok "old Node: skipped wake suites do not fail the run" \
  || fail "old Node: skipped wake suites do not fail the run (rc=$RC)"
echo "$OUT" | grep -q "1 background-wake suite(s) SKIPPED, not passed" \
  && ok "old Node: the skip is counted as SKIPPED, not passed" \
  || fail "old Node: the skip is counted as SKIPPED, not passed"
echo "$OUT" | grep -q "Python 3.12" \
  && fail "old Node: Python 3.12 is met and must not be named" \
  || ok "old Node: only the unmet requirement is named"

# 2. Python below the floor, Node at the floor: notice names Python 3.12 and not Node.
T2="$TMP/old-python"; make_tree "$T2"; run_with "$T2" 22.0.0 3.11.9
echo "$OUT" | grep -q "Python 3.12" \
  && ok "old Python: the notice names the Python 3.12 requirement" \
  || fail "old Python: the notice names the Python 3.12 requirement"
echo "$OUT" | grep -q "RAN_WAKE" \
  && fail "old Python: the wake suite must not run" \
  || ok "old Python: the wake suite does not run"
echo "$OUT" | grep -q "Node 22" \
  && fail "old Python: Node 22 is met and must not be named" \
  || ok "old Python: only the unmet requirement is named"

# 3. Both below the floor: one notice, both requirements.
T3="$TMP/both-old"; make_tree "$T3"; run_with "$T3" 20.19.0 3.11.9
{ echo "$OUT" | grep -q "Node 22" && echo "$OUT" | grep -q "Python 3.12"; } \
  && ok "both old: the notice names both requirements" \
  || fail "both old: the notice names both requirements"
N3="$(echo "$OUT" | grep -c "background-wake suites need")"
[ "$N3" -eq 1 ] \
  && ok "both old: the notice is printed once" \
  || fail "both old: the notice is printed once (count=$N3)"

# 4. The floor itself (22.0.0 / 3.12.0), the latest 22.x / 3.12.x, the runtime the engine was first
# built on (24.0.0 / 3.13.0), and newer ones: no notice, the wake suite runs. The 24.0.0 pair is
# the one that must keep working after the floor was lowered from it.
for pair in 22.0.0:3.12.0 22.23.5:3.12.12 24.0.0:3.13.0 26.13.1:3.14.10; do
  nv="${pair%%:*}"; pv="${pair#*:}"
  T4="$TMP/new-$nv"; make_tree "$T4"; run_with "$T4" "$nv" "$pv"
  { echo "$OUT" | grep -q "RAN_WAKE" && ! echo "$OUT" | grep -q "SKIPPED"; } \
    && ok "Node $nv + Python $pv: the wake suite runs, nothing is skipped" \
    || fail "Node $nv + Python $pv: the wake suite runs, nothing is skipped"
done

# 5. Just under the Node floor is still too old (the major version decides, not a string compare).
T5="$TMP/node-21"; make_tree "$T5"; run_with "$T5" 21.7.3 3.12.0
echo "$OUT" | grep -q "RAN_WAKE" \
  && fail "Node 21.7.3: still below 22, the wake suite must not run" \
  || ok "Node 21.7.3: still below 22, the wake suite does not run"

# 6. A multi-digit Python minor is compared as a number: 3.9 and 3.11 are older than 3.12, 3.14 is newer.
T6="$TMP/py-39"; make_tree "$T6"; run_with "$T6" 22.0.0 3.9.18
echo "$OUT" | grep -q "RAN_WAKE" \
  && fail "Python 3.9.18: below 3.12, the wake suite must not run" \
  || ok "Python 3.9.18: below 3.12, the wake suite does not run"
T6B="$TMP/py-311"; make_tree "$T6B"; run_with "$T6B" 22.0.0 3.11.9
echo "$OUT" | grep -q "RAN_WAKE" \
  && fail "Python 3.11.9: just below 3.12, the wake suite must not run" \
  || ok "Python 3.11.9: just below 3.12, the wake suite does not run"
T7="$TMP/py-314"; make_tree "$T7"; run_with "$T7" 22.0.0 3.14.10
echo "$OUT" | grep -q "RAN_WAKE" \
  && ok "Python 3.14.10: above 3.12, the wake suite runs" \
  || fail "Python 3.14.10: above 3.12, the wake suite runs"

# 7. No wake suites at all: nothing needs the runtimes, so no notice.
T8="$TMP/no-wake"; make_tree "$T8"; rm -rf "$T8/codescout-companion/background-wake"
run_with "$T8" 20.19.0 3.11.9
echo "$OUT" | grep -q "background-wake suites need" \
  && fail "no wake suites: no notice" \
  || ok "no wake suites: no notice"

# 8. The skip hides nothing else: a failing ordinary suite still fails the run.
T9="$TMP/fail-other"; make_tree "$T9"; printf '#!/bin/bash\nexit 1\n' > "$T9/tests/test-dummy.sh"
run_with "$T9" 20.19.0 3.12.0
[ "$RC" -ne 0 ] \
  && ok "old Node + a failing ordinary suite: the run still fails" \
  || fail "old Node + a failing ordinary suite: the run still fails (rc=$RC)"
echo "$OUT" | grep -q "Failed suites: test-dummy.sh" \
  && ok "old Node + a failing ordinary suite: the failure is named" \
  || fail "old Node + a failing ordinary suite: the failure is named"

# 9. --list is discovery, not a run: it lists the wake suite whatever the runtime.
T10="$TMP/list"; make_tree "$T10"
make_runtime_shims "$TMP/shims-list" 20.19.0 3.11.9
LIST="$(PATH="$TMP/shims-list:$PATH" bash "$T10/tests/run-all.sh" --list 2>&1)"
echo "$LIST" | grep -q "x.test.mjs" \
  && ok "--list: the wake suite is still discovered on old runtimes" \
  || fail "--list: the wake suite is still discovered on old runtimes"
echo "$LIST" | grep -q "background-wake suites need" \
  && fail "--list: prints no notice" \
  || ok "--list: prints no notice"

echo "  ── run-all runtime notice: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
