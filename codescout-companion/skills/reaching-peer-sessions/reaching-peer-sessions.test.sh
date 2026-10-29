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
# SELF-IDENTIFICATION. The other half of bb14719 -- the self-identification walk
# terminating on socket-presence rather than on `comm == claude` -- is covered by
# cases 8-11 below. It used to be disclaimed here: the walk read `/proc` and
# `/run/user/<uid>/cc-socks` by hardcoded absolute path, so it could not be pointed
# at a fixture, and a source-text assertion ("the block contains no comm test") is
# a proxy for the behaviour rather than the behaviour. SKILL.md now reads both
# roots from CS_PEERS_PROC / CS_PEERS_SOCKS (defaults unchanged), and the cases run
# the EXTRACTED block against a fixture tree. The 2026-09-03 hand verification
# against live pid 985365 (`comm=2.1.258`) is no longer the only evidence.
#
# WHAT IS STILL NOT COVERED. The fixture is a model of /proc, not /proc: it has no
# real process tree, so it proves the walk's TERMINATION RULE and nothing about how
# a particular kernel or Claude Code build lays out `status`. Case 11 is what keeps
# the fixture honest about the one property that matters -- that the old rule fails it.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$SCRIPT_DIR/references/claude-code.md"  # the Claude mechanics live here; SKILL.md only points at it
CORE="$SCRIPT_DIR/SKILL.md"
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

# 5. NO `$`-PLUS-DIGIT ANYWHERE IN THE BODY. A skill body is argument-substituted
#    before delivery, so a `$2` sitting in a fenced code block is rewritten with a
#    word of the CALLER's args -- the block that runs is not the block on disk.
#    Shipped until 2026-09-15 as `awk '/^PPid:/{print $2}'` and reproduced on CLI
#    2.1.272: two sessions minutes apart were delivered `{print garaj-96}` and
#    `{print terrace}`, each the third word of its own args. This is the same
#    self-concealing class as the other two -- a rewritten walk finds no socket,
#    prints no `<-- you`, and renders a table that looks right. Worse, an
#    out-of-range index passes through untouched, so short args look clean and no
#    runtime signal exists at all. This check is the only guard.
#    Deliberately the WHOLE file, not just the code block: prose is substituted
#    too, where a literal cost like `$4.20` would silently become `.20`.
hits=$(grep -n '\$[0-9]' "$SKILL" "$CORE" || true)
if [ -z "$hits" ]; then
  pass "no \$-plus-digit token survives in the skill body"
else
  fail "no \$-plus-digit token survives in the skill body" "arg-substituted on delivery: $hits"
fi

# 6. THE CHECK IS DISCRIMINATING -- an observed RED, not an assertion's existence.
#    Case 5 alone would pass forever against a grep that matches nothing at all
#    (a typo'd pattern, a moved $SKILL). Run it against the exact line that
#    shipped and REQUIRE a hit.
printf '%s\n' "  me=\$(awk '/^PPid:/{print \$2}' \"/proc/\$me/status\")" > "$TMP/probe.md"
if grep -q '\$[0-9]' "$TMP/probe.md"; then
  pass "guard still catches the form that shipped"
else
  fail "guard still catches the form that shipped" "grep missed the known-bad line"
fi

# 7. The replacement reads the SAME field the old awk did. Extracted from
#    SKILL.md, never re-typed, for the reason given at PROG above.
SEDPROG=$(grep -m1 "me=\$(sed -n" "$SKILL" | sed -n "s/.*sed -n '\([^']*\)'.*/\1/p")
printf 'Name:\tbash\nPPid:\t4124418\nPPid2:\t9\n' > "$TMP/status"
got=$(sed -n "$SEDPROG" "$TMP/status" 2>/dev/null)
if [ "$got" = "4124418" ]; then
  pass "sed field read returns the PPid value"
else
  fail "sed field read returns the PPid value" "got '$got', expected 4124418"
fi

