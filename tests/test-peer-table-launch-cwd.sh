#!/usr/bin/env bash
# tests/test-peer-table-launch-cwd.sh — the peer table's cwd column must say what it measures.
#
# reaching-peer-sessions Step 1 reads `readlink /proc/<pid>/cwd`: where a process was LAUNCHED.
# It was headed `CWD` and universally read as "where this session is working", which codescout's
# `workspace(action="activate")` changes without touching the process cwd. On 2026-09-09 that
# misreading was one message from licensing `git worktree remove` on an occupied worktree
# (codescout bug 2026-09-09-cwd-answers-who-is-alive-and-is-read-as-who-is-working-where).
# The fix is prose — a `LAUNCH-CWD` header and a Step 4 that ASKS — and prose regresses by
# tidy-up with nothing red, which is what this suite is for.
#
# SHAPE, NOT SENTENCES. It pins the header token, the Step 4 heading and the socket question —
# the three things whose deletion reintroduces the defect — and no wording around them.
#
# NOT VACUOUS BY CONSTRUCTION. Every check is also run against a mutated COPY that reintroduces
# the defect, and must fail there. The copies live under mktemp -d; the real SKILL.md is never
# edited, because another session may be reading it. PEER_SKILL_MD points the suite elsewhere.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL="${PEER_SKILL_MD:-$ROOT/codescout-companion/skills/reaching-peer-sessions/SKILL.md}"
PASS=0
FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SKILL" ] || { echo "FAIL: no skill file at $SKILL"; exit 1; }

# The header is a printf format string in the skill's code block, so `\t` is two literal
# characters there — grep -F matches them as written.
header_says_launch_cwd() { grep -qF 'STATUS\tLAUNCH-CWD\n' "$1" && ! grep -qF 'STATUS\tCWD\n' "$1"; }
step4_exists() { grep -qF '## Step 4 — before acting on where a peer is WORKING, ask' "$1"; }
step4_asks_over_the_socket() { grep -qF 'are you working in <path> right now?' "$1"; }

header_says_launch_cwd "$SKILL" && pass "Step 1's header says LAUNCH-CWD, not a bare CWD" \
    || fail "Step 1's header says LAUNCH-CWD, not a bare CWD"
step4_exists "$SKILL" && pass "Step 4 (ask before acting on occupancy) exists" \
    || fail "Step 4 (ask before acting on occupancy) exists"
step4_asks_over_the_socket "$SKILL" && pass "Step 4 carries the question to send" \
    || fail "Step 4 carries the question to send"

# ---- the controls: each mutation reintroduces one half of the defect and must be caught.
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

sed 's/STATUS\\tLAUNCH-CWD\\n/STATUS\\tCWD\\n/' "$SKILL" > "$T/old-header.md"
header_says_launch_cwd "$T/old-header.md" && fail "control: the pre-fix CWD header is caught" \
    || pass "control: the pre-fix CWD header is caught"

sed '/^## Step 4 — before acting on where a peer is WORKING, ask$/d' "$SKILL" > "$T/no-step4.md"
step4_exists "$T/no-step4.md" && fail "control: deleting Step 4 is caught" \
    || pass "control: deleting Step 4 is caught"

sed '/are you working in <path> right now?/d' "$SKILL" > "$T/no-question.md"
step4_asks_over_the_socket "$T/no-question.md" && fail "control: deleting the question is caught" \
    || pass "control: deleting the question is caught"

# A control that mutated nothing would pass for the wrong reason; prove each copy differs.
for m in old-header no-step4 no-question; do
    cmp -s "$SKILL" "$T/$m.md" && fail "control $m actually changed the copy" \
        || pass "control $m actually changed the copy"
done

echo "-- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
