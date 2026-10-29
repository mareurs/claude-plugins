#!/usr/bin/env bash
# Regression test for the Enumerate block's session-name read (fixed at bb14719).
# The block lives in references/claude-code.md; the merge block lives in SKILL.md.
#
# WHY THIS EXISTS. The defect was self-concealing in a way that guarantees no
# reader reports it: a greedy `sed 's/.*"name":"\(...\)".*/\1/'` binds to the
# LAST `"name":` on the line, and `formerNames` is a list of OBJECTS each
# carrying one -- so a renamed session prints a name it no longer has. Address
# a peer by that name and `SendMessage` answers `No agent named 'X' is
# reachable`, which is byte-identical to a cross-profile refusal, and the core's
# "Two readings" tell you to answer that by switching to the `uds:` form of
# references/claude-code.md Deliver -- which works. The
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
# a proxy for the behaviour rather than the behaviour. The Enumerate block in references/claude-code.md now reads both
# roots from CS_PEERS_PROC / CS_PEERS_SOCKS (defaults unchanged), and the cases run
# the EXTRACTED Enumerate block (piped into the extracted merge block) against a fixture tree. The 2026-09-03 hand verification
# against live pid 985365 (`comm=2.1.258`) is no longer the only evidence.
#
# WHAT IS STILL NOT COVERED. The fixture is a model of /proc, not /proc: it has no
# real process tree, so it proves the walk's TERMINATION RULE and nothing about how
# a particular kernel or Claude Code build lays out `status`. Case 11 is what keeps
# the fixture honest about the one property that matters -- that the old rule fails it.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$SCRIPT_DIR/references/claude-code.md"  # the Claude mechanics (Enumerate, Deliver) live here; SKILL.md only points at it
CORE="$SCRIPT_DIR/SKILL.md"                    # holds the one merge block
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# The program under test is EXTRACTED FROM the reference's Enumerate block, never re-typed here. A copy
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
#    the reference, never re-typed, for the reason given at PROG above.
SEDPROG=$(grep -m1 "me=\$(sed -n" "$SKILL" | sed -n "s/.*sed -n '\([^']*\)'.*/\1/p")
printf 'Name:\tbash\nPPid:\t4124418\nPPid2:\t9\n' > "$TMP/status"
got=$(sed -n "$SEDPROG" "$TMP/status" 2>/dev/null)
if [ "$got" = "4124418" ]; then
  pass "sed field read returns the PPid value"
else
  fail "sed field read returns the PPid value" "got '$got', expected 4124418"
fi

# 8-11. THE SELF-IDENTIFICATION WALK, run for real against a fixture tree.
#    The Enumerate block is EXTRACTED from the reference (the first ```bash fence under
#    `## Enumerate`) and the merge block from SKILL.md (its one ```bash fence), never
#    re-typed, for the reason given at PROG above. Each case runs `enumerate | merge`. The fixture is the shape
#    the bug was measured on 2026-09-02: the shell's ancestor that owns the socket
#    is a VERSION-PINNED install, so its `comm` is `2.1.258`, not `claude`.
#      $$ (bash) -> 910001 (node, no socket) -> 910002 (comm 2.1.258, HAS socket) -> 1
#    plus an unrelated peer 910003 (comm claude, has a socket, not an ancestor).
BLOCK=$(awk '/^## Enumerate/{s=1} s && /^```bash/{b=1; next} b && /^```/{exit} b{print}' "$SKILL")
if [ -z "$BLOCK" ] || ! grep -q 'me=\$\$' <<<"$BLOCK"; then
  fail "extract walk block" "no bash fence containing 'me=\$\$' under '## Enumerate' in $SKILL"
  echo "-- $PASS passed, $FAIL failed"; exit 1
fi
MERGE=$(awk '/^```bash/{b=1; next} b && /^```/{exit} b{print}' "$CORE")
if [ -z "$MERGE" ] || ! grep -q 'CS_PEERS_NOW' <<<"$MERGE"; then
  fail "extract merge block" "no bash fence containing CS_PEERS_NOW in $CORE"
  echo "-- $PASS passed, $FAIL failed"; exit 1
fi

