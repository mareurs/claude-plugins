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

# === ALLOWS: hyphenated read-only plumbing that shares a prefix with a
#     destructive verb. Pinned because \b matches between a word character and
#     a hyphen, so `merge\b` caught `merge-base` and `commit\b` caught
#     `commit-tree` — six read-only commands refused as destructive mutations.
#     The anchor is (\s|$); if it regresses to \b, every case here flips. ===

for cmd in \
  "git merge-base main feature" \
  "git merge-file a b c" \
  "git merge-tree main feature" \
  "git merge-index cat-file -p" \
  "git commit-tree HEAD^{tree}" \
  "git commit-graph write"; do
  OUT=$(guard_input "Bash" "$MAIN" "$cmd" | node "$HOOK" 2>/dev/null)
  if ! assert_denied "$OUT"; then
    pass "allows read-only plumbing: $cmd"
  else
    fail "allows read-only plumbing: $cmd" "$OUT"
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

# === SEGMENTATION: a heredoc body is DATA, not command text ===
# docs/issues/archive/2026-09-01-worktree-guard-scans-the-whole-command-so-a-heredoc-blocks-and-a-mention-disarms.md
# Half (a): the guard used to scan the whole command string, so writing a test
# fixture that CONTAINS `git commit` was unwritable through Bash.

HEREDOC_CMD="cat > $TMP/fixture.sh <<'OUTER'
git commit -qm base
git add -A
git reset --hard HEAD~1
OUTER"
OUT=$(guard_input "Bash" "$MAIN" "$HEREDOC_CMD" | node "$HOOK" 2>/dev/null)
if ! assert_denied "$OUT"; then
  pass "allows: git verbs inside a heredoc body (data, not command)"
else
  fail "allows: git verbs inside a heredoc body" "$OUT"
fi

# Unquoted and tab-indented (<<-) delimiters strip too.
HEREDOC_CMD2="cat > $TMP/f2.sh <<-EOF
	git push origin main
	EOF"
OUT=$(guard_input "Bash" "$MAIN" "$HEREDOC_CMD2" | node "$HOOK" 2>/dev/null)
if ! assert_denied "$OUT"; then
  pass "allows: git verbs inside a <<- heredoc body"
else
  fail "allows: git verbs inside a <<- heredoc body" "$OUT"
fi