# 8-11. THE SELF-IDENTIFICATION WALK, run for real against a fixture tree.
#    The block is EXTRACTED from SKILL.md (the first ```bash fence under Step 1),
#    never re-typed, for the reason given at PROG above. The fixture is the shape
#    the bug was measured on 2026-09-02: the shell's ancestor that owns the socket
#    is a VERSION-PINNED install, so its `comm` is `2.1.258`, not `claude`.
#      $$ (bash) -> 910001 (node, no socket) -> 910002 (comm 2.1.258, HAS socket) -> 1
#    plus an unrelated peer 910003 (comm claude, has a socket, not an ancestor).
BLOCK=$(awk '/^## Enumerate/{s=1} s && /^```bash/{b=1; next} b && /^```/{exit} b{print}' "$SKILL")
if [ -z "$BLOCK" ] || ! grep -q 'me=\$\$' <<<"$BLOCK"; then
  fail "extract walk block" "no bash fence containing 'me=\$\$' under '## Enumerate' in $SKILL"
  echo "-- $PASS passed, $FAIL failed"; exit 1
fi

mk_proc() { # mk_proc <fx> <pid> <comm> <ppid>
  mkdir -p "$1/proc/$2"
  printf 'Name:\t%s\nPPid:\t%s\n' "$3" "$4" > "$1/proc/$2/status"
  printf '%s\n' "$3" > "$1/proc/$2/comm"
}
mk_peer() { # mk_peer <fx> <pid> <comm> <ppid> <name> -- a socket-bound session
  mk_proc "$1" "$2" "$3" "$4"
  python3 -c 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$1/socks/$2.sock" 2>/dev/null
  printf 'CLAUDE_CONFIG_DIR=%s\0' "$1/profile" > "$1/proc/$2/environ"
  ln -s "/work/$5" "$1/proc/$2/cwd"
  printf '{"pid":%s,"name":"%s","status":"idle"}' "$2" "$5" > "$1/profile/sessions/$2.json"
}
mk_fixture() { # mk_fixture <fx>
  mkdir -p "$1/proc" "$1/socks" "$1/profile/sessions" "$1/home"
}
# run_walk <fx> <parent-of-the-running-shell> <block> -- the running shell's own
# status row is written under ITS pid, which is only known once it is running, so
# the wrapper creates it before evaluating the block.
run_walk() {
  CS_PEERS_PROC="$1/proc" CS_PEERS_SOCKS="$1/socks" HOME="$1/home" \
  START_PARENT="$2" BLOCK_UNDER_TEST="$3" bash -c '
    mkdir -p "$CS_PEERS_PROC/$$"
    printf "Name:\tbash\nPPid:\t%s\n" "$START_PARENT" > "$CS_PEERS_PROC/$$/status"
    eval "$BLOCK_UNDER_TEST"' 2>&1
}
marked() { # marked <pid> <output> -- is <pid>'s row the one tagged "<-- you"?
  awk -F'\t' -v p="$1" '$3==p && $7 ~ /<-- you$/ {f=1} END{exit !f}' <<<"$2"
}

FXA="$TMP/fx-pinned"; mk_fixture "$FXA"
mk_proc "$FXA" 910001 node 910002
mk_peer "$FXA" 910002 2.1.258 1 pinned-server
mk_peer "$FXA" 910003 claude 1 other-peer
if [ ! -S "$FXA/socks/910002.sock" ] || [ ! -S "$FXA/socks/910003.sock" ]; then
  fail "fixture sockets" "could not bind unix sockets under $FXA (path too long, or python3 missing)"
  echo "-- $PASS passed, $FAIL failed"; exit 1
fi

# 8. The walk stops at the socket-owning ancestor even though its `comm` is a
#    version string, and marks exactly that row.
outA=$(run_walk "$FXA" 910001 "$BLOCK")
if marked 910002 "$outA" && ! marked 910003 "$outA" && ! grep -q 'WARNING' <<<"$outA" \
   && grep -qF '(1 peers plus you)' <<<"$outA"; then
  pass "walk terminates on the socket-bearing ancestor despite comm=2.1.258"
else
  fail "walk terminates on the socket-bearing ancestor despite comm=2.1.258" "$outA"
fi

# 9. No socket-bearing ancestor: the failure is LOUD. This is the property the
#    skill calls load-bearing -- an unidentified self still renders a correct-looking
#    table, so the warning is the only signal -- and it must not mark an innocent row.
FXB="$TMP/fx-orphan"; mk_fixture "$FXB"
mk_proc "$FXB" 910001 node 1
mk_peer "$FXB" 910003 claude 1 other-peer
outB=$(run_walk "$FXB" 910001 "$BLOCK")
if grep -q 'WARNING: your own row was NOT identified' <<<"$outB" && ! marked 910003 "$outB"; then
  pass "no socket-bearing ancestor: loud warning, no row marked"
