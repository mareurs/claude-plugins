#!/usr/bin/env bash
# Test: scripts/lib-copy-plugin.sh — copy_plugin_tree
#
# This helper seeds every profile's plugin cache. Until 2026-08-27 nothing
# tested it, and it carried two defects that a cache-vs-worktree diff surfaced:
#
#  1. `.buddy/` was gitignored in BOTH buddy/.gitignore and the root .gitignore,
#     and still copied into all three profiles on every seed. The helper mirrors
#     the FILESYSTEM, not git — only its own exclude list keeps a file out. The
#     leaked file was `.buddy/.session-start-trace.log`, the artifact CLAUDE.md
#     tells you to probe to learn which path a plugin loads from, so a stale copy
#     inside the cache actively misleads that diagnostic.
#
#  2. Adding the exclusion did not evict the copies already there. rsync PROTECTS
#     excluded paths from `--delete`, so an exclusion only stops NEW arrivals —
#     re-seeding all three profiles left every stale `.buddy/` in place. Fixed
#     with `--delete-excluded`, which also aligns the rsync branch with the
#     fallback branch; the two had silently disagreed.
#
# Both branches are exercised: the rsync path when rsync is present, and the
# cp+find fallback by shadowing `command` so its `command -v rsync` probe fails.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="$HERE/../scripts/lib-copy-plugin.sh"
PASS=0
FAIL=0

ok()  { echo "PASS [$1]"; PASS=$((PASS+1)); }
bad() { echo "FAIL [$1]: $2"; FAIL=$((FAIL+1)); }

absent() {  # <label> <path>
  if [[ -e "$2" ]]; then bad "$1" "still present: $2"; else ok "$1"; fi
}
present() { # <label> <path>
  if [[ -e "$2" ]]; then ok "$1"; else bad "$1" "missing: $2"; fi
}

SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT

build_src() {  # <src>
  local s="$1"
  mkdir -p "$s/hooks" "$s/.buddy" "$s/__pycache__" "$s/skills"
  echo 'real content'      > "$s/hooks/real.mjs"
  echo 'skill'             > "$s/skills/SKILL.md"
  echo 'trace from a live session' > "$s/.buddy/.session-start-trace.log"
  echo 'marker'            > "$s/.orphaned_at"
  echo 'compiled'          > "$s/__pycache__/x.pyc"
}

# Pre-pollute dest with artifacts that must be EVICTED, not merely not-copied.
# This is the half a plain --delete silently failed: the excluded paths were
# protected from deletion, so re-seeding never cleaned them up.
pollute_dest() {  # <dest>
  local d="$1"
  mkdir -p "$d/.buddy" "$d/__pycache__"
  echo 'STALE trace from another session' > "$d/.buddy/.session-start-trace.log"
  echo 'STALE'  > "$d/.orphaned_at"
  echo 'STALE'  > "$d/__pycache__/old.pyc"
  echo 'STALE'  > "$d/removed-since.mjs"   # plain file no longer in src
  echo 'STALE'  > "$d/.stale-dotfile"      # dotfile no longer in src
}

run_case() {  # <branch-label> <use_fallback:yes|no>
  local label="$1" fallback="$2"
  local src="$SANDBOX/$label/src" dest="$SANDBOX/$label/dest"
  mkdir -p "$src" "$dest"
  build_src "$src"
  pollute_dest "$dest"

  (
    # shellcheck disable=SC1090
    source "$LIB"
    if [[ "$fallback" == "yes" ]]; then
      # Shadow the `command` builtin so the helper's `command -v rsync` probe
      # fails, forcing the cp+find branch even on a machine that has rsync.
      command() {
        if [[ "${1:-}" == "-v" && "${2:-}" == "rsync" ]]; then return 1; fi
        builtin command "$@"
      }
    fi
    copy_plugin_tree "$src" "$dest"
  )

  echo "--- branch: $label"
  present "$label: real content copied"          "$dest/hooks/real.mjs"
  present "$label: nested content copied"        "$dest/skills/SKILL.md"
  absent  "$label: .buddy/ not copied"           "$dest/.buddy"
  absent  "$label: .orphaned_at not copied"      "$dest/.orphaned_at"
  absent  "$label: __pycache__ not copied"       "$dest/__pycache__"
  absent  "$label: stale plain file deleted"     "$dest/removed-since.mjs"
  absent  "$label: stale DOTfile deleted"        "$dest/.stale-dotfile"
}

if command -v rsync >/dev/null 2>&1; then
  run_case "rsync" "no"
else
  echo "SKIP [rsync branch]: rsync not installed on this machine"
fi
run_case "fallback" "yes"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
