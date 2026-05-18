#!/bin/bash
# PreToolUse hook — deny worktree-ambiguous git mutations from Bash.
#
# Each `Bash` tool call spawns a fresh shell from CC's frozen PWD. A `cd`
# in a prior call evaporates when the next call's shell starts. If the
# repo has multiple worktrees checked out and the agent runs a bare
# `git commit / push / reset --hard / rebase / merge / checkout -b`,
# the mutation lands on whatever branch CC's PWD points at — not the
# worktree the agent thought they were in.
#
# This regressed real work: MRV-poc 2026-05-18, commit 48d1118 intended
# for branch `gcp-native-retrieval` landed on `dev`. Recovery was
# cherry-pick + reset; a `git push` between those steps would have been
# very expensive.
#
# Trigger: tool=Bash AND command contains a destructive git verb AND
#   no `git -C <path>` in the same invocation AND
#   no preceding `cd <path> &&` in the same command line AND
#   the cwd's repo has ≥2 worktrees (single-worktree carve-out).
#
# Decision: deny with a reason naming `git -C` as the required fix.

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
[ "$TOOL_NAME" = "Bash" ] || exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0

CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -z "$CWD" ] && exit 0

# Predicate: destructive git verbs we care about.
# `git checkout -b` creates branches; bare `git checkout <ref>` is read-mostly
# and skipped to avoid false positives on history navigation.
MUTATION_RE='git[[:space:]]+(commit|push|reset[[:space:]]+--hard|rebase|merge|checkout[[:space:]]+-b)\b'
echo "$CMD" | grep -qE "$MUTATION_RE" || exit 0

# Allow: explicit `git -C <path>` in the invocation.
# We only allow when the -C precedes the mutation verb on the same invocation.
echo "$CMD" | grep -qE 'git[[:space:]]+-C[[:space:]]+\S+[[:space:]]+(commit|push|reset|rebase|merge|checkout)\b' && exit 0

# Allow: chained `cd <path> && git ...` in same command — intent explicit.
echo "$CMD" | grep -qE '(^|;|&&|\|\|)[[:space:]]*cd[[:space:]]+\S+[[:space:]]*&&[[:space:]]*git\b' && exit 0

# Skip if cwd is not inside a git repo.
git -C "$CWD" rev-parse --is-inside-work-tree &>/dev/null || exit 0

# Single-worktree carve-out: count linked worktrees including the main.
# `git worktree list --porcelain` emits one `worktree <path>` line per entry.
WT_COUNT=$(git -C "$CWD" worktree list --porcelain 2>/dev/null | grep -c '^worktree ')
[ "$WT_COUNT" -lt 2 ] && exit 0

WT_LIST=$(git -C "$CWD" worktree list 2>/dev/null)

REASON="⛔ Worktree-ambiguous git mutation. BLOCKED.

Command: ${CMD}
CC PWD : ${CWD}
Worktrees (${WT_COUNT}):
${WT_LIST}

Each Bash call starts a fresh shell from CC's PWD — a prior 'cd' does NOT
carry over. Bare 'git commit/push/reset/rebase/merge/checkout -b' lands on
whatever branch CC's PWD points at, not the worktree you think you're in.

This regressed real work (MRV-poc 2026-05-18, commit landed on 'dev'
instead of the worktree branch).

Fix one of:
  • Use explicit path:      git -C /full/worktree/path commit ...
  • Chain cd in same call:  cd /full/worktree/path && git commit ...

The carve-out skips single-worktree repos — this only fires when ambiguity
actually exists."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
