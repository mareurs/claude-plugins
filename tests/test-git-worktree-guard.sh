#!/bin/bash
# tests/test-git-worktree-guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── git-worktree-guard ──"
HOOK="$HOOK_DIR/git-worktree-guard.mjs"

# Helper: build Bash hook input JSON
guard_input() {
  local tool="$1"
  local cwd="$2"
  local cmd="$3"
  printf '{"tool_name":"%s","cwd":"%s","tool_input":{"command":%s}}' \
    "$tool" "$cwd" "$(printf '%s' "$cmd" | jq -Rs .)"
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# --- Setup: main repo with two worktrees ---
MAIN="$TMP/main"
make_git_repo "$MAIN"
make_worktree "$MAIN" "$MAIN/.worktrees/feature"

# --- Setup: solo repo (single worktree) ---
SOLO="$TMP/solo"
make_git_repo "$SOLO"

# === DENIES: multi-worktree, bare mutation, no -C, no chained cd ===

for cmd in \
  "git commit -m 'x'" \
  "git push origin main" \
  "git reset --hard HEAD~1" \
  "git rebase -i HEAD~3" \
  "git merge feature" \
  "git checkout -b new-branch"; do
  OUT=$(guard_input "Bash" "$MAIN" "$cmd" | node "$HOOK" 2>/dev/null)
  if assert_denied "$OUT" && assert_reason_contains "$OUT" "Worktree-ambiguous"; then
    pass "denies: $cmd"
  else
    fail "denies: $cmd" "$OUT"
  fi
done

# === ALLOWS: explicit -C flag ===

for cmd in \
  "git -C $MAIN/.worktrees/feature commit -m 'x'" \
  "git -C $MAIN/.worktrees/feature push" \
  "git -C $MAIN/.worktrees/feature reset --hard HEAD~1"; do
  OUT=$(guard_input "Bash" "$MAIN" "$cmd" | node "$HOOK" 2>/dev/null)
  if ! assert_denied "$OUT"; then
    pass "allows: $cmd"
  else
    fail "allows: $cmd" "$OUT"
  fi
done

# === ALLOWS: chained `cd <path> && git ...` (intent explicit) ===

for cmd in \
  "cd $MAIN/.worktrees/feature && git commit -m 'x'" \
  "cd $MAIN/.worktrees/feature && git push"; do
  OUT=$(guard_input "Bash" "$MAIN" "$cmd" | node "$HOOK" 2>/dev/null)
  if ! assert_denied "$OUT"; then
    pass "allows chained cd: ${cmd:0:60}..."
  else
    fail "allows chained cd: $cmd" "$OUT"
  fi
done

# === ALLOWS: single-worktree repo (no ambiguity) ===

for cmd in \
  "git commit -m 'x'" \
  "git push" \
  "git reset --hard HEAD~1"; do
  OUT=$(guard_input "Bash" "$SOLO" "$cmd" | node "$HOOK" 2>/dev/null)
  if ! assert_denied "$OUT"; then
    pass "allows in single-worktree repo: $cmd"
  else
    fail "allows in single-worktree repo: $cmd" "$OUT"
  fi
done

# === ALLOWS: non-mutation git commands (status, log, diff, branch) ===

for cmd in \
  "git status" \
  "git log --oneline -3" \
  "git diff HEAD" \
  "git branch --show-current" \
  "git worktree list" \
  "git fetch"; do
  OUT=$(guard_input "Bash" "$MAIN" "$cmd" | node "$HOOK" 2>/dev/null)
  if ! assert_denied "$OUT"; then
    pass "allows read-only: $cmd"
  else
    fail "allows read-only: $cmd" "$OUT"
  fi
done

# === ALLOWS: non-Bash tools (skip entirely) ===

OUT=$(guard_input "Read" "$MAIN" "git commit -m 'x'" | node "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then
  pass "skips non-Bash tool"
else
  fail "skips non-Bash tool" "$OUT"
fi

# === ALLOWS: cwd outside a git repo ===

OUT=$(guard_input "Bash" "/tmp" "git commit -m 'x'" | node "$HOOK" 2>/dev/null)
if ! assert_denied "$OUT"; then
  pass "allows when cwd is not a git repo"
else
  fail "allows when cwd is not a git repo" "$OUT"
fi

# === EMPTY input: silent exit ===

OUT=$(printf '' | node "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then
  pass "empty input: silent exit"
else
  fail "empty input: silent exit" "$OUT"
fi

# === REGRESSION: MRV-poc exact failure mode ===
# Subagent in main repo PWD (after "plugin reload reset shell") issues bare git commit.
# Main repo has the worktree branch checked out elsewhere. Must deny.

OUT=$(guard_input "Bash" "$MAIN" "git commit -m 'feat: scaffold mrv.gcp subpackage'" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "git -C"; then
  pass "regression: MRV-poc commit-on-wrong-branch denied"
else
  fail "regression: MRV-poc commit-on-wrong-branch denied" "$OUT"
fi

print_summary "git-worktree-guard"
