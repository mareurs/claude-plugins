#!/usr/bin/env bash
# Regression test for Step 1's session-name read (fixed at bb14719).
#
# WHY THIS EXISTS. The defect was self-concealing in a way that guarantees no
# reader reports it: a greedy `sed 's/.*"name":"\(...\)".*/\1/'` binds to the
# LAST `"name":` on the line, and `formerNames` is a list of OBJECTS each
# carrying one -- so a renamed session prints a name it no longer has. Address
# a peer by that name and `SendMessage` answers `No agent named 'X' is
# reachable`, which is byte-identical to a cross-profile refusal, and Step 3
# tells you to answer that by switching to the `uds:` form -- which works. The
# skill's own correct advice for a DIFFERENT cause consumes the evidence.
# Measured 2026-09-02: 21 live registry files, 1 with a non-empty `formerNames`,
# and exactly that one mismatched. The population grows monotonically, because
# a rename appends rather than rotates.
#
# WHAT IS NOT COVERED, so nobody credits this file with it. The other half of
# bb14719 -- the self-identification walk terminating on socket-presence rather
# than on `comm == claude` -- is NOT tested here. That walk reads `/proc` and
# `/run/user/<uid>/cc-socks` by hardcoded absolute path, so it cannot be pointed
# at a fixture without editing the skill, and a source-text assertion ("the
# block contains no comm test") is a proxy for the behaviour rather than the
# behaviour. It was verified by hand on 2026-09-03 against live pid 985365
# (`comm=2.1.258`, exe `~/.local/share/claude/versions/2.1.258`): the old walk
# passes over it to PID 1 and prints no `<-- you`; the new one terminates there.
# That verification is not repeatable and this file does not pretend otherwise.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$SCRIPT_DIR/SKILL.md"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# The program under test is EXTRACTED FROM SKILL.md, never re-typed here. A copy
# would pass forever against a skill edited back to the greedy form -- the exact
# shape CLAUDE.md calls "a second level asserting about its own re-implementation".
# LOAD-BEARING: the split is on the single-quote that opens `python3 -c '...'`, so
# the extracted program must contain no single quote of its own. It uses double
# quotes throughout. If that ever changes, this extraction silently returns a
# fragment and every case below fails loudly rather than passing vacuously.
PROG=$(grep -m1 'nm=\$(python3 -c' "$SKILL" | awk -F"'" '{print $2}')
if [ -z "$PROG" ]; then
  fail "extract" "no 'nm=\$(python3 -c ...' line found in $SKILL"
  echo "$FAIL failed"; exit 1
fi

# A registry row whose CURRENT name differs from a former one. `formerNames`
# holds objects, not strings -- that is what makes the decoy a `"name":` key.
cat > "$TMP/renamed.json" <<'JSON'
{"pid":4124418,"name":"split-issue-clusters-file","status":"idle",
 "formerNames":[{"name":"stop-storing-derived-counts","until":1788370948458}]}
JSON

# 1. The shipped program returns the CURRENT name.
got=$(python3 -c "$PROG" "$TMP/renamed.json" 2>/dev/null)
if [ "$got" = "idle|split-issue-clusters-file" ]; then
  pass "renamed session reads its current name"
else
  fail "renamed session reads its current name" "got '$got'"
fi

# 2. THE FIXTURE IS DISCRIMINATING -- an observed RED, not an assertion's existence.
#    Case 1 alone would pass against a fixture with no `formerNames` at all, which
#    is monotone under the defect. This runs the ORIGINAL greedy expression on the
#    same bytes and REQUIRES it to be wrong. If this ever passes, the fixture has
#    stopped exercising the bug and case 1 is worthless.
old=$(sed -n 's/.*"name":"\([^"]*\)".*/\1/p' "$TMP/renamed.json" | tail -1)
if [ "$old" = "stop-storing-derived-counts" ]; then
  pass "fixture still reproduces the greedy-read defect"
else
  fail "fixture still reproduces the greedy-read defect" "old form gave '$old', expected the former name"
fi

# 3. A row with NO formerNames is unaffected -- the fix must not be conditional
#    on the decoy being present.
cat > "$TMP/plain.json" <<'JSON'
{"pid":3411389,"name":"codescout-de","status":"busy"}
JSON
got=$(python3 -c "$PROG" "$TMP/plain.json" 2>/dev/null)
if [ "$got" = "busy|codescout-de" ]; then
  pass "un-renamed session is unaffected"
else
  fail "un-renamed session is unaffected" "got '$got'"
fi

# 4. `status` has the identical greedy shape and is safe today only because no
#    nested object carries that key. This pins that as a PROPERTY rather than
#    luck: a nested `status` must not displace the top-level one.
cat > "$TMP/nested_status.json" <<'JSON'
{"pid":1,"name":"outer","status":"idle",
 "formerNames":[{"name":"inner","status":"busy","until":1}]}
JSON
got=$(python3 -c "$PROG" "$TMP/nested_status.json" 2>/dev/null)
if [ "$got" = "idle|outer" ]; then
  pass "nested status does not displace the top-level one"
else
  fail "nested status does not displace the top-level one" "got '$got'"
fi

echo "-- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