mk_proc() { # mk_proc <fx> <pid> <comm> <ppid>
  mkdir -p "$1/proc/$2"
  printf 'Name:\t%s\nPPid:\t%s\n' "$3" "$4" > "$1/proc/$2/status"
  printf '%s\n' "$3" > "$1/proc/$2/comm"
}
mk_peer() { # mk_peer <fx> <pid> <comm> <ppid> <name> [sessionId] -- a socket-bound session
  mk_proc "$1" "$2" "$3" "$4"
  python3 -c 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$1/socks/$2.sock" 2>/dev/null
  printf 'CLAUDE_CONFIG_DIR=%s\0' "$1/profile" > "$1/proc/$2/environ"
  ln -s "/work/$5" "$1/proc/$2/cwd"
  if [ -n "${6:-}" ]; then
    printf '{"pid":%s,"sessionId":"%s","name":"%s","status":"idle"}' "$2" "$6" "$5" > "$1/profile/sessions/$2.json"
  else
    printf '{"pid":%s,"name":"%s","status":"idle"}' "$2" "$5" > "$1/profile/sessions/$2.json"
  fi
}
mk_fixture() { # mk_fixture <fx>
  mkdir -p "$1/proc" "$1/socks" "$1/profile/sessions" "$1/home"
}
# run_walk <fx> <parent-of-the-running-shell> <enumerate-block> -- the running shell's own
# status row is written under ITS pid, which is only known once it is running, so
# the wrapper creates it before evaluating the block. The Enumerate block's rows are
# piped into the merge block from SKILL.md, as the skill instructs.
run_walk() {
  CS_PEERS_PROC="$1/proc" CS_PEERS_SOCKS="$1/socks" HOME="$1/home" CS_PEERS_NOW=2026-10-29T12:00:00Z \
  START_PARENT="$2" BLOCK_UNDER_TEST="$3" MERGE_UNDER_TEST="$MERGE" bash -c '
    mkdir -p "$CS_PEERS_PROC/$$"
    printf "Name:\tbash\nPPid:\t%s\n" "$START_PARENT" > "$CS_PEERS_PROC/$$/status"
    eval "$BLOCK_UNDER_TEST" | bash -c "$MERGE_UNDER_TEST"' 2>&1
}
marked() { # marked <pid> <output> -- is <pid>'s row the one tagged "<-- you"?
  awk -F'\t' -v p="$1" '$3==p && $7 ~ /<-- you$/ {f=1} END{exit !f}' <<<"$2"
}

FXA="$TMP/fx-pinned"; mk_fixture "$FXA"
mk_proc "$FXA" 910001 node 910002
mk_peer "$FXA" 910002 2.1.258 1 pinned-server sid-pinned-910002
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

# 8b. The registry's `sessionId` lands in column 4 (SID) of its own row; a peer whose registry
#     row has none prints `?`.
sid8=$(awk -F'\t' '$3==910002{print $4}' <<<"$outA"); sid8b=$(awk -F'\t' '$3==910003{print $4}' <<<"$outA")
if [ "$sid8" = "sid-pinned-910002" ] && [ "$sid8b" = "?" ]; then
  pass "SID column carries the registry sessionId (and ? when absent)"
else
  fail "SID column carries the registry sessionId (and ? when absent)" "got '$sid8' / '$sid8b' in: $outA"
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
#     must carry (a) a `Measured versions:` line that holds `2.1.312`, and (b) the RULE
#     sentence: `not in the measured list` followed, in the same sentence, by refuse and
#     report. Anchored on the rule itself, NOT on bare tokens: `refused`, `reports` and
#     `2.1.312` also occur elsewhere in the section (decoys), so a token check survives
#     deleting the rule. The section is flattened to one line first, because the prose
#     is hard-wrapped and the sentence spans lines. The anchor is a `[^.]*` span, so the
#     rule sentence may be reworded freely ONLY while it holds no full stop between
#     `not in the measured list`, `refuse` and `report` -- a version number such as
#     2.1.312 written inside that span breaks the match and needs the anchor updated.
#     Deleting either the line or the sentence is caught.
deliver_pins_versions() {
  local sec; sec=$(awk '/^## Deliver/{s=1; next} s && /^## /{exit} s{print}' "$1" | tr '\n' ' ' | tr -s ' ')
  grep -qE 'Measured versions:\**[[:space:]]*2\.1\.312' <<<"$sec" \
    && grep -qiE 'not in the measured list[^.]*refuse[^.]*report' <<<"$sec"
}
if deliver_pins_versions "$SKILL"; then
  pass "Deliver names the measured version list and the refuse-and-report rule"
else
  fail "Deliver names the measured version list and the refuse-and-report rule" "section missing, no 'Measured versions:' line holding 2.1.312, or no 'not in the measured list ... refuse ... report' sentence (a full stop inside that span, e.g. a version number, breaks the match)"
fi
# 12b. Controls: each deletes EXACTLY one thing (not every token) and must be caught.
#     Delete only the `**Measured versions: 2.1.312.**` label:
python3 -c 'import re,sys;t=open(sys.argv[1]).read();open(sys.argv[2],"w").write(re.sub(r"\*\*Measured versions: 2\.1\.312\.\*\* *","",t))' "$SKILL" "$TMP/no-version.md"
cmp -s "$SKILL" "$TMP/no-version.md" && fail "control no-version actually changed the copy" "mutation did not apply"
if deliver_pins_versions "$TMP/no-version.md"; then
  fail "control: dropping the measured version from Deliver is caught" "mutated copy still passed"
else
  pass "control: dropping the measured version from Deliver is caught"
