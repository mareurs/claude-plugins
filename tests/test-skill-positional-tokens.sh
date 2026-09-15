#!/usr/bin/env bash
# tests/test-skill-positional-tokens.sh — no `$`-plus-digit in any skill body.
#
# WHY THIS EXISTS. Claude Code argument-substitutes a skill body BEFORE
# delivering it, and the rewrite reaches inside fenced code blocks: a `$`
# followed by a digit is replaced with a word of the CALLER's `args` string.
# `$N` takes the (N+1)-th whitespace-separated word -- 0-indexed, quotes
# stripped. Measured 2026-09-15 on CLI 2.1.272. What a session executes is
# therefore not what is on disk, and the file is never the thing that is wrong.
#
# It shipped TWICE, in two different plugins, and neither instance announced
# itself:
#
#   codescout-companion/skills/reaching-peer-sessions -- the self-identification
#   walk read `awk '/^PPid:/{print <dollar>2}'`. Two sessions minutes apart
#   executed `{print garaj-96}` and `{print terrace}`, each the third word of
#   its own args. A rewritten walk finds no socket, marks no `<-- you` row, and
#   renders a table identical to a correct run. Both sessions blamed a typo in
#   the skill; the file on disk was correct every time.
#
#   buddy/skills/data-leakage-snow-pheasant -- prose rather than code, and no
#   less wrong: the literal costs `$4.20` and `$1.40` were delivered as `.20`
#   and `.40`.
#
# WHY A REPO-WIDE SUITE AND NOT A COLOCATED ONE. The first fix shipped with a
# colocated regression test. That guards exactly one skill, and the second
# instance was in a different PLUGIN -- so the guard could not have caught it.
# Worse, run-all.sh's colocated-skill glob is
# `codescout-companion/skills/*/*.test.sh`: a test placed beside a buddy skill
# is not discovered at all, and its absence reads exactly like a pass. This file
# lives in tests/ because `test-*.sh` there is the only glob that reaches every
# plugin.
#
# WHY STATIC, WITH NO RUNTIME COMPANION. An out-of-range index passes through
# untouched, so a body containing `$2` invoked with two-word args is delivered
# verbatim and looks clean. The corruption is a function of the CALLER's args,
# which no test here controls. There is no runtime signal to wait for; this
# check is the whole defence.
#
# NOT SCANNED: commands/*.md. A slash command's `$1` is the documented argument
# placeholder and is meant to be substituted -- buddy/commands/summon.md and its
# siblings rely on it. Skills receive their args appended as a trailing
# `ARGUMENTS:` line instead, so a `$N` in a SKILL.md is never load-bearing and
# always a latent rewrite.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# The one pattern under test, defined once so the assertion and the negative
# control below cannot drift apart into testing two different things.
TOKEN_RE='\$[0-9]'

# Discovery is every SKILL.md in the repo, with no path exclusions. An earlier
# draft filtered out `*docs*` to skip documentation copies and would have
# silently dropped buddy/skills/docs-lotus-frog/SKILL.md -- a REAL skill whose
# directory name merely contains the word. That is the same shape as the bug
# being guarded: a plausible-looking filter, a quietly smaller population, and a
# green suite either way.
mapfile -t SKILLS < <(find "$REPO_ROOT" -name 'SKILL.md' -not -path '*/.git/*' | sort)

# 1. ASSERT THE POPULATION, NEVER THE GLOB. A find that matches nothing makes
#    every case below vacuously green -- the one outcome this suite cannot
#    otherwise report. Requiring a hit in each plugin pins CROSS-PLUGIN reach
#    specifically, which is the coverage hole that let instance two through; a
#    bare count would still pass if one plugin's tree stopped matching.
n_buddy=0; n_cc=0
for f in "${SKILLS[@]}"; do
  case "$f" in
    */buddy/skills/*) n_buddy=$((n_buddy+1)) ;;
    */codescout-companion/skills/*) n_cc=$((n_cc+1)) ;;
  esac
done
if [ "${#SKILLS[@]}" -ge 2 ] && [ "$n_buddy" -gt 0 ] && [ "$n_cc" -gt 0 ]; then
  pass "discovery reaches both plugins (${#SKILLS[@]} skills: $n_buddy buddy, $n_cc codescout-companion)"
else
  fail "discovery reaches both plugins" \
       "found ${#SKILLS[@]} total, $n_buddy buddy, $n_cc codescout-companion -- the find in $0 matches too little"
fi

# 2. THE ACTUAL ASSERTION.
hits=""
for f in "${SKILLS[@]}"; do
  while IFS= read -r line; do
    [ -n "$line" ] && hits="$hits${f#"$REPO_ROOT"/}:$line"$'\n'
  done < <(grep -n "$TOKEN_RE" "$f" 2>/dev/null || true)
done
if [ -z "$hits" ]; then
  pass "no \$-plus-digit token in any skill body"
else
  fail "no \$-plus-digit token in any skill body" \
       "these are rewritten with the caller's args on delivery:"$'\n'"$hits"
fi

# 3. THE CHECK IS DISCRIMINATING -- an observed RED, not an assertion's mere
#    existence. Case 2 would pass forever against a typo'd pattern or an empty
#    population. Run the same regex over the exact lines that shipped and
#    REQUIRE both to be caught: the awk one (code) and the cost one (prose),
#    because the defect is not confined to code blocks.
printf '%s\n' "  me=\$(awk '/^PPid:/{print \$2}' \"/proc/\$me/status\")" > "$TMP/bad_code.md"
printf '%s\n' "Cost of the miss: \$4.20 and a near-spiral into doubt." > "$TMP/bad_prose.md"
if grep -q "$TOKEN_RE" "$TMP/bad_code.md" && grep -q "$TOKEN_RE" "$TMP/bad_prose.md"; then
  pass "guard still catches both forms that shipped (code and prose)"
else
  fail "guard still catches both forms that shipped (code and prose)" \
       "regex '$TOKEN_RE' missed a known-bad line"
fi

# 4. THE CHECK IS SPECIFIC. An over-broad matcher that flagged ordinary shell
#    would be worked around or switched off, taking case 2 with it. Pin the
#    forms that MUST stay legal -- every one of these appears in a live skill
#    body today and none is rewritten, because only `$`-plus-digit is.
cat > "$TMP/good.md" <<'GOOD'
me=$$
while [ -n "$me" ] && [ ! -S "/run/user/$u/cc-socks/$me.sock" ]; do :; done
d=${d:-$HOME/.claude}; p=${s##*/}
nm=$(python3 -c 'import sys;print(sys.argv[1])' "$d/sessions/$p.json")
The argument is $ARGUMENTS, and a bare $ sign is fine too.
GOOD
if grep -q "$TOKEN_RE" "$TMP/good.md"; then
  fail "named vars, \$\$ and \$ARGUMENTS stay legal" \
       "regex '$TOKEN_RE' false-positives on: $(grep -n "$TOKEN_RE" "$TMP/good.md")"
else
  pass "named vars, \$\$ and \$ARGUMENTS stay legal"
fi

echo "-- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
