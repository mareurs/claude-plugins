#!/bin/bash
# tests/test-release-buddy-pytest.sh — scripts/lib-buddy-pytest.sh
#
# release.sh step 0 claims "buddy pytest green", but ran pytest only when
# buddy/.venv/bin/pytest existed, and otherwise skipped without printing a
# line. Found 2026-09-28 on a machine with no venv: the buddy 0.11.8 release
# log carried no pytest line at all, and the suite was run by hand afterwards.
# The gate now falls back to the system python's pytest, and says so loudly
# when neither exists.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── release-buddy-pytest ──"
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib-buddy-pytest.sh"

# Fresh sandbox per test: a buddy dir, and a bin dir that is the ENTIRE PATH
# for the call — so the real python3 on this machine can never be reached.
SANDBOX=""
new_sandbox() {
  [ -n "$SANDBOX" ] && rm -rf "$SANDBOX"
  SANDBOX="$(mktemp -d)"
  BUDDY="$SANDBOX/buddy"; BIN="$SANDBOX/bin"
  mkdir -p "$BUDDY/tests" "$BIN"
}
trap '[ -n "$SANDBOX" ] && rm -rf "$SANDBOX"' EXIT

# add_venv_pytest [rc] — buddy/.venv/bin/pytest that reports where it ran
add_venv_pytest() {
  mkdir -p "$BUDDY/.venv/bin"
  printf '#!/bin/bash\necho "VENV-PYTEST cwd=$PWD args=$*"\nexit %s\n' "${1:-0}" > "$BUDDY/.venv/bin/pytest"
  chmod +x "$BUDDY/.venv/bin/pytest"
}
# add_python <name> <has-pytest:yes|no> [rc] — a python on PATH
add_python() {
  if [ "$2" = yes ]; then
    printf '#!/bin/bash\n[ "$1 $2" = "-m pytest" ] || exit 2\n[ "$3" = "--version" ] && { echo "pytest 0.0"; exit 0; }\necho "SYS-PYTEST(%s) cwd=$PWD args=$*"\nexit %s\n' "$1" "${3:-0}" > "$BIN/$1"
  else
    printf '#!/bin/bash\necho "No module named pytest" >&2\nexit 1\n' > "$BIN/$1"
  fi
  chmod +x "$BIN/$1"
}

run() { OUT=$(PATH="$BIN" run_buddy_pytest "$BUDDY" 2>&1); RC=$?; }

# ── Test 1: venv pytest is used when present ──
new_sandbox; add_venv_pytest; add_python python3 yes
run
if echo "$OUT" | grep -q "VENV-PYTEST cwd=$BUDDY args=tests -q" && ! echo "$OUT" | grep -q SYS-PYTEST && [ $RC -eq 0 ]; then
  pass "venv: .venv pytest runs from the buddy dir"
else
  fail "venv: .venv pytest runs from the buddy dir" "rc=$RC out=$OUT"
fi

# ── Test 2: no venv → system python3 -m pytest runs (the 0.11.8 gap) ──
new_sandbox; add_python python3 yes
run
if echo "$OUT" | grep -q "SYS-PYTEST(python3) cwd=$BUDDY args=-m pytest tests -q" && [ $RC -eq 0 ]; then
  pass "fallback: no venv → python3 -m pytest runs from the buddy dir"
else
  fail "fallback: no venv → python3 -m pytest runs from the buddy dir" "rc=$RC out=$OUT"
fi

# ── Test 3: no python3 → python -m pytest (Windows names it python) ──
new_sandbox; add_python python yes
run
if echo "$OUT" | grep -q "SYS-PYTEST(python) cwd=$BUDDY" && [ $RC -eq 0 ]; then
  pass "fallback: python used when python3 is absent"
else
  fail "fallback: python used when python3 is absent" "rc=$RC out=$OUT"
fi

# ── Test 4: no pytest anywhere → a visible SKIPPED line, release continues ──
new_sandbox; add_python python3 no
run
if echo "$OUT" | grep -q "buddy pytest SKIPPED" && [ $RC -eq 0 ]; then
  pass "skip: no pytest anywhere → SKIPPED line, rc 0"
else
  fail "skip: no pytest anywhere → SKIPPED line, rc 0" "rc=$RC out=$OUT"
fi

# ── Test 5: a red suite fails the gate, on both runners ──
new_sandbox; add_venv_pytest 1
run
if [ $RC -ne 0 ]; then
  pass "red: failing venv pytest → nonzero"
else
  fail "red: failing venv pytest → nonzero" "rc=$RC out=$OUT"
fi
new_sandbox; add_python python3 yes 1
run
if [ $RC -ne 0 ]; then
  pass "red: failing system pytest → nonzero"
else
  fail "red: failing system pytest → nonzero" "rc=$RC out=$OUT"
fi

print_summary "release-buddy-pytest"