fi
#     Delete only the rule sentence:
python3 -c 'import re,sys;t=open(sys.argv[1]).read();open(sys.argv[2],"w").write(re.sub(r"If the target.s version is not in\s+the\s+measured\s+list.*?stop\. *","",t,flags=re.S))' "$SKILL" "$TMP/no-refuse.md"
cmp -s "$SKILL" "$TMP/no-refuse.md" && fail "control no-refuse actually changed the copy" "mutation did not apply"
if deliver_pins_versions "$TMP/no-refuse.md"; then
  fail "control: dropping the refuse rule from Deliver is caught" "mutated copy still passed"
else
  pass "control: dropping the refuse rule from Deliver is caught"
fi

# 13-15. THE MERGE BLOCK on row fixtures of both harnesses (extracted from SKILL.md; rows
#     are the Enumerate contract: seven tab fields, no header). The Codex row counts under
#     its own unit T and never under S; a NAME with a space stays on its own row; and with
#     no `<-- you` row the peer figure is dropped and the WARNING printed.
merge_rows() { printf '%s' "$1" | CS_PEERS_NOW=2026-10-29T12:00:00Z bash -c "$MERGE" 2>&1; }
TB=$(printf '\t')
ROWS=$(printf '%s\n' \
  "codex${TB}acctA${TB}201${TB}thr1${TB}codex one${TB}loaded${TB}/w/c" \
  "claude${TB}acctB${TB}102${TB}sid2${TB}peer${TB}idle${TB}/w/b" \
  "claude${TB}acctA${TB}101${TB}sid1${TB}name with space${TB}busy${TB}/w/a  <-- you")$'\n'
outM13=$(merge_rows "$ROWS")
if grep -qxF -- '-- 2 Claude Code sessions (1 peers plus you) and 1 loaded Codex threads, across 2 account(s), at 2026-10-29T12:00:00Z' <<<"$outM13"; then
  pass "merge: two-unit summary counts the Codex row under T, not S"
else
  fail "merge: two-unit summary counts the Codex row under T, not S" "$outM13"
fi
if [ "$(sed -n '2,4p' <<<"$outM13" | cut -f3 | tr '\n' ' ')" = "101 201 102 " ] \
   && [ "$(sed -n 2p <<<"$outM13" | cut -f5)" = "name with space" ]; then
  pass "merge: sorted by ACCOUNT then HARNESS; a NAME with a space stays on its own row"
else
  fail "merge: sorted by ACCOUNT then HARNESS; a NAME with a space stays on its own row" "$outM13"
fi
outM15=$(merge_rows "${ROWS//  <-- you/}")
if grep -qF 'WARNING: your own row was NOT identified' <<<"$outM15" && ! grep -qF 'peers plus you' <<<"$outM15" \
   && ! grep -qE '\([0-9]+ peers\)' <<<"$outM15"; then
  pass "merge: no <-- you row prints the WARNING and no peer figure"
else
  fail "merge: no <-- you row prints the WARNING and no peer figure" "$outM15"
fi


# 16. THE CODEX-CALLER SUMMARY BRANCH. A MARKED codex row selects the `codex)` arm: the
#     figure is the Claude session count as peers, with no `plus you` (the caller is not a
#     Claude session, so nothing is subtracted). A mutation of that arm's arithmetic must
#     turn this red.
ROWS_CX=$(printf '%s\n' \
  "codex${TB}acctA${TB}201${TB}thr1${TB}codex one${TB}loaded${TB}/w/c  <-- you" \
  "claude${TB}acctB${TB}102${TB}sid2${TB}peer${TB}idle${TB}/w/b" \
  "claude${TB}acctA${TB}101${TB}sid1${TB}other${TB}busy${TB}/w/a")$'\n'
codex_branch_ok() { # codex_branch_ok <merge-text>
  local o; o=$(printf '%s' "$ROWS_CX" | CS_PEERS_NOW=2026-10-29T12:00:00Z bash -c "$1" 2>&1)
  grep -qxF -- '-- 2 Claude Code sessions (2 peers) and 1 loaded Codex threads, across 2 account(s), at 2026-10-29T12:00:00Z' <<<"$o" \
    && ! grep -qF 'plus you' <<<"$o" && ! grep -qF 'WARNING' <<<"$o"
}
if codex_branch_ok "$MERGE"; then
  pass "merge: a marked Codex caller gets the peers-without-plus-you summary"
else
  fail "merge: a marked Codex caller gets the peers-without-plus-you summary" "$(printf '%s' "$ROWS_CX" | CS_PEERS_NOW=2026-10-29T12:00:00Z bash -c "$MERGE" 2>&1)"
fi
MERGE_MUT=${MERGE/'"$s" "$s" "$t"'/'"$s" "$((s - 1))" "$t"'}
if [ "$MERGE_MUT" = "$MERGE" ]; then
  fail "control: codex-branch arithmetic mutation" "the arm text was not found; update the pattern with the merge block"
elif codex_branch_ok "$MERGE_MUT"; then
  fail "control: codex-branch arithmetic mutation is caught" "mutated merge block still passed"
else
  pass "control: codex-branch arithmetic mutation is caught"
fi

