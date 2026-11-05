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
# One path per line: the task that rewrites a file deletes exactly that line.
#   Task 5-9 rewrite the hooks; Task 10 rewrites the skill, commands and README.
PENDING_REWRITE=(
  sdd/skills/sdd-flow
  sdd/commands/review.md
  sdd/commands/sdd-init.md
  sdd/README.md
  sdd/hooks/review-guard.mjs
  sdd/hooks/session-start.mjs
  sdd/hooks/subagent-inject.mjs
  sdd/hooks/hooks.json
)

# Task 10, Step 1 flips this to 1: the list must then be empty, and every file is scanned.
ENFORCE_PENDING_REWRITE_EMPTY=0

if [ "$ENFORCE_PENDING_REWRITE_EMPTY" = "1" ]; then
  if [ "${#PENDING_REWRITE[@]}" -eq 0 ]; then
    pass "PENDING_REWRITE is empty"
  else
    fail "PENDING_REWRITE is empty" "still lists: ${PENDING_REWRITE[*]}"
  fi
fi

# Retired strings, as grep -E alternation.
RETIRED='memory/specs|Serena|serena|read_markdown|edit_markdown|superpowers:code-reviewer|ralph-sdd|COMPONENT_REGISTRY'

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

echo "  ── sdd-content: $PASS_COUNT passed, $FAIL_COUNT failed"
[ "$FAIL_COUNT" -eq 0 ]
