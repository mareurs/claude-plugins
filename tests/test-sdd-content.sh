#!/bin/bash
# tests/test-sdd-content.sh
#
# Content contract for the sdd plugin after it became a thin strict-SDD layer over
# superpowers and codescout: the superseded surface is gone, the constitution
# templates live under sdd/templates/, and no file mentions the retired tooling.
# Grows in Task 10 (the rewritten skill, commands and README).
#
# Read-only: creates no files and mutates nothing, so there is nothing to clean up.

echo "── sdd-content ──"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDD="$REPO_ROOT/sdd"

PASS_COUNT=0
FAIL_COUNT=0
pass() { PASS_COUNT=$((PASS_COUNT + 1)); echo "  PASS: $1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo "  FAIL: $1${2:+: $2}"; }

# Paths removed by Task 4.
DELETED_PATHS=(
  sdd/commands/specify.md
  sdd/commands/plan.md
  sdd/commands/drift.md
  sdd/commands/document.md
  sdd/commands/bootstrap-docs.md
  sdd/agents
  sdd/bootstrap-sdd.sh
  sdd/memory
  sdd/ecosystem
  sdd/hooks/mark-reviewed.mjs
  tests/test-sdd-hooks.sh
)
for p in "${DELETED_PATHS[@]}"; do
  if [ ! -e "$REPO_ROOT/$p" ]; then pass "deleted: $p"; else fail "deleted: $p" "still exists"; fi
done

# Paths that must exist after the move.
MOVED_PATHS=(
  sdd/templates/constitution/base.md
  sdd/templates/constitution/kotlin.md
  sdd/templates/constitution/python.md
  sdd/templates/CLAUDE.md.template
)
for p in "${MOVED_PATHS[@]}"; do
  if [ -f "$REPO_ROOT/$p" ]; then pass "moved: $p"; else fail "moved: $p" "missing"; fi
done

# Files a LATER task still rewrites, so they may still carry retired strings.
# One path per line. Every rewrite has landed, so the list is empty and every file is scanned.
PENDING_REWRITE=()

if [ "${#PENDING_REWRITE[@]}" -eq 0 ]; then
  pass "PENDING_REWRITE is empty"
else
  fail "PENDING_REWRITE is empty" "still lists: ${PENDING_REWRITE[*]}"
fi

# Retired strings, as grep -E alternation.
RETIRED='memory/specs|Serena|serena|read_markdown|edit_markdown|superpowers:code-reviewer|ralph-sdd|COMPONENT_REGISTRY|memory/plans|memory/constitution|/specify|/drift|/document|/bootstrap-docs|sdd-ecosystem-architect'

# Resolve hits to repo-relative paths and drop only exact PENDING_REWRITE matches.
HITS=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rel="${f#"$REPO_ROOT"/}"
  skip=""
  for p in "${PENDING_REWRITE[@]}"; do
    case "$rel" in "$p"|"$p"/*) skip=1; break ;; esac
  done
  [ -n "$skip" ] || HITS+="$rel"$'\n'
done < <(grep -rIlE "$RETIRED" "$SDD" 2>/dev/null)

if [ -z "$HITS" ]; then
  pass "no retired strings in sdd/ (outside PENDING_REWRITE)"
else
  fail "no retired strings in sdd/ (outside PENDING_REWRITE)" "$(echo "$HITS" | tr '\n' ' ')"
fi

# `mark-reviewed` is retired as a command, but review-guard legitimately names it in its
# tamper check, so this string is scanned in the content surface only: sdd/skills,
# sdd/commands, sdd/templates, sdd/README.md and the root README's SDD section. sdd/hooks is
# excluded on purpose.
ROOT_SDD_SECTION="$(awk '/^### SDD/{f=1;print;next} /^###? /{f=0} f' "$REPO_ROOT/README.md")"
if [ -n "$ROOT_SDD_SECTION" ]; then pass "root README has an SDD section"; else fail "root README has an SDD section" "no '### SDD' heading"; fi
MR_HITS="$(grep -rIl 'mark-reviewed' "$SDD/skills" "$SDD/commands" "$SDD/templates" "$SDD/README.md" 2>/dev/null)"
if printf '%s' "$ROOT_SDD_SECTION" | grep -q 'mark-reviewed'; then MR_HITS+=" README.md"; fi
if [ -z "$MR_HITS" ]; then pass "no mark-reviewed in the sdd content surface"; else fail "no mark-reviewed in the sdd content surface" "$MR_HITS"; fi
# Same retired list, applied to the root README's SDD section.
if printf '%s' "$ROOT_SDD_SECTION" | grep -qE "$RETIRED"; then fail "root README SDD section has no retired strings" "$(printf '%s' "$ROOT_SDD_SECTION" | grep -oE "$RETIRED" | sort -u | tr '\n' ' ')"; else pass "root README SDD section has no retired strings"; fi

# Sizes: the skill under 20 KB; every command under 4096 bytes (Codex converts <= 4000 rendered).
SKILL="$SDD/skills/sdd-flow/SKILL.md"
if [ -f "$SKILL" ] && [ "$(wc -c < "$SKILL")" -lt 20480 ]; then pass "sdd-flow SKILL.md < 20480 bytes"; else fail "sdd-flow SKILL.md < 20480 bytes" "missing or too large"; fi
for c in review sdd-init approve; do
  f="$SDD/commands/$c.md"
  if [ -f "$f" ] && [ "$(wc -c < "$f")" -lt 4096 ]; then pass "sdd/commands/$c.md < 4096 bytes"; else fail "sdd/commands/$c.md < 4096 bytes" "missing or too large"; fi
done

# Every superpowers:<name> named in sdd/ is a real superpowers 7.0.2 skill directory.
SP_SKILLS=" brainstorming diagnosing-superpowers dispatching-parallel-agents executing-plans finishing-a-development-branch receiving-code-review requesting-code-review subagent-driven-development systematic-debugging test-driven-development using-git-worktrees using-superpowers verification-before-completion writing-plans writing-skills "
SP_BAD=""
while IFS= read -r name; do
  [ -n "$name" ] || continue
  case "$SP_SKILLS" in *" $name "*) ;; *) SP_BAD+="superpowers:$name " ;; esac
done < <(grep -rhoE 'superpowers:[a-z][a-z-]*[a-z]' "$SDD" 2>/dev/null | sed 's/^superpowers://' | sort -u)
if [ -z "$SP_BAD" ]; then pass "every superpowers:<name> in sdd/ is a superpowers 7.0.2 skill"; else fail "every superpowers:<name> in sdd/ is a superpowers 7.0.2 skill" "$SP_BAD"; fi

# Required content.
needs() { # file, label, fixed-string...
  local file="$1" label="$2"; shift 2
  local miss="" s
  [ -f "$file" ] || { fail "$label" "missing file"; return; }
  for s in "$@"; do grep -qF -- "$s" "$file" || miss+="'$s' "; done
  if [ -z "$miss" ]; then pass "$label"; else fail "$label" "absent: $miss"; fi
}
needs "$SKILL" "sdd-flow names spec-drift and the four approvals" \
  'spec-drift' '/sdd:approve spec' '/sdd:approve plan' '/sdd:approve review' '/sdd:approve done'
needs "$SKILL" "sdd-flow tells the agent never to edit status fields and to ask the user to type /sdd:approve" \
  'never edit status fields' 'ask the user to type `/sdd:approve'
needs "$SDD/commands/sdd-init.md" "sdd-init names .sdd/config.json and constitution" '.sdd/config.json' 'constitution'
needs "$SDD/commands/review.md" "review names report.json, payload.gate and drift_outcome" 'report.json' 'payload.gate' 'drift_outcome'

# Gate 2 order: the spec and the plan are committed while the plan is still a draft, BEFORE the
# user types /sdd:approve plan. Once the plan is approved with no branch: yet, review-guard denies
# a commit on the base branch (see review-guard.test.mjs), so the other order dead-ends.
COMMIT_LINE="$(grep -nF 'Commit the spec and the plan while the plan is still `draft`' "$SKILL" | head -1 | cut -d: -f1)"
APPROVE_LINE="$(grep -nF 'Ask the user to type `/sdd:approve plan' "$SKILL" | head -1 | cut -d: -f1)"
if [ -n "$COMMIT_LINE" ] && [ -n "$APPROVE_LINE" ] && [ "$COMMIT_LINE" -lt "$APPROVE_LINE" ]; then
  pass "sdd-flow commits spec and plan while the plan is draft, before /sdd:approve plan"
else
  fail "sdd-flow commits spec and plan while the plan is draft, before /sdd:approve plan" "commit line='$COMMIT_LINE' approve line='$APPROVE_LINE'"
fi

# Finish order (final review I2): main carries the approval frontmatter uncommitted, and a
# feature branch that touched the plan makes `git merge` refuse ("would be overwritten by
# merge"). So at step 9, after /sdd:approve review and before any merge, the spec and plan
# frontmatter is committed on the base branch; the merge comes after.
FIN_LINE="$(grep -nF '**Finish.**' "$SKILL" | head -1 | cut -d: -f1)"
FM_LINE="$(grep -nF 'before any merge, on the base branch, commit the spec and plan frontmatter' "$SKILL" | head -1 | cut -d: -f1)"
MERGE_LINE="$(grep -nF 'Then merge' "$SKILL" | head -1 | cut -d: -f1)"
if [ -n "$FIN_LINE" ] && [ -n "$FM_LINE" ] && [ -n "$MERGE_LINE" ] && [ "$FIN_LINE" -le "$FM_LINE" ] && [ "$FM_LINE" -le "$MERGE_LINE" ]; then
  pass "sdd-flow step 9 commits the approval frontmatter on the base branch before the merge"
else
  fail "sdd-flow step 9 commits the approval frontmatter on the base branch before the merge" "finish='$FIN_LINE' frontmatter='$FM_LINE' merge='$MERGE_LINE'"
fi
STALE_HITS="$(grep -lF 'committed together with the integration' "$SKILL" "$SDD/skills/sdd-flow/references/gates.md" "$SDD/README.md" "$SDD/templates/CLAUDE.md.template" 2>/dev/null)"
STALE_HITS+="$(grep -lF 'committed with the integration' "$SKILL" "$SDD/skills/sdd-flow/references/gates.md" "$SDD/README.md" "$SDD/templates/CLAUDE.md.template" 2>/dev/null)"
if [ -z "$STALE_HITS" ]; then pass "no 'committed with the integration' wording left"; else fail "no 'committed with the integration' wording left" "$(echo "$STALE_HITS" | tr '\n' ' ')"; fi
for f in "$SDD/skills/sdd-flow/references/gates.md" "$SDD/README.md" "$SDD/templates/CLAUDE.md.template"; do
  needs "$f" "${f#"$REPO_ROOT"/} says to commit the approval frontmatter before the merge" 'before any merge'
done
needs "$SKILL" "sdd-flow says the /sdd:approve done frontmatter is committed" 'Commit the `implemented`/`done` frontmatter'

echo "  ── sdd-content: $PASS_COUNT passed, $FAIL_COUNT failed"
[ "$FAIL_COUNT" -eq 0 ]