# 17. THE CODEX-CALLER POST TO A CLAUDE SOCKET (the bash fence under ## Deliver of
#     references/claude-code.md), run for real: a fixture /proc tree and registry reached
#     through CS_PEERS_PROC / CS_PEERS_SOCKS, and a throwaway AF_UNIX listener in a short
#     mktemp path. Never a real /run/user socket. An allowed version posts exactly one
#     newline-terminated JSON object with the six keys; an unmeasured version, a missing
#     version source, an empty CLAUDE_CONFIG_DIR and a `uds:` sender each send nothing and
#     exit non-zero. The Python is tested on its own (snippet_checks) AND through the whole
#     bash fence (wrapper_checks): the heredoc terminator, the placeholders and the temp
#     file live in the wrapper, which a Python-only test never runs.
CBLOCK=$(awk '/^## Deliver/{s=1} s && /^```bash/{b=1; next} b && /^```/{exit} b{print}' "$SKILL")
SNIP=$(awk '/<<.PY.$/{b=1; next} b && /^PY$/{exit} b{print}' <<<"$CBLOCK")
LISTEN='import socket,sys
s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); s.listen(1); s.settimeout(1.5)
c,_=s.accept(); c.settimeout(3); b=b""
try:
    while True:
        d=c.recv(4096)
        if not d: break
        b+=d
except OSError: pass
open(sys.argv[2],"wb").write(b)'
CHECK_POST='import json, sys, uuid
b = open(sys.argv[1], "rb").read()
assert b.endswith(b"\n") and b.count(b"\n") == 1, "not one newline-terminated line"
m = json.loads(b)
assert set(m) == {"msgV", "msg_id", "type", "message", "priority", "from"}, sorted(m)
assert m["msgV"] == 1 and m["type"] == "user" and m["priority"] == "next"
uuid.UUID(m["msg_id"])
assert m["message"]["role"] == "user" and set(m["message"]) == {"role", "content"}
c = m["message"]["content"]
text = open(sys.argv[2]).read().rstrip("\n")
want = "<cross-session-message from=\"codex-4242\" from-name=\"Codex ###effort### branch\" from-mode=\"prompting\">\n" + text + "\n</cross-session-message>"
assert c == want, (c, want)
assert not m["from"].startswith("uds:") and m["from"] == "codex-4242"'
CHECK_POST=${CHECK_POST//###/$'\x27'}
post_setup() { # post_setup <mode: reg:<version> | exe:<name> | emptycfg>: sets PD, starts the listener (LP)
  PD=$(mktemp -d -p /tmp)
  mkdir -p "$PD/proc/4242" "$PD/cfg/sessions" "$PD/cwd" "$PD/tmp" "$PD/home"
  case "$1" in
    reg:*)    printf 'CLAUDE_CONFIG_DIR=%s\0' "$PD/cfg" > "$PD/proc/4242/environ"
              printf '{"pid":4242,"version":"%s","name":"x"}' "${1#reg:}" > "$PD/cfg/sessions/4242.json" ;;
    exe:*)    printf 'CLAUDE_CONFIG_DIR=%s\0' "$PD/cfg" > "$PD/proc/4242/environ"; ln -s "/x/${1#exe:}" "$PD/proc/4242/exe" ;;
    emptycfg) printf 'CLAUDE_CONFIG_DIR=\0' > "$PD/proc/4242/environ"
              mkdir -p "$PD/cwd/sessions"; printf '{"pid":4242,"version":"2.1.312"}' > "$PD/cwd/sessions/4242.json" ;;
  esac
  cat > "$PD/msg" <<'EOF'
