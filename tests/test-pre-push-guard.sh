#!/bin/bash
# tests/test-pre-push-guard.sh
#
# Covers BOTH guards in scripts/pre-push-guard.sh:
#   1. force-push protection (pre-existing, regression-guarded here for the
#      first time)
#   2. version-bump parity (added 2026-08-28) — the gap that let 1.19.5 be
#      bumped inline in a feature commit and leave ~/.claude-kat stranded at
#      1.19.4 for nine hours with every automated gate green.
#
# The hook reads "<local ref> <local sha> <remote ref> <remote sha>" on stdin,
# so it is driven directly rather than through a real `git push`.
#
# Profile state is faked via HOME, because check-profile-parity.sh resolves its
# three profiles from $HOME. That keeps the suite off the developer's real
# ~/.claude* dirs — the same hermeticity lesson as guard-hardening-session-log:F-3,
# where a suite reading live ambient config went red for everyone who used a
# documented opt-out.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-push-guard ──"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$REPO_ROOT/scripts/pre-push-guard.sh"
ZERO=0000000000000000000000000000000000000000

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# A real commit pair in this repo: one that touches a plugin.json and one that
# does not. Discovered, never hardcoded — a pinned sha rots and the test would
# then pass for the wrong reason.
BUMP_SHA=$(git -C "$REPO_ROOT" log -1 --format=%H -- '*/.claude-plugin/plugin.json')
BUMP_PARENT=$(git -C "$REPO_ROOT" rev-parse "${BUMP_SHA}^")
# A range with no plugin.json in it: the bump commit to itself is empty.
NOBUMP_SHA=$(git -C "$REPO_ROOT" log -1 --format=%H -- tests/)
NOBUMP_PARENT=$(git -C "$REPO_ROOT" rev-parse "${NOBUMP_SHA}^")

if [ -z "$BUMP_SHA" ] || [ -z "$NOBUMP_SHA" ]; then
  fail "fixture discovery" "could not find bump/no-bump commits"
  print_summary; exit 1
fi

# Build a fake HOME with three profiles. `state` picks whether the record for
# codescout-companion matches the repo's canonical version.
make_profiles() {  # <home> <recorded-version>
  local home="$1" ver="$2" canon
  canon=$(jq -r .version "$REPO_ROOT/codescout-companion/.claude-plugin/plugin.json")
  for p in .claude .claude-sdd .claude-kat; do
    mkdir -p "$home/$p/plugins/cache/sdd-misc-plugins/codescout-companion/$ver"
    mkdir -p "$home/$p/plugins"
    cat > "$home/$p/plugins/installed_plugins.json" <<JSON
{"plugins":{"codescout-companion@sdd-misc-plugins":[{"scope":"user","version":"$ver",
"installPath":"$home/$p/plugins/cache/sdd-misc-plugins/codescout-companion/$ver"}]}}
JSON
    cat > "$home/$p/plugins/known_marketplaces.json" <<JSON
{"sdd-misc-plugins":{"source":{"source":"directory","path":"$REPO_ROOT"},
"installLocation":"$REPO_ROOT"}}
JSON
  done
  echo "$canon"
}

run_hook() {  # <home> <from-sha> <to-sha> [env assignments...]
  local home="$1" from="$2" to="$3"; shift 3
  printf 'refs/heads/main %s refs/heads/main %s\n' "$to" "$from" \
    | env HOME="$home" "$@" bash "$HOOK" origin git@example.com:x/y.git 2>&1
}

check() {  # <label> <expected: allow|deny> <output> <exit-code>
  local label="$1" expected="$2" out="$3" ec="$4" got
  [ "$ec" -eq 0 ] && got=allow || got=deny
  if [ "$got" = "$expected" ]; then
    pass "$label"
  else
    fail "$label" "expected=$expected got=$got ec=$ec :: $(echo "$out" | tail -3 | tr '\n' ' ')"
  fi
}

# --- Guard 2: version-bump parity -------------------------------------------

# POSITIVE CONTROL FIRST. If a drifted profile set does not produce a deny, then
# every "allow" below is uninformative — it would read the same in a world where
# the parity check never runs at all.
CANON=$(make_profiles "$T/drift" "0.0.1-stale")
OUT=$(run_hook "$T/drift" "$BUMP_PARENT" "$BUMP_SHA"); EC=$?
check "parity: drifted profiles + version bump → deny" deny "$OUT" $EC

if echo "$OUT" | grep -q "release.sh"; then
  pass "parity: deny message names the repair"
else
  fail "parity: deny message names the repair" "$(echo "$OUT" | tail -2)"
fi

# Same drifted profiles, but the pushed range touches no plugin.json. Ordinary
# work must never be gated on local profile state.
OUT=$(run_hook "$T/drift" "$NOBUMP_PARENT" "$NOBUMP_SHA"); EC=$?
check "parity: drifted profiles + NO version bump → allow" allow "$OUT" $EC

# Profiles that agree with the repo's canonical version.
make_profiles "$T/clean" "$CANON" >/dev/null
OUT=$(run_hook "$T/clean" "$BUMP_PARENT" "$BUMP_SHA"); EC=$?
check "parity: in-parity profiles + version bump → allow" allow "$OUT" $EC

# A machine with no profiles at all (the Windows box; any fresh clone).
mkdir -p "$T/empty"
OUT=$(run_hook "$T/empty" "$BUMP_PARENT" "$BUMP_SHA"); EC=$?
check "parity: no profiles installed → allow" allow "$OUT" $EC

# Escape hatch.
OUT=$(run_hook "$T/drift" "$BUMP_PARENT" "$BUMP_SHA" SKIP_PARITY_CHECK=1); EC=$?
check "parity: SKIP_PARITY_CHECK=1 → allow" allow "$OUT" $EC

# Non-protected branch: parity is main's concern.
OUT=$(printf 'refs/heads/wip %s refs/heads/wip %s\n' "$BUMP_SHA" "$BUMP_PARENT" \
      | env HOME="$T/drift" bash "$HOOK" origin git@example.com:x/y.git 2>&1); EC=$?
check "parity: non-protected branch → allow" allow "$OUT" $EC

# --- Guard 1: force-push protection (regression) -----------------------------

# Two commits with no ancestry between them force the non-fast-forward path.
UNRELATED=$(git -C "$REPO_ROOT" rev-list --max-parents=0 HEAD | tail -1)
OUT=$(run_hook "$T/clean" "$BUMP_SHA" "$UNRELATED"); EC=$?
check "force-push: non-fast-forward to main → deny" deny "$OUT" $EC

OUT=$(run_hook "$T/clean" "$BUMP_SHA" "$UNRELATED" ALLOW_FORCE_PUSH_MAIN=1); EC=$?
check "force-push: ALLOW_FORCE_PUSH_MAIN=1 → allow" allow "$OUT" $EC

# Branch deletion is not a force-push.
OUT=$(printf 'refs/heads/main %s refs/heads/main %s\n' "$ZERO" "$BUMP_SHA" \
      | env HOME="$T/clean" bash "$HOOK" origin git@example.com:x/y.git 2>&1); EC=$?
check "force-push: branch deletion → allow" allow "$OUT" $EC

print_summary