else
  fail "no socket-bearing ancestor: loud warning, no row marked" "$outB"
fi

# 10. The walk does not stop at the first ancestor merely because a DIFFERENT
#     socket exists. Here 910002's socket is absent and only the grandparent has
#     one, so the correct answer is the grandparent.
FXC="$TMP/fx-grandparent"; mk_fixture "$FXC"
mk_proc "$FXC" 910001 node 910002
mk_proc "$FXC" 910002 bash 910004
mk_peer "$FXC" 910004 2.1.258 1 grand-server
mk_peer "$FXC" 910003 claude 1 other-peer
outC=$(run_walk "$FXC" 910001 "$BLOCK")
if marked 910004 "$outC" && ! marked 910003 "$outC"; then
  pass "walk climbs past socket-less ancestors to the first one that owns a socket"
else
  fail "walk climbs past socket-less ancestors to the first one that owns a socket" "$outC"
fi

# 11. THE FIXTURE IS DISCRIMINATING -- an observed RED, not an assertion's existence.
#     Cases 8-10 alone would pass against a fixture the old rule also satisfies.
#     Swap ONLY the loop condition for the rule that shipped before bb14719 (stop
#     at the first ancestor whose `comm` is `claude`) and require the version-pinned
#     fixture to FAIL: the old walk passes over comm=2.1.258 to PID 1 and prints no
#     `<-- you`. If the substitution does not apply (the skill was reworded), say so
#     rather than passing vacuously.
OLD_COND='[ ! -S "$socks/$me.sock" ]'
NEW_COND='[ "$(cat "$proc/$me/comm" 2>/dev/null)" != claude ]'
MUT=${BLOCK//"$OLD_COND"/"$NEW_COND"}
if [ "$MUT" = "$BLOCK" ]; then
  fail "old comm-keyed walk still fails the fixture" "the loop condition '$OLD_COND' was not found in the block; update OLD_COND with the skill"
else
  outM=$(run_walk "$FXA" 910001 "$MUT")
  if grep -q "^claude$(printf '\t')[^$(printf '\t')]*$(printf '\t')910002$(printf '\t')" <<<"$outM" && ! marked 910002 "$outM"; then
    pass "old comm-keyed walk still fails the fixture (the fixture discriminates)"
  else
    fail "old comm-keyed walk still fails the fixture" "expected the table to render with 910002 unmarked; the comm rule either identified the pinned server (cases 8-10 prove nothing) or the block did not run: $outM"
  fi
fi

# 12. THE DELIVER SECTION NAMES ITS MEASURED VERSIONS AND THE REFUSAL RULE. Codex delivery
#     writes a wire format measured on specific Claude Code versions; sending it to an
#     unmeasured one is a guess. Pinned as SHAPE, not wording: the `## Deliver` section
#     must contain the measured version `2.1.312` and a refuse-and-report statement
#     (the words `refuse` and `report`). Rewording is free; deleting either is caught.
deliver_pins_versions() {
  local sec; sec=$(awk '/^## Deliver/{s=1; next} s && /^## /{exit} s{print}' "$1")
  grep -qF '2.1.312' <<<"$sec" && grep -qi 'refuse' <<<"$sec" && grep -qi 'report' <<<"$sec"
}
if deliver_pins_versions "$SKILL"; then
  pass "Deliver names the measured version list and the refuse-and-report rule"
else
  fail "Deliver names the measured version list and the refuse-and-report rule" "section missing, no 2.1.312, or no refuse/report"
fi
# 12b. Control: a copy with the version list removed from the section must be caught.
sed 's/2\.1\.312/X/g' "$SKILL" > "$TMP/no-version.md"
if deliver_pins_versions "$TMP/no-version.md"; then
  fail "control: dropping the measured version from Deliver is caught" "mutated copy still passed"
else
  pass "control: dropping the measured version from Deliver is caught"
fi
sed '/^## Deliver/,$ s/[Rr]efuse/ignore/g' "$SKILL" > "$TMP/no-refuse.md"
if deliver_pins_versions "$TMP/no-refuse.md"; then
  fail "control: dropping the refuse rule from Deliver is caught" "mutated copy still passed"
else
  pass "control: dropping the refuse rule from Deliver is caught"
fi

echo "-- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