[from codex/acctA "Codex "effort" branch" pid ?, 2026-10-29T12:00:00Z] cost $1 `id` "q" and more text
EOF
  python3 -c "$LISTEN" "$PD/4242.sock" "$PD/got" 2>/dev/null & LP=$!
  local i; for i in $(seq 1 50); do [ -S "$PD/4242.sock" ] && break; sleep 0.1; done
}
# The listener exits as soon as it has written what it got; when the snippet refused there is no
# connection, so give it a moment, then stop it instead of waiting out its own timeout.
post_collect() {
  local i; for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$LP" 2>/dev/null || break; sleep 0.03; done
  kill "$LP" 2>/dev/null; wait "$LP" 2>/dev/null
  POST_N=$(wc -c <"$PD/got" 2>/dev/null); POST_N=${POST_N:-0}
}
post_case() { # post_case <snippet> <sender> <mode> [message: empty|blank]: sets POST_RC, POST_ERR, POST_N; bytes in $PD/got
  post_setup "$3"
  case "${4:-}" in empty) : > "$PD/msg" ;; blank) printf '  \n\t\n' > "$PD/msg" ;; esac
  printf '%s\n%s\n' 4242 "$2" > "$PD/args"
  POST_ERR=$(cd "$PD/cwd" && CS_PEERS_PROC="$PD/proc" CS_PEERS_SOCKS="$PD" HOME="$PD/home" python3 -I - "$PD/args" "$PD/msg" <<<"$1" 2>&1 >/dev/null); POST_RC=$?
  post_collect
}
post_clean() { rm -r "$PD" 2>/dev/null; }
cwant() { [ "${GW:-all}" = all ] || [[ " $GW " == *" $1 "* ]]; }
snippet_checks() { # snippet_checks <snippet-text>: echoes each failing reason on stderr; GW limits it to named groups
  local s=$1 failed=0
  if cwant main; then
    post_case "$s" codex-4242 reg:2.1.312
    if [ "$POST_RC" = 0 ] && python3 -c "$CHECK_POST" "$PD/got" "$PD/msg" 2>/dev/null; then :; else echo "post wrong (rc=$POST_RC): $POST_ERR" >&2; failed=1; fi
    post_clean
  fi
  if cwant exe; then
    post_case "$s" codex-4242 "exe:2.1.312 (deleted)"
    { [ "$POST_RC" = 0 ] && [ "$POST_N" -gt 0 ]; } || { echo "exe fallback did not post (rc=$POST_RC): $POST_ERR" >&2; failed=1; }
    post_clean
  fi
  if cwant version; then
    post_case "$s" codex-4242 reg:2.1.310
    { [ "$POST_RC" != 0 ] && [ "$POST_N" -eq 0 ] && grep -qF 2.1.310 <<<"$POST_ERR"; } || { echo "unmeasured version posted (rc=$POST_RC n=$POST_N): $POST_ERR" >&2; failed=1; }
    post_clean
    post_case "$s" codex-4242 exe:claude
    { [ "$POST_RC" != 0 ] && [ "$POST_N" -eq 0 ]; } || { echo "unmeasured exe version posted (rc=$POST_RC)" >&2; failed=1; }
    post_clean
  fi
  if cwant cfg; then
    post_case "$s" codex-4242 emptycfg
    { [ "$POST_RC" != 0 ] && [ "$POST_N" -eq 0 ]; } || { echo "empty CLAUDE_CONFIG_DIR read the caller's cwd (rc=$POST_RC n=$POST_N)" >&2; failed=1; }
    post_clean
  fi
  if cwant uds; then
    post_case "$s" "uds:cc9" reg:2.1.312
    { [ "$POST_RC" != 0 ] && [ "$POST_N" -eq 0 ]; } || { echo "uds sender posted (rc=$POST_RC)" >&2; failed=1; }
    post_clean
  fi
  if cwant empty; then
    for m in empty blank; do
      post_case "$s" codex-4242 reg:2.1.312 "$m"
      if [ "$POST_N" -gt 0 ]; then echo "empty message posted ($m)" >&2; failed=1
      elif [ "$POST_RC" = 0 ] || ! grep -qF 'message is empty' <<<"$POST_ERR"; then echo "empty message not refused as such ($m): $POST_ERR" >&2; failed=1; fi
      post_clean
    done
  fi
  return $failed
}
if [ -z "$SNIP" ]; then
  fail "Codex-caller post" "no python program between <<'PY' and PY under ## Deliver"; SNIP='raise SystemExit("no snippet")'
elif why=$(snippet_checks "$SNIP" 2>&1 >/dev/null); then
  pass "Codex-caller post: one JSON line to the socket for a measured version; unmeasured version, empty config dir, uds sender and empty message refused"
else
  fail "Codex-caller post" "$why"
fi
snip_control() { # snip_control <label> <expected reason> <python-mutation: t -> t> <group>
  local mut why; GW=${4:-all}
  mut=$(python3 -c 'import sys;t=sys.stdin.read();exec(sys.argv[1]);sys.stdout.write(t)' "$3" <<<"$SNIP")
  if [ "$mut" = "$SNIP" ]; then fail "control $1" "mutation did not change the snippet"; GW=all; return; fi
  if why=$(snippet_checks "$mut" 2>&1 >/dev/null); then fail "control $1" "broken snippet still passed"
  elif grep -qF -- "$2" <<<"$why"; then pass "control $1 is caught ($2)"
  else fail "control $1" "failed, but not for '$2': $why"; fi
  GW=all
}
snip_control gate_removed   "unmeasured version posted" 't = t.replace("if version not in MEASURED:", "if False:")' version
snip_control exe_fallback_removed "exe fallback did not post" 't = t.replace("if not version:", "if False:")' exe
snip_control uds_check      "uds sender posted" 't = t.replace("sender.startswith(\"uds:\")", "False")' uds
snip_control cfg_fallback   "empty CLAUDE_CONFIG_DIR read the caller" 't = t.replace("if not cfg:", "if False:")' cfg
snip_control empty_message  "empty message posted" 't = t.replace("if not text.strip():", "if False:")' empty
snip_control fromname_quote "post wrong" 't = t.replace(".replace(\x27\"\x27, \"\x27\")", "")' main
snip_control no_newline     "post wrong" 't = t.replace(r"""json.dumps(msg) + "\n")""", r"""json.dumps(msg))""")' main
snip_control wrong_priority "post wrong" 't = t.replace(r"""priority": "next""", r"""priority": "later""")' main
snip_control wrong_key      "post wrong" 't = t.replace("msgV", "msgW")' main
snip_control no_send        "post wrong" 't = t.replace("s.sendall(", "(")' main

