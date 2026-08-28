#!/usr/bin/env bash
# scripts/check-hooks-installed.sh — is this clone's pre-push guard active?
#
# scripts/install-hooks.sh is opt-in per clone, because git hooks live in
# .git/hooks/ and are never cloned or synced. So the two pre-push guards —
# force-push protection and version-bump parity — can be silently absent, and
# their absence reads exactly like "nothing to report". That is the failure this
# repo keeps re-learning (a stale memory, a volatile anchor, a suite reading
# ambient config, an install-time hook copy), so it gets said out loud instead.
#
# ALWAYS exits 0. This is a notice, not a gate: a local convenience hook must
# never block someone's test run, and a fresh clone or a CI checkout is not
# broken for lacking it. Callers that want a hard gate should check the output.
#
# Usage:
#   ./scripts/check-hooks-installed.sh          # warn if missing; silent if fine
#   ./scripts/check-hooks-installed.sh --quiet  # exit code only (0 ok, 0 always)

set -uo pipefail

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

say() { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }

# Not a git checkout (tarball, vendored copy) — nothing to install into.
HOOKS_DIR="$(git rev-parse --git-path hooks 2>/dev/null)" || exit 0
[ -n "$HOOKS_DIR" ] || exit 0

HOOK="$HOOKS_DIR/pre-push"

if [ ! -e "$HOOK" ]; then
  say "⚠ git hooks are NOT installed in this clone — the pre-push guards are inactive:"
  say "    · force-push protection on main"
  say "    · version-bump parity (a bump that skips release.sh reaches main unnoticed)"
  say "  Install (one-time, per clone):  ./scripts/install-hooks.sh"
  say ""
  exit 0
fi

if ! grep -q 'pre-push-guard\.sh' "$HOOK" 2>/dev/null; then
  say "⚠ $HOOK exists but is not this repo's guard —"
  say "  force-push protection and version-bump parity are NOT active."
  say "  Reinstall (overwrites the existing hook):  ./scripts/install-hooks.sh"
  say ""
  exit 0
fi

exit 0
