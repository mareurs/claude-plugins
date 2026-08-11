#!/usr/bin/env bash
# scripts/pre-push-guard.sh — git pre-push hook.
#
# Refuses a non-fast-forward (force) push of a protected branch (default:
# main) unless ALLOW_FORCE_PUSH_MAIN=1 is set. This is the guard that would
# have caught the 2026-07-08 incident: a force-push to main silently dropped
# 3 already-merged commits because a concurrent long-running branch was based
# on an older snapshot of main. A plain (non-force) push is already refused
# by git itself when it isn't a fast-forward — this hook targets the
# remaining gap: an explicit --force (or --force-with-lease) push of a
# shared branch, which git allows by default with no extra confirmation.
#
# Install (one-time, per clone — hooks are local, not synced by git):
#   ./scripts/install-hooks.sh
#
# Protected branches: PROTECTED_BRANCHES env var, space-separated
# (default: "main").
#
# Git calls this with the remote name/URL as args and feeds
# "<local ref> <local sha1> <remote ref> <remote sha1>" lines on stdin —
# see githooks(5) § pre-push.

set -euo pipefail

PROTECTED="${PROTECTED_BRANCHES:-main}"

while read -r local_ref local_sha remote_ref remote_sha; do
  # Branch deletion (local_sha is all zeros) — nothing to protect against.
  [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue

  branch="${remote_ref#refs/heads/}"
  is_protected=0
  for p in $PROTECTED; do
    [ "$branch" = "$p" ] && is_protected=1 && break
  done
  [ "$is_protected" = 1 ] || continue

  # New branch on remote (remote_sha all zeros) — nothing to force over.
  [ "$remote_sha" = "0000000000000000000000000000000000000000" ] && continue

  # Fast-forward: remote tip is an ancestor of what we're pushing — safe.
  if git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
    continue
  fi

  # Non-fast-forward push of a protected branch.
  if [ "${ALLOW_FORCE_PUSH_MAIN:-0}" = "1" ]; then
    echo "⚠ pre-push-guard: ALLOW_FORCE_PUSH_MAIN=1 set — allowing force-push of '$branch'" >&2
    continue
  fi

  cat >&2 <<EOF
✗ pre-push-guard: refusing a non-fast-forward push to protected branch '$branch'.

  remote tip $remote_sha is NOT an ancestor of what you're about to push
  ($local_sha). This is exactly the shape of the 2026-07-08 incident: a
  force-push here can silently discard commits someone else already merged.

  Before overriding, fetch and check what you'd be dropping:
    git fetch origin $branch
    git log --oneline $remote_sha..origin/$branch      # commits you'd lose

  If you are certain this force-push is intentional:
    ALLOW_FORCE_PUSH_MAIN=1 git push ...
EOF
  exit 1
done

exit 0
