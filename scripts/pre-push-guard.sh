#!/usr/bin/env bash
# scripts/pre-push-guard.sh — git pre-push hook. Two independent guards.
#
# GUARD 1 — force-push protection.
# Refuses a non-fast-forward (force) push of a protected branch (default:
# main) unless ALLOW_FORCE_PUSH_MAIN=1 is set. This is the guard that would
# have caught the 2026-07-08 incident: a force-push to main silently dropped
# 3 already-merged commits because a concurrent long-running branch was based
# on an older snapshot of main. A plain (non-force) push is already refused
# by git itself when it isn't a fast-forward — this hook targets the
# remaining gap: an explicit --force (or --force-with-lease) push of a
# shared branch, which git allows by default with no extra confirmation.
#
# GUARD 2 — version-bump parity (added 2026-08-28).
# When the pushed range touches a <plugin>/.claude-plugin/plugin.json, requires
# scripts/check-profile-parity.sh to pass for that plugin. Closes the gap that
# let 1.19.5 be bumped inline in a feature commit: nothing outside release.sh
# checks profile state, so ~/.claude-kat sat stranded at 1.19.4 with no cache dir
# for nine hours with every automated gate green. Override: SKIP_PARITY_CHECK=1.
# Fires only on a version change, so ordinary pushes are never gated on local
# profile state, and it is a no-op during a real release (release.sh has already
# repaired and verified parity at its step 6.5, before it pushes at step 7).
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
REPO_ROOT="$(git rev-parse --show-toplevel)"
ZERO=0000000000000000000000000000000000000000

# Plugin dirs whose plugin.json changed in the range "$1..$2" ($1 may be $ZERO
# for a branch the remote does not have yet). Empty output = no version source
# touched. Never fails the caller: a grep with no match is a normal answer here,
# and under `set -e` an unguarded pipeline would abort the push instead.
bumped_plugins() {
  local from="$1" to="$2" changed
  if [ "$from" = "$ZERO" ]; then
    changed=$(git log --format= --name-only "$to" --not --remotes=origin 2>/dev/null || true)
  else
    changed=$(git diff --name-only "$from" "$to" 2>/dev/null || true)
  fi
  printf '%s\n' "$changed" \
    | grep -E '^[^/]+/\.claude-plugin/plugin\.json$' 2>/dev/null \
    | cut -d/ -f1 | sort -u || true
}


while read -r local_ref local_sha remote_ref remote_sha; do
  # Branch deletion (local_sha is all zeros) — nothing to protect against.
  [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue

  branch="${remote_ref#refs/heads/}"
  is_protected=0
  for p in $PROTECTED; do
    [ "$branch" = "$p" ] && is_protected=1 && break
  done
  [ "$is_protected" = 1 ] || continue

  # --- Version-bump parity ------------------------------------------------
  # A version bumped inline in a feature commit gets the NUMBER without any of
  # the machinery the number promises: check-versions.sh compares plugin.json to
  # the README and never reads an install record, and check-profile-parity.sh
  # runs only INSIDE release.sh. Nothing else looks. That is how 1.19.5 left
  # ~/.claude-kat stranded at 1.19.4 with no cache dir for nine hours while every
  # automated gate stayed green (version-bump-checklist, 2026-08-28 entry).
  #
  # Deliberately scoped two ways. It fires ONLY when the pushed range touches a
  # plugin.json, so ordinary work is never gated on local profile state; and it
  # runs here rather than in tests/run-all.sh, which release.sh executes at step 0
  # — BEFORE it seeds caches and repoints records. Gating there would abort the
  # release on exactly the drift that the release repairs. By push time (step 7) a
  # real release has already passed its own parity check at step 6.5, so this is a
  # no-op for release.sh and a hard stop for an inline bump.
  #
  # A machine with no profiles is not a failure: check-profile-parity.sh reports
  # "not installed in any profile (nothing to keep in parity)" and exits 0, so the
  # Windows box and any fresh clone pass without special-casing here.
  if [ "${SKIP_PARITY_CHECK:-0}" != "1" ]; then
    for plugin in $(bumped_plugins "$remote_sha" "$local_sha"); do
      if ! "$REPO_ROOT/scripts/check-profile-parity.sh" "$plugin" >/dev/null 2>&1; then
        echo "" >&2
        "$REPO_ROOT/scripts/check-profile-parity.sh" "$plugin" >&2 || true
        cat >&2 <<EOF

✗ pre-push-guard: '$plugin' version changed in this push, but the three Claude
  Code profiles disagree about it.

  A version bump is only half a release. The other half — seeding the versioned
  cache and repointing every install record — is what makes the number true, and
  it is skipped when the bump rides along in an ordinary commit.

  Fix by running the real thing (it is idempotent about the profile half):
    ./scripts/release.sh $plugin <version>

  Or repair the profiles by hand, then re-check:
    ./scripts/check-profile-parity.sh $plugin

  Override for this push (records drift you have chosen to accept):
    SKIP_PARITY_CHECK=1 git push ...
EOF
        exit 1
      fi
    done
  fi

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
