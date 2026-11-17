#!/usr/bin/env bash
# tests/test-prompt-hamsa-split.sh — prompt-hamsa core/evidence split invariants.
#
# The native-register refactor (docs/superpowers/specs/2026-11-17-prompt-hamsa-native-
# register-refactor-design.md) keeps the rules in SKILL.md and moves their evidence to
# references/evidence.md. These are STRUCTURAL assertions: they guard the shape (size,
# frontmatter, headings summon projects, marker words the eval rubric scores, pointers,
# citations) and claim nothing about agent behaviour — prompt-tdd measures that.
#
# Modeled on tests/test-peer-skill-split.sh: every check runs on the real file (must pass)
# and on a mutated COPY under mktemp (must fail); each control also proves its mutation
# changed the copy. The real files are never edited. HAMSA_SKILL_DIR points the suite at
# another skill dir.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${HAMSA_SKILL_DIR:-$ROOT/buddy/skills/prompt-hamsa}"
CORE="$SKILL_DIR/SKILL.md"
EVID="$SKILL_DIR/references/evidence.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

echo "── prompt-hamsa-split ──"

# Design target ~8–10 KB. A failure means move text to references/, never raise the number.
CAP=11000
DESC='description: Improving a prompt — critique, drafting from scratch, diagnosing model misbehavior, or coaching toward eval-driven iteration'

# ---- checks: each takes <core> <evidence> ----
under_cap()          { [ "$(wc -c <"$1")" -lt "$CAP" ]; }
frontmatter_pinned() { grep -qxF 'name: prompt-hamsa' "$1" && grep -qxF -- "$DESC" "$1"; }
# Prefix match at line start: summon_bootstrap.py projects advisors by these prefixes.
has_headings() {
  local h
  for h in '## Voice' '## Operating Principles' '## Method' '## Heuristics' '## Reactions' '## Self-Traps'; do
    grep -q "^$h" "$1" || return 1
  done
}
# The words the prompt-tdd rubrics score, plus the new principle's name.
markers_present() {
  local m
  for m in 'stranger' 'escape hatch' 'unverified' 'cut' 'native register'; do
    grep -qiF -- "$m" "$1" || return 1
  done
}
# Every `§ Hn` / `§ Pn` pointer in the core has a `## Hn ` section in the evidence file.
pointers_resolve() {
  [ -f "$2" ] || return 1
  local toks t; toks=$(grep -oE '§ [HP][0-9]+' "$1" | sort -u | cut -d' ' -f2)
  [ -n "$toks" ] || return 1
  for t in $toks; do grep -qE "^## $t( |$)" "$2" || return 1; done
}
# Citations that lived in H10–H12 before the move must survive it.
citations_kept() {
  [ -f "$2" ] || return 1
  local a
  for a in A-2 A-4 A-5 A-6 A-8 A-9 A-10 A-11 A-14; do
    grep -qE "codescout:$a([^0-9]|$)" "$2" || return 1
  done
}

[ -f "$CORE" ] || { bad "core SKILL.md" "missing $CORE"; echo "── $PASS passed, $FAIL failed"; exit 1; }
for fn in under_cap frontmatter_pinned has_headings markers_present pointers_resolve citations_kept; do
  if "$fn" "$CORE" "$EVID"; then ok "$fn"; else bad "$fn" "failed on $CORE / $EVID"; fi
done

# ---- controls: mutate a copy, prove it changed, the check must then FAIL ----
# control <label> <check-fn> <which: core|evid> <python-mutation: t -> t>
control() {
  local label=$1 fn=$2 which=$3 mut=$4 c="$T/$1-core.md" e="$T/$1-evid.md" src dst
  cp "$CORE" "$c"; if [ -f "$EVID" ]; then cp "$EVID" "$e"; else : >"$e"; fi
  if [ "$which" = core ]; then src=$CORE; dst=$c; else src=$e; dst=$e; cp "$dst" "$T/$1-orig.md"; src="$T/$1-orig.md"; fi
  python3 -c 'import sys;t=open(sys.argv[1]).read();exec(sys.argv[3]);open(sys.argv[2],"w").write(t)' "$src" "$dst" "$mut"
  if cmp -s "$src" "$dst"; then bad "control $label" "mutation did not change the copy"; return; fi
  if "$fn" "$c" "$e"; then bad "control $label" "mutated copy still passed $fn"; else ok "control $label is caught"; fi
}
control oversize      under_cap          core 't += "x" * 12000'
control name_changed  frontmatter_pinned core 't = t.replace("name: prompt-hamsa", "name: prompt-swan", 1)'
control desc_changed  frontmatter_pinned core 't = t.replace("eval-driven iteration", "evals", 1)'
control no_selftraps  has_headings       core 't = t.replace("## Self-Traps", "## Traps")'
control no_stranger   markers_present    core 'import re; t = re.sub("(?i)stranger", "reader", t)'
control no_native     markers_present    core 'import re; t = re.sub("(?i)native register", "plain style", t)'
control dead_pointer  pointers_resolve   core 't += "\n(evidence: references/evidence.md § H99)\n"'
control lost_a11      citations_kept     evid 't = t.replace("codescout:A-11", "A-eleven")'

echo "── $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