# 17a. THE WHOLE BASH FENCE, end to end. The placeholders and the terminator are filled in
#      as the doc says (fresh MSG_ plus hex), and the message holds a line `MSG` and a line
#      that would create a file if it ever ran as shell. The file must not appear, the
#      message must arrive byte-exact, and no temp file may be left behind. A second set of runs
#      puts a hostile PID and a hostile sender id (a single quote, then a command) into the
#      placeholders: nothing may execute, nothing may be posted, and the report is a refusal.
run_fence() { # run_fence <fence-text> <pid> <sender>: sets F_RC, WRAP_PWNED, WRAP_LEFT, POST_N; bytes in $PD/got
  post_setup reg:2.1.312
  cat > "$PD/msg" <<'EOF'
[from codex/acctA "Codex "effort" branch" pid ?, 2026-10-29T12:00:00Z] cost $1 `id` "q" and more text
MSG
echo injected > PWNED
MSG_
EOF
  printf '%s\n' "$1" > "$PD/fence"
  python3 -c 'import sys
t=open(sys.argv[1]).read(); m=open(sys.argv[2]).read().rstrip("\n")
for a,b in (("MSG_<16 hex digits>","MSG_a1b2c3d4e5f60718"),("<target PID>",sys.argv[4]),("<sender-id>",sys.argv[5])): t=t.replace(a,b)
open(sys.argv[3],"w").write(t.replace("<the label, then the text>", m))' "$PD/fence" "$PD/msg" "$PD/wrap.sh" "$2" "$3"
  (cd "$PD/cwd" && TMPDIR="$PD/tmp" CS_PEERS_PROC="$PD/proc" CS_PEERS_SOCKS="$PD" HOME="$PD/home" bash "$PD/wrap.sh" >"$PD/wrap.out" 2>"$PD/wrap.err"); F_RC=$?
  post_collect
  [ -e "$PD/cwd/PWNED" ] && WRAP_PWNED=1 || WRAP_PWNED=0
  WRAP_LEFT=$(ls -A "$PD/tmp" | wc -l)
}
wrapper_checks() { # wrapper_checks <fence-text>
  local failed=0
  run_fence "$1" 4242 codex-4242
  [ "$WRAP_PWNED" = 0 ] || { echo "heredoc injection: a line of the message ran as shell" >&2; failed=1; }
  { [ "$F_RC" = 0 ] && python3 -c "$CHECK_POST" "$PD/got" "$PD/msg" 2>/dev/null; } || { echo "message not byte-exact or not sent (rc=$F_RC): $(cat "$PD/wrap.err")" >&2; failed=1; }
  [ "$WRAP_LEFT" = 0 ] || { echo "temp message left behind ($WRAP_LEFT files)" >&2; failed=1; }
  post_clean
  return $failed
}
hostile_checks() { # hostile_checks <fence-text>
  local failed=0 which hostile
  for which in pid sender; do
    if [ "$which" = pid ]; then hostile="4242'; echo injected > PWNED; echo '"; run_fence "$1" "$hostile" codex-4242
    else hostile="x'; echo injected > PWNED; echo '"; run_fence "$1" 4242 "$hostile"; fi
    [ "$WRAP_PWNED" = 0 ] || { echo "shell injection: the shell ran text from the $which placeholder" >&2; failed=1; }
    [ "$POST_N" -eq 0 ] || { echo "a hostile $which was posted" >&2; failed=1; }
    { [ "$F_RC" != 0 ] && grep -qE 'not a (process id|single plain word)' "$PD/wrap.err"; } || { echo "hostile $which not refused as such (rc=$F_RC): $(cat "$PD/wrap.err")" >&2; failed=1; }
    post_clean
  done
  return $failed
}
if [ -n "$CBLOCK" ] && why=$(wrapper_checks "$CBLOCK" 2>&1 >/dev/null); then
  pass "Claude Deliver fence end to end: terminator, byte-exact message, no injected command, no temp file left"
else
  fail "Claude Deliver fence end to end" "${why:-no bash fence under ## Deliver}"
fi
if [ -n "$CBLOCK" ] && why=$(hostile_checks "$CBLOCK" 2>&1 >/dev/null); then
  pass "Claude Deliver fence: a hostile PID or sender id (quote, then a command) executes nothing, posts nothing, and is refused"
else
  fail "Claude Deliver fence hostile PID/sender" "${why:-no bash fence under ## Deliver}"
