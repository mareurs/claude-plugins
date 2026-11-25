#!/usr/bin/env bash
# tests/test-frictions-box.sh — the frictions box of this repository: its four verb scripts and their
# tests are present and tracked, the readme speaks the inbox model the scripts need, `check` is clean
# and the tests of the verbs pass. The scripts and tests are byte copies of the codescout
# repository's. A drifted copy is a WARNING, not a failure: the source is another repository whose
# working tree moves on its own.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/.codescout/box/scripts/frictions/frictions"
README="$ROOT/docs/boxes/frictions/frictions/readme.md"
SRC="${CODESCOUT_REPO:-$ROOT/../codescout}/.codescout/box/scripts/frictions/frictions"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── frictions box ──"

for f in note admit recent check; do
  if [ -f "$DIR/$f.py" ]; then ok "$f.py is present"; else bad "$f.py" "missing; run scripts/sync-frictions-box.sh"; fi
  if [ -f "$DIR/tests/test_$f.py" ]; then ok "tests/test_$f.py is present"
  else bad "tests/test_$f.py" "missing; run scripts/sync-frictions-box.sh"; fi
done

# .gitignore ignores /.codescout/*; without the exception the box folder never reaches another machine.
if git -C "$ROOT" check-ignore -q "$DIR/note.py"; then
  bad ".codescout/box is ignored" "keep '!/.codescout/box/' in .gitignore"
else ok ".codescout/box is not ignored"; fi
if [ -n "$(git -C "$ROOT" ls-files -- .codescout/box/scripts/frictions/frictions)" ]; then ok "the scripts are tracked"
else bad "the scripts are not tracked" "git add .codescout/box/scripts"; fi
# The state of the verbs is regenerable and stays out of the repository.
if git -C "$ROOT" check-ignore -q "$ROOT/.codescout/box/state/frictions/frictions/x"; then ok ".codescout/box/state is ignored"
else bad ".codescout/box/state is not ignored" "keep '/.codescout/box/state/' in .gitignore"; fi

# The scripts file an inbox entry and admit it with an FR-N: the readme must declare both.
if grep -q '^initial_status: inbox$' "$README" && grep -q '^  inbox: open$' "$README" && grep -q '^  fr:$' "$README"; then
  ok "the readme declares inbox, initial_status and the fr field"
else bad "the readme" "needs initial_status: inbox, an inbox status and an fr field"; fi

if command -v codescout >/dev/null 2>&1; then
  out="$(cd "$ROOT" && codescout box frictions check 2>&1)"
  if printf '%s' "$out" | grep -q 'no findings'; then ok "codescout box frictions check: no findings"
  else bad "codescout box frictions check" "$(printf '%s' "$out" | tail -2 | tr '\n' ' ')"; fi
else
  echo "  SKIP: codescout not found — box frictions check was NOT run"
fi

# The tests load each verb by path with a fake `codescout` module: they start no binary.
if python3 -c 'import pytest' >/dev/null 2>&1; then
  if out="$(cd "$ROOT" && python3 -m pytest -q -p no:cacheprovider "$DIR/tests" 2>&1)"; then
    ok "the verb tests pass ($(printf '%s' "$out" | tail -1))"
  else bad "the verb tests" "$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi
else
  echo "  SKIP: pytest not found — the verb tests were NOT run"
fi

if [ -d "$SRC" ]; then
  for f in note admit recent check; do
    cmp -s "$SRC/$f.py" "$DIR/$f.py" || echo "  WARN: $f.py differs from the codescout copy; run scripts/sync-frictions-box.sh if the change is wanted"
    cmp -s "$SRC/tests/test_$f.py" "$DIR/tests/test_$f.py" || echo "  WARN: tests/test_$f.py differs from the codescout copy; run scripts/sync-frictions-box.sh if the change is wanted"
  done
else
  echo "  NOTE: no codescout checkout at $SRC — the copies were not compared"
fi

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" = 0 ]
