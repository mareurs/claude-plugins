#!/usr/bin/env bash
# tests/test-wake-runtime-floor.sh — the background-wake runtime floor is ONE number, stated
# the same way in every place that states it.
#
# WHY THIS EXISTS (issue #18, item 1). The floor (Node 22, Python 3.12) is written down in five
# places that no compiler links: the Node gate, the Python gate, the thresholds in
# tests/run-all.sh, docs/background-wake.md and the CI workflow. When the floor was Node 24 and
# Python 3.13 they drifted from each other's tests, and a host that met one and not another got
# ~80 `not ok` lines instead of a clear notice. This test makes a raised or lowered floor that
# misses a place fail here, by name.
#
# It checks, for Node and for Python:
#   engine gate == run-all.sh threshold == every "Node N+" / "Python 3.N+" in the docs
# and that CI runs the floor itself AND the newer runtime the engine was first built on.
#
# Every extraction is asserted non-empty first: a pattern that stops matching must fail, not
# compare two empty strings as equal.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

NODE_SRC="$REPO/codescout-companion/background-wake/platform-node.mjs"
PY_SRC="$REPO/codescout-companion/background-wake/receipt_txn.py"
RUN_ALL="$REPO/tests/run-all.sh"
DOC="$REPO/docs/background-wake.md"
CI="$REPO/.github/workflows/cross-platform-hooks.yml"

# first_number <file> <extended-regex>: the last run of digits in the first match, or empty.
first_number() { grep -oE "$2" "$1" | head -1 | grep -oE '[0-9]+$'; }

# The Python gate is the tuple `MIN_PYTHON = (3, N)`: N is the number after the comma.
NODE_ENGINE="$(first_number "$NODE_SRC" 'MIN_NODE_MAJOR *= *[0-9]+')"
PY_ENGINE="$(first_number "$PY_SRC" 'MIN_PYTHON *= *\(3, *[0-9]+')"
NODE_RUNALL="$(first_number "$RUN_ALL" '^WAKE_MIN_NODE=[0-9]+')"
PY_RUNALL="$(first_number "$RUN_ALL" '^WAKE_MIN_PY_MINOR=[0-9]+')"

echo "── wake runtime floor: one number in every place ──"

for pair in "Node gate:$NODE_ENGINE" "Python gate:$PY_ENGINE" "run-all.sh Node threshold:$NODE_RUNALL" "run-all.sh Python threshold:$PY_RUNALL"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" =~ ^[0-9]+$ ]] \
    && ok "$name: a number was extracted ($value)" \
    || fail "$name: no number could be extracted (got '$value')"
done

[ -n "$NODE_ENGINE" ] && [ "$NODE_ENGINE" = "$NODE_RUNALL" ] \
  && ok "Node: the engine gate and run-all.sh agree ($NODE_ENGINE)" \
  || fail "Node: the engine gate ($NODE_ENGINE) and run-all.sh ($NODE_RUNALL) disagree"
[ -n "$PY_ENGINE" ] && [ "$PY_ENGINE" = "$PY_RUNALL" ] \
  && ok "Python: the engine gate and run-all.sh agree (3.$PY_ENGINE)" \
  || fail "Python: the engine gate (3.$PY_ENGINE) and run-all.sh (3.$PY_RUNALL) disagree"

# Docs: every "Node N+" and "Python 3.N+" must be the floor. At least one of each must exist.
DOC_NODE="$(grep -oE 'Node [0-9]+\+' "$DOC" | grep -oE '[0-9]+' | sort -u | tr '\n' ' ')"
DOC_PY="$(grep -oE 'Python 3\.[0-9]+\+' "$DOC" | grep -oE '\.[0-9]+' | tr -d . | sort -u | tr '\n' ' ')"
[ "$DOC_NODE" = "$NODE_ENGINE " ] \
  && ok "docs/background-wake.md: every \"Node N+\" is $NODE_ENGINE" \
  || fail "docs/background-wake.md: \"Node N+\" values are '${DOC_NODE% }', the gate says $NODE_ENGINE"
[ "$DOC_PY" = "$PY_ENGINE " ] \
  && ok "docs/background-wake.md: every \"Python 3.N+\" is 3.$PY_ENGINE" \
  || fail "docs/background-wake.md: \"Python 3.N+\" values are '${DOC_PY% }', the gate says 3.$PY_ENGINE"

# CI runs the floor (so the documented floor is tested) and the newer runtime (so 24 keeps working).
for v in "$NODE_ENGINE" 24; do
  grep -q "node-version: '$v'" "$CI" \
    && ok "CI runs Node $v" \
    || fail "CI never runs Node $v"
done
for v in "3.$PY_ENGINE" 3.13; do
  grep -q "python-version: '$v'" "$CI" \
    && ok "CI runs Python $v" \
    || fail "CI never runs Python $v"
done

echo "  ── wake runtime floor: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
