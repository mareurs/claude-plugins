#!/usr/bin/env bash
# tests/test-opencode-adapter.sh — the OpenCode bridges stay wired to the Claude-side hooks
#
# WHY THIS EXISTS
#
# harnesses/opencode/*.js are bridges, not forks: they translate OpenCode events into the
# stdin/stdout JSON dialect the Claude-side hooks already speak. That coupling is invisible
# to both sides. Rename a field in a hook's lib.mjs, change the shape of a deny payload, or
# move a hook, and a bridge stops enforcing while still exiting cleanly — the silent-no-op
# failure class this repo keeps being bitten by. Nothing else in the suite touches
# harnesses/opencode/.
#
# Also installs into a throwaway config dir and checks every link resolves: an installer
# whose paths drifted installs nothing and reports success.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harnesses/opencode"
INSTALLER="$H/install.sh"
PASS=0; FAIL=0; SKIP=0
pass() { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

echo "── opencode-adapter ──"

if ! command -v node >/dev/null 2>&1; then
  echo "  SKIP: node not found — OpenCode bridges NOT checked"; exit 0
fi

# Every hook a bridge shells out to. If one moves, that bridge stops enforcing and nothing
# fails — so this is an assertion, not a comment.
for h in codescout-companion/hooks/pre-tool-guard.mjs codescout-companion/hooks/cs-liveness.mjs \
         codescout-companion/hooks/lib.mjs codescout-companion/hooks/detect.mjs; do
  if [ -f "$ROOT/$h" ]; then pass "hook a bridge depends on exists: $h"
  else fail "a bridge calls $h but it is absent"; fi
done

# Syntax, before behaviour: a broken plugin throws inside opencode's loader, and the host's
# own failure mode there is not visible to us.
for f in "$H"/*.js "$H"/lib/*.mjs; do
  [ -f "$f" ] || continue
  if node --check "$f" 2>/dev/null; then pass "parses: ${f#"$ROOT"/}"
  else fail "does not parse: ${f#"$ROOT"/}"; fi
done
if bash -n "$INSTALLER" 2>/dev/null; then pass "install.sh parses"
else fail "install.sh does not parse"; fi

# The installer, for real, into a sandbox: every plugin, skill and command it creates must
# resolve, and --check must agree. A drifted source path fails here, not on a user's machine.
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/oc-install-XXXXXX")"
if OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" >"$SANDBOX.log" 2>&1; then
  pass "install.sh installs into a fresh config dir"
  broken=$(find "$SANDBOX" -xtype l 2>/dev/null)
  if [ -z "$broken" ]; then pass "every installed link resolves"
  else fail "dangling links after install:"; printf '      %s\n' $broken; fi
  n=$(find "$SANDBOX/plugins" -name '*.js' | wc -l)
  [ "$n" -ge 1 ] && pass "plugins installed: $n" || fail "no plugin installed"
  if grep -rq 'CLAUDE_PLUGIN_ROOT' "$SANDBOX/commands" 2>/dev/null; then
    fail "a rendered command still holds an unexpanded \${CLAUDE_PLUGIN_ROOT}"
  else pass "no unexpanded \${CLAUDE_PLUGIN_ROOT} in installed commands"; fi
  if OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" --check >/dev/null 2>&1; then pass "install.sh --check agrees after install"
  else fail "install.sh --check reports problems right after install"; fi
  # A moved repo leaves dangling links; --check must say so (it used to report "present").
  first="$(find "$SANDBOX/plugins" -name '*.js' | head -1)"
  ln -sfn "$SANDBOX/gone.js" "$first"
  if OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" --check 2>/dev/null | grep -q DANGLING; then pass "install.sh --check flags a dangling plugin link"
  else fail "install.sh --check missed a dangling plugin link"; fi
else
  fail "install.sh failed in a sandbox:"; sed 's/^/      /' "$SANDBOX.log"
fi
if bash "$INSTALLER" --definitely-not-a-flag >/dev/null 2>&1; then fail "install.sh accepted an unknown flag (it would install)"
else pass "install.sh rejects unknown flags"; fi
rm -rf "$SANDBOX" "$SANDBOX.log"

# The behaviour suites, one per bridge. On failure, print the failing cases in full: a
# count alone sends the developer back to re-run node by hand.
for t in "$H"/*.test.mjs; do
  [ -f "$t" ] || continue
  out="$(node "$t" 2>&1)"; rc=$?
  p=$(printf '%s\n' "$out" | grep -c '^  PASS:'); f=$(printf '%s\n' "$out" | grep -c '^  FAIL:')
  PASS=$((PASS+p)); FAIL=$((FAIL+f))
  echo "  ${t#"$ROOT"/}: $p passed, $f failed"
  if [ "$f" -gt 0 ]; then
    printf '%s\n' "$out" | awk '/^  FAIL:/{show=1} /^  PASS:/{show=0} show' | sed 's/^/    /'
  elif [ "$rc" -ne 0 ]; then
    echo "  FAIL: ${t#"$ROOT"/} exited $rc with no FAIL line — it crashed"; FAIL=$((FAIL+1))
    printf '%s\n' "$out" | tail -20 | sed 's/^/      /'
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