# A heredoc must not become a blanket escape: a REAL bare mutation after the
# body still blocks.
HEREDOC_THEN_COMMIT="cat > $TMP/f3.sh <<'EOF'
git commit -qm data
EOF
git commit -m real"
OUT=$(guard_input "Bash" "$MAIN" "$HEREDOC_THEN_COMMIT" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then
  pass "denies: bare mutation following a heredoc body"
else
  fail "denies: bare mutation following a heredoc body" "$OUT"
fi

# === SEGMENTATION: the escape must not travel between commands ===
# Half (b)/(c) — the serious half. The guard's own documented workaround used to
# disarm it for everything else in the same call, and a quoted MENTION sufficed.

OUT=$(guard_input "Bash" "$MAIN" "git -C $MAIN/.worktrees/feature commit -m a && git commit -m b" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then
  pass "denies: bare commit chained after an explicit -C commit"
else
  fail "denies: bare commit chained after an explicit -C commit" "$OUT"
fi

OUT=$(guard_input "Bash" "$MAIN" "echo 'see git -C x commit' ; git commit -m b" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then
  pass "denies: a quoted mention of the -C escape does not disarm the guard"
else
  fail "denies: a quoted mention of the -C escape does not disarm the guard" "$OUT"
fi

OUT=$(guard_input "Bash" "$MAIN" "echo 'cd /somewhere && git commit' ; git commit -m b" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then
  pass "denies: a quoted mention of the cd escape does not disarm the guard"
else
  fail "denies: a quoted mention of the cd escape does not disarm the guard" "$OUT"
fi

# A cd persists for the rest of the invocation, so LATER verbs stay exempt —
# an adjacency-only rule would have regressed this.
OUT=$(guard_input "Bash" "$MAIN" "cd $MAIN/.worktrees/feature && git commit -m a && git push" | node "$HOOK" 2>/dev/null)
if ! assert_denied "$OUT"; then
  pass "allows: every verb after a chained cd, not just the adjacent one"
else
  fail "allows: every verb after a chained cd, not just the adjacent one" "$OUT"
fi

# ...but a verb BEFORE the cd really did run in the ambiguous cwd.
OUT=$(guard_input "Bash" "$MAIN" "git commit -m a && cd $MAIN/.worktrees/feature" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then
  pass "denies: a mutation preceding the cd it appears to be paired with"
else
  fail "denies: a mutation preceding the cd it appears to be paired with" "$OUT"
fi

# === SEGMENTATION: a QUOTED span is DATA, not command text ===
# docs/issues/2026-09-16-worktree-guard-reads-a-quoted-regex-alternation-as-a-bare-git-verb.md
# The mirror of the quoted-mention cases above, and the direction they left
# uncovered: those assert a mention must not DISARM the guard; these assert it
# must not TRIGGER it. `segments()` split on `|` quote-naively, so a regex
# alternation inside a quoted argument broke the command mid-token and the left
# fragment ended in a git verb — satisfying TRIGGER's `(\s|$)` through `$`. The
# split did not merely narrow the segment, it MANUFACTURED the boundary the
# match needs. A read-only grep was refused as a destructive mutation, and
# neither escape in the refusal applies, because the command is not a git
# command at all.

ALT_DQ='grep -rn -E "git push|peter-evans" .github/workflows/'
OUT=$(guard_input "Bash" "$MAIN" "$ALT_DQ" | node "$HOOK" 2>/dev/null)
if ! assert_denied "$OUT"; then
  pass "allows: a git verb inside a double-quoted regex alternation"
else
  fail "allows: a git verb inside a double-quoted regex alternation" "$OUT"
fi

ALT_SQ="grep -rn -E 'git commit|create-pull-request' docs/"
OUT=$(guard_input "Bash" "$MAIN" "$ALT_SQ" | node "$HOOK" 2>/dev/null)
if ! assert_denied "$OUT"; then
  pass "allows: a git verb inside a single-quoted regex alternation"
else
  fail "allows: a git verb inside a single-quoted regex alternation" "$OUT"
fi

# The control, and the reason this fix cannot be "ignore anything quoted":
# stripping quoted spans must not become a blanket escape. A REAL bare mutation
# outside the quotes still blocks. Without this, the fix above would trade a
# false refusal for a missed mutation — the direction that actually matters.
ALT_THEN_COMMIT='grep -E "git push|x" . ; git commit -m real'
OUT=$(guard_input "Bash" "$MAIN" "$ALT_THEN_COMMIT" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then
  pass "denies: bare mutation following a quoted alternation"
else
  fail "denies: bare mutation following a quoted alternation" "$OUT"
fi

# An UNTERMINATED quote must not swallow the rest of the command. If a lone `"`
# blanked everything after it, a real mutation would ride through unexamined —
# so the odd delimiter is left as ordinary text and the verb is still caught.
UNTERMINATED='echo "unclosed ; git commit -m real'
OUT=$(guard_input "Bash" "$MAIN" "$UNTERMINATED" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then
  pass "denies: bare mutation after an unterminated quote"
else
  fail "denies: bare mutation after an unterminated quote" "$OUT"
fi

# A consequence of the fix above, pinned because it is a real behaviour change
# and an unpinned one is indistinguishable from an accident. The source used to
# note `cd "/path with space"` was unrecognised — "parity, not an improvement".
# Replacing a quoted span with a single inert TOKEN (rather than deleting it)
# keeps the path one `\S+` word, so CD_TO_PATH now matches and the gap closes.
# If a future change deletes spans instead of tokenising them, this test reds.
#
# The path MUST contain a space and that is the whole point of the fixture: an
# unspaced quoted path already satisfies `\S+` quotes-and-all, so this case
# passed before the fix and proved nothing. CD_TO_PATH never stats the path, so
# a non-existent directory exercises the regex exactly as a real one would.
CD_QUOTED="cd '/tmp/some dir/with space' && git commit -m x"
OUT=$(guard_input "Bash" "$MAIN" "$CD_QUOTED" | node "$HOOK" 2>/dev/null)
if ! assert_denied "$OUT"; then
  pass "allows: chained cd whose quoted path contains a space"
else
  fail "allows: chained cd whose quoted path contains a space" "$OUT"
fi

print_summary "git-worktree-guard"