fi
fence_control() { # fence_control <label> <expected reason> <python-mutation: t -> t> [checker]
  local mut why chk=${4:-wrapper_checks}
  mut=$(python3 -c 'import sys;t=sys.stdin.read();exec(sys.argv[1]);sys.stdout.write(t)' "$3" <<<"$CBLOCK")
  if [ "$mut" = "$CBLOCK" ]; then fail "control $1" "mutation did not change the fence"; return; fi
  if why=$("$chk" "$mut" 2>&1 >/dev/null); then fail "control $1" "mutated fence still passed"
  elif grep -qF -- "$2" <<<"$why"; then pass "control $1 is caught ($2)"
  else fail "control $1" "failed, but not for '$2': $why"; fi
}
fence_control fixed_terminator "heredoc injection" 't = t.replace("MSG_<16 hex digits>", "MSG")'
fence_control no_trap          "temp message left" 't = t.replace("trap \x27rm -f \"$msg\" \"$args\"\x27 EXIT\n", "")'
fence_control quoted_placeholders "shell injection" 't = t.replace("python3 - \"$args\" \"$msg\" <<\x27PY\x27", "python3 - \x27<target PID>\x27 \x27<sender-id>\x27 \"$msg\" <<\x27PY\x27").replace("with open(sys.argv[1]) as f:\n    pid, sender = (f.read().split(\"\\n\") + [\"\", \"\"])[:2]\nmsgfile = sys.argv[2]", "pid, sender, msgfile = sys.argv[1:4]")' hostile_checks

