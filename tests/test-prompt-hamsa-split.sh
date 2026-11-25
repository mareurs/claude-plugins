#!/usr/bin/env bash
# tests/test-prompt-hamsa-split.sh — prompt-hamsa core/evidence split invariants.
#
# The native-register refactor (docs/superpowers/specs/2026-11-17-prompt-hamsa-native-
# register-refactor-design.md) keeps the rules in SKILL.md and moves their evidence to
# references/evidence.md; the measuring rules and their evidence live in references/eval.md.
# These are STRUCTURAL assertions: they guard the shape (size,
# frontmatter, headings summon projects, marker words the eval rubric scores, pointers,
# citations) and claim nothing about agent behaviour — prompt-tdd measures that.
#
# Modeled on tests/test-session-bridge-skill.sh: every check runs on the real file (must pass)
# and on a mutated COPY under mktemp (must fail); each control also proves its mutation
# changed the copy. The real files are never edited. HAMSA_SKILL_DIR points the suite at
# another skill dir.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${HAMSA_SKILL_DIR:-$ROOT/buddy/skills/prompt-hamsa}"
CORE="$SKILL_DIR/SKILL.md"
REFS="$SKILL_DIR/references"
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
  for m in 'stranger' 'escape hatch' 'unverified' 'adding before cutting' 'native register'; do
    grep -qiF -- "$m" "$1" || return 1
  done
}
# Every `references/<file>.md § X` pointer in the core has a `## X ` section in THAT file.
pointers_resolve() {
  [ -d "$2" ] || return 1
  local pairs p f t; pairs=$(grep -oE 'references/[a-z]+\.md`? § ([HP][0-9]+|Harness)' "$1" | sort -u)
  [ -n "$pairs" ] || return 1
  while read -r p; do
    f=${p%%.md*}; f=${f#references/}; t=${p##*§ }
    [ -f "$2/$f.md" ] && grep -qE "^## $t( |$)" "$2/$f.md" || return 1
  done <<<"$pairs"
}
# Citations that lived in H10–H12 before the move must survive it, in one of the references.
citations_kept() {
  [ -d "$2" ] || return 1
  local a all; all=$(cat "$2"/*.md 2>/dev/null) || return 1
  for a in A-2 A-4 A-5 A-6 A-8 A-9 A-10 A-11 A-14; do
    grep -qE "codescout:$a([^0-9]|$)" <<<"$all" || return 1
  done
}

# A summon payload inlines the body with no directory, so the core must say where the
# evidence file lives, and must keep the routing target itself, not only a pointer to it.
pointer_locatable() {
  grep -qF 'skills/prompt-hamsa/references/evidence.md' "$1" && grep -qF 'skills/prompt-hamsa/references/eval.md' "$1"
}
routes_playbook()   { grep -qF 'skill-eval-playbook' "$1"; }
# Principle 7 applies to agents with tools, and is flagged unverified (its base arm showed no deficit).
p7_line()           { grep -E '^7\. \*\*Write in the native register' "$1"; }
p7_scoped()         { p7_line "$1" | grep -qF 'When the prompt drives an agent'; }
p7_flagged()        { p7_line "$1" | grep -qiF 'unverified'; }
# The critique and audit-log contract the spec keeps unchanged.
contract_kept() {
  [ "$(grep -oF 'spoken or written' "$1" | wc -l)" -ge 2 ] \
    && grep -qF 'threshold you can defend' "$1" && grep -qF 'input shape' "$1" \
    && grep -qF 'described in the abstract' "$1"
}
# Demonstrations dominate prose (H3): the heuristics keep their exemplars.
exemplars_kept() { grep -qF '≤3 sentences' "$1" && grep -qF 'failing criterion' "$1" && grep -qF 'strict-JSON' "$1"; }
# Every reaction is anchored to a principle or Method step, and there are 3–6 (skill-template.md).
reactions_anchored() {
  local sec n; sec=$(awk '/^## Reactions/{s=1; next} s && /^## /{exit} s{print}' "$1")
  n=$(grep -cE '^[0-9]+\. ' <<<"$sec")
  [ "$n" -ge 3 ] && [ "$n" -le 6 ] && ! grep -E '^[0-9]+\. ' <<<"$sec" | grep -qvF '_Applies:'
}

[ -f "$CORE" ] || { bad "core SKILL.md" "missing $CORE"; echo "── $PASS passed, $FAIL failed"; exit 1; }
for fn in under_cap frontmatter_pinned has_headings markers_present pointers_resolve citations_kept \
          pointer_locatable routes_playbook p7_scoped p7_flagged contract_kept exemplars_kept reactions_anchored; do
  if "$fn" "$CORE" "$REFS"; then ok "$fn"; else bad "$fn" "failed on $CORE / $REFS"; fi
done

# ---- controls: mutate a copy, prove it changed, the check must then FAIL ----
# control <label> <check-fn> <which: core | a file name in references/> <python-mutation: t -> t>
control() {
  local label=$1 fn=$2 which=$3 mut=$4 c="$T/$1-core.md" r="$T/$1-refs" src dst
  cp "$CORE" "$c"; mkdir -p "$r"; cp "$REFS"/*.md "$r"/ 2>/dev/null
  if [ "$which" = core ]; then src=$CORE; dst=$c; else src="$REFS/$which"; dst="$r/$which"; fi
  python3 -c 'import sys;t=open(sys.argv[1]).read();exec(sys.argv[3]);open(sys.argv[2],"w").write(t)' "$src" "$dst" "$mut"
  if cmp -s "$src" "$dst"; then bad "control $label" "mutation did not change the copy"; return; fi
  if "$fn" "$c" "$r"; then bad "control $label" "mutated copy still passed $fn"; else ok "control $label is caught"; fi
}
control oversize      under_cap          core 't += "x" * 12000'
control name_changed  frontmatter_pinned core 't = t.replace("name: prompt-hamsa", "name: prompt-swan", 1)'
control desc_changed  frontmatter_pinned core 't = t.replace("eval-driven iteration", "evals", 1)'
control no_selftraps  has_headings       core 't = t.replace("## Self-Traps", "## Traps")'
control no_stranger   markers_present    core 'import re; t = re.sub("(?i)stranger", "reader", t)'
control no_native     markers_present    core 'import re; t = re.sub("(?i)native register", "plain style", t)'
control dead_pointer  pointers_resolve   core 't += "\n(evidence: references/evidence.md § H99)\n"'
control lost_a11      citations_kept     evidence.md 't = t.replace("codescout:A-11", "A-eleven")'
control lost_a14      citations_kept     eval.md     't = t.replace("codescout:A-14", "A-fourteen")'
control no_hatch      markers_present    core 'import re; t = re.sub("(?i)escape hatch", "exit", t)'
control no_unverified markers_present    core 'import re; t = re.sub("(?i)unverified", "unchecked", t)'
control no_cut_first  markers_present    core 'import re; t = re.sub("(?i)adding before cutting", "adding", t)'
control p6_heading    pointers_resolve   eval.md     't = t.replace("## P6 ", "## P-six ")'
control wrong_file    pointers_resolve   core 't = t.replace("`references/eval.md` § P6", "`references/evidence.md` § P6")'
control ptr_relative  pointer_locatable  core 't = t.replace("skills/prompt-hamsa/references/evidence.md", "references/evidence.md")'
control eval_relative pointer_locatable  core 't = t.replace("skills/prompt-hamsa/references/eval.md", "references/eval.md")'
control no_playbook   routes_playbook    core 't = t.replace("skill-eval-playbook", "eval playbook")'
control p7_unscoped   p7_scoped          core 't = t.replace("When the prompt drives an agent", "When a prompt runs")'
control p7_unflagged  p7_flagged         core 't = t.replace("unverified — base arm showed no deficit", "base arm showed no deficit")'
control no_threshold  contract_kept      core 't = t.replace("threshold you can defend", "threshold")'
control one_spoken    contract_kept      core 't = t.replace("spoken or written", "spoken", 1)'
control no_exemplar   exemplars_kept     core 't = t.replace("failing criterion", "result")'
control unanchored    reactions_anchored core 't = t.replace("_Applies:", "Applies:", 1)'
control seven_reacts  reactions_anchored core 'import re; t = re.sub(r"(?m)^(## Reactions\n(?:.*\n)*?)(## Self-Traps)", r"\\g<1>7. **Extra.** _Applies: P1._ x\n\n\\2", t, count=1)'


echo "── $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