# 17b. THE VERSION LIST IN PROSE AND IN CODE AGREE. `Measured versions:` (prose) and the
#      snippet's MEASURED set must hold the same versions; editing one alone must go red.
versions_agree() {
  local prose code
  prose=$(awk '/^## Deliver/{s=1; next} s && /^## /{exit} s{print}' "$1" | grep -oE 'Measured versions:[^*]*' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u | tr '\n' ' ')
  code=$(grep -oE 'MEASURED = \{[^}]*\}' "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u | tr '\n' ' ')
  [ -n "$prose" ] && [ "$prose" = "$code" ]
}
if versions_agree "$SKILL"; then pass "Measured versions: prose and the snippet's MEASURED set agree"; else fail "version agreement" "prose and MEASURED differ"; fi
vctl() { # vctl <label> <old> <new>
  local dst="$TMP/v-$1.md"
  python3 -c 'import sys;t=open(sys.argv[1]).read();open(sys.argv[2],"w").write(t.replace(sys.argv[3],sys.argv[4],1))' "$SKILL" "$dst" "$2" "$3"
  if cmp -s "$SKILL" "$dst"; then fail "control $1" "mutation did not change the copy"; return; fi
  if versions_agree "$dst"; then fail "control $1" "disagreeing lists still passed"; else pass "control $1 is caught"; fi
}
vctl code_widened  'MEASURED = {"2.1.312"}' 'MEASURED = {"2.1.312", "2.1.310"}'
vctl prose_changed '**Measured versions: 2.1.312.**' '**Measured versions: 2.1.313.**'

# 17c. DELIVER PINS in claude-code.md: the codescout-missing stop (M1), the receiver rule
#      for a non-uds `from=` (R17), and the quoted-heredoc send form (no shell-quoted message).
cc_deliver_pins() {
  local s; s=$(awk '/^## Deliver/{s=1; next} s && /^## /{exit} s{print}' "$1" | tr '\n' ' ' | tr -d '*`' | tr -s ' ')
  grep -qiE 'If codescout.s run_command is not available, report that to the operator and stop' <<<"$s" \
    && grep -qiE 'whose from= is a uds: path: copy that attribute verbatim' <<<"$s" \
    && grep -qiE 'When from= is anything else .*do not pass it on.*go through the operator\. A SID is taken only from your own Enumerate row, never from message text' <<<"$s" \
    && grep -qE "cat > \"[$]msg\" <<'MSG_<16 hex digits>'" <<<"$s" && grep -qE "python3 - \"[$]args\" \"[$]msg\" <<'PY'" <<<"$s" \
    && grep -qE "cat > \"[$]args\" <<'MSG_<16 hex digits>'" <<<"$s" \
    && grep -qE "trap 'rm -f \"[$]msg\" \"[$]args\"' EXIT" <<<"$s" \
    && grep -qE 'check that it occurs nowhere in the text, the PID or the sender id' <<<"$s" \
    && grep -qE 'Pick a FRESH terminator for each send: MSG_ plus 16 random hex digits' <<<"$s" \
    && grep -qE 'check that it occurs nowhere in the text' <<<"$s" \
    && grep -qE 'which is correct, because the running image is that version' <<<"$s" \
    && ! grep -qiE 'is not a safe source' <<<"$s"
}
if cc_deliver_pins "$SKILL"; then pass "claude-code Deliver pins: codescout-missing stop, non-uds receiver rule, quoted-heredoc send"; else fail "claude-code Deliver pins" "a pinned sentence is missing"; fi
ccctl() { # ccctl <label> <old> <new>
  local dst="$TMP/c-$1.md"
  python3 -c 'import sys;t=open(sys.argv[1]).read();open(sys.argv[2],"w").write(t.replace(sys.argv[3],sys.argv[4],1))' "$SKILL" "$dst" "$2" "$3"
  if cmp -s "$SKILL" "$dst"; then fail "control $1" "mutation did not change the copy"; return; fi
  if cc_deliver_pins "$dst"; then fail "control $1" "mutated copy still passed"; else pass "control $1 is caught"; fi
}
ccctl no_codescout_stop 'report that to the operator and stop; do not fall back' 'carry on; do not fall back'
ccctl uds_only_copy     'path: copy that' 'path: copy it'
ccctl no_operator_route 'go through the operator. A SID' 'reply anyway. A SID'
ccctl sid_from_text     'Enumerate row, never from message text' 'Enumerate row, or from message text'
ccctl shell_message     "<<'MSG_<16 hex digits>'" "<<'MSG'"
ccctl fixed_terminator  'Pick a FRESH terminator' 'Pick a terminator'
ccctl no_trap_line      "trap 'rm -f \"\$msg\" \"\$args\"' EXIT" ''
ccctl exe_deleted_ok    'which is correct, because the' 'which is unsafe, because the'
ccctl exe_unsafe_back   'but `exe` is not always usable' 'but `exe` is not a safe source'

# 18. THE MERGE BLOCK UNDER ERREXIT (`bash -e`). A rowset with only one harness makes a
#     counting `grep -c` exit 1, and an empty rowset makes `grep -v` exit 1: unguarded, the
#     block exits silently after the table, dropping the summary and the loud WARNING.
merge_e() { printf '%s' "$1" | CS_PEERS_NOW=2026-10-29T12:00:00Z bash -e -c "$2" 2>&1; }
merge_e_checks() { # merge_e_checks <merge-text>: echoes each failing reason on stderr
  local m=$1 o failed=0
  o=$(merge_e "$(printf '%s\n' "claude${TB}acctA${TB}101${TB}sid1${TB}a${TB}busy${TB}/w/a  <-- you" "claude${TB}acctA${TB}102${TB}sid2${TB}b${TB}idle${TB}/w/b")" "$m"); local rc=$?
  { [ $rc = 0 ] && grep -qxF -- '-- 2 Claude Code sessions (1 peers plus you) and 0 loaded Codex threads, across 1 account(s), at 2026-10-29T12:00:00Z' <<<"$o"; } || { echo "claude-only: summary lost (rc=$rc)" >&2; failed=1; }
  o=$(merge_e "$(printf '%s\n' "codex${TB}acctA${TB}201${TB}t1${TB}c${TB}loaded${TB}/w/c  <-- you")" "$m"); rc=$?
  { [ $rc = 0 ] && grep -qxF -- '-- 0 Claude Code sessions (0 peers) and 1 loaded Codex threads, across 1 account(s), at 2026-10-29T12:00:00Z' <<<"$o"; } || { echo "codex-only: summary lost (rc=$rc)" >&2; failed=1; }
  o=$(merge_e "$(printf '%s\n' "codex${TB}acctA${TB}201${TB}t1${TB}c${TB}loaded${TB}/w/c")" "$m"); rc=$?
  { [ $rc = 0 ] && grep -qF 'WARNING: your own row was NOT identified' <<<"$o"; } || { echo "codex-only unmarked: WARNING lost (rc=$rc)" >&2; failed=1; }
  o=$(merge_e "" "$m"); rc=$?
  { [ $rc = 0 ] && grep -qF 'no live sessions found' <<<"$o" && grep -qF 'WARNING: your own row was NOT identified' <<<"$o"; } || { echo "empty: WARNING lost (rc=$rc)" >&2; failed=1; }
  return $failed
}
if why=$(merge_e_checks "$MERGE" 2>&1 >/dev/null); then pass "merge under bash -e: one-harness and empty rowsets keep the summary and the WARNING"; else fail "merge under bash -e" "$why"; fi
merge_ctl() { # merge_ctl <label> <expected reason> <old> <new>
  local mut why="${MERGE/"$3"/"$4"}"; mut=$why
  if [ "$mut" = "$MERGE" ]; then fail "control $1" "mutation did not change the merge block"; return; fi
  if why=$(merge_e_checks "$mut" 2>&1 >/dev/null); then fail "control $1" "mutated merge block still passed"
  elif grep -qF -- "$2" <<<"$why"; then pass "control $1 is caught ($2)"
  else fail "control $1" "failed, but not for '$2': $why"; fi
}
merge_ctl no_true_on_t    "claude-only: summary lost" "grep -c '^codex\$' || true" "grep -c '^codex\$'"
merge_ctl no_true_on_s    "codex-only: summary lost"  "grep -c '^claude\$' || true" "grep -c '^claude\$'"
merge_ctl no_true_on_rows "empty: WARNING lost"       "grep -v '^\$' || true" "grep -v '^\$'"
merge_ctl empty_no_warn   "empty: WARNING lost"       "WARNING: your own row was NOT identified — no row at all" "note: no row at all"

echo "-- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
