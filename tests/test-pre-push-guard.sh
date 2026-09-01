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

# Which plugins does the guard actually check for this range? Derived with the
# SAME expression scripts/pre-push-guard.sh::bumped_plugins uses, because the
# fixture must drift the plugin the guard will look at. Hardcoding one plugin
# here is what made the positive control below unable to fire: on 2026-09-01 the
# discovered commit bumped `buddy` while the fixture drifted
# `codescout-companion`, so check-profile-parity.sh took its deliberate
# not-installed branch, exited 0, and the deny assertion became unreachable —
# green to red on nothing but which plugin was released last, and it would have
# gone green again on the next codescout-companion bump with nothing fixed.
# docs/issues/2026-09-01-pre-push-guard-test-drifts-a-different-plugin-than-the-guard-checks.md
BUMP_PLUGINS=$(git -C "$REPO_ROOT" diff --name-only "$BUMP_PARENT" "$BUMP_SHA" \
  | grep -E '^[^/]+/\.claude-plugin/plugin\.json$' | cut -d/ -f1 | sort -u)

if [ -z "$BUMP_PLUGINS" ]; then
  fail "fixture discovery" "range ${BUMP_PARENT:0:8}..${BUMP_SHA:0:8} touches no <plugin>/.claude-plugin/plugin.json"
  print_summary; exit 1
fi

# Build a fake HOME with three profiles. `mode` picks whether the records match
# each plugin's canonical version (`canonical`) or lag it (`stale`).
make_profiles() {  # <home> <stale|canonical>
  local home="$1" mode="$2" plugin ver entries
  for p in .claude .claude-sdd .claude-kat; do
    mkdir -p "$home/$p/plugins"
    entries=""
    # A record for EVERY plugin the guard will check for this range — see
    # BUMP_PLUGINS above. Writing one hardcoded plugin here is the defect that
    # made the positive control unreachable.
    for plugin in $BUMP_PLUGINS; do
      if [ "$mode" = stale ]; then
        ver="0.0.1-stale"
      else
        ver=$(jq -r .version "$REPO_ROOT/$plugin/.claude-plugin/plugin.json")
      fi
      mkdir -p "$home/$p/plugins/cache/sdd-misc-plugins/$plugin/$ver"
      entries="$entries${entries:+,}\"$plugin@sdd-misc-plugins\":[{\"scope\":\"user\",\"version\":\"$ver\",\"installPath\":\"$home/$p/plugins/cache/sdd-misc-plugins/$plugin/$ver\"}]"
    done
    printf '{"plugins":{%s}}\n' "$entries" > "$home/$p/plugins/installed_plugins.json"
    cat > "$home/$p/plugins/known_marketplaces.json" <<JSON
{"sdd-misc-plugins":{"source":{"source":"directory","path":"$REPO_ROOT"},
"installLocation":"$REPO_ROOT"}}
JSON
  done
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
make_profiles "$T/drift" stale

# FIXTURE WRITE-THROUGH. Confirms make_profiles actually wrote a record for every
# plugin in BUMP_PLUGINS. Note honestly what this does NOT prove: both sides derive
# from BUMP_PLUGINS, so it is a check on the fixture writer (empty entries, broken
# printf/jq shape), not an independent tie to the guard. The real tie is below, and
# it reads the guard's own output — a check computed from the thing it judges cannot
# fail, which is the defect class this whole file is now guarding against.
fixture_plugins=$(jq -r '.plugins | keys[]' "$T/drift/.claude/plugins/installed_plugins.json" \
  | sed 's/@sdd-misc-plugins$//' | sort -u)
if [ "$fixture_plugins" = "$BUMP_PLUGINS" ]; then
  pass "fixture: a record was written for every plugin the guard checks ($(echo $BUMP_PLUGINS))"
else
  fail "fixture: a record was written for every plugin the guard checks" \
       "fixture=[$(echo $fixture_plugins)] derived=[$(echo $BUMP_PLUGINS)]"
fi

OUT=$(run_hook "$T/drift" "$BUMP_PARENT" "$BUMP_SHA"); EC=$?
check "parity: drifted profiles + version bump → deny" deny "$OUT" $EC

if echo "$OUT" | grep -q "release.sh"; then
  pass "parity: deny message names the repair"
else
  fail "parity: deny message names the repair" "$(echo "$OUT" | tail -2)"
fi

# THE REAL TIE. The plugin the guard says it refused, read out of the guard's own
# stderr, must be exactly the set the fixture drifted. Independently sourced: the
# left side is produced by executing the hook, the right side by the test's own
# derivation. If those two ever diverge again, this fails and names both.
guard_plugins=$(printf '%s\n' "$OUT" \
  | sed -n "s/.*pre-push-guard: '\([^']*\)' version changed.*/\1/p" | sort -u)
if [ -n "$guard_plugins" ] && [ "$guard_plugins" = "$BUMP_PLUGINS" ]; then
  pass "parity: the plugin the guard refused == the plugin the fixture drifted"
else
  fail "parity: the plugin the guard refused == the plugin the fixture drifted" \
       "guard=[$(echo $guard_plugins)] fixture=[$(echo $BUMP_PLUGINS)]"
fi

# Same drifted profiles, but the pushed range touches no plugin.json. Ordinary
# work must never be gated on local profile state.
OUT=$(run_hook "$T/drift" "$NOBUMP_PARENT" "$NOBUMP_SHA"); EC=$?
check "parity: drifted profiles + NO version bump → allow" allow "$OUT" $EC

# Profiles that agree with each plugin's canonical version.
make_profiles "$T/clean" canonical
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

# --- The installed hook must not be a stale snapshot ---------------------------
# install-hooks.sh used to `cp` the script into .git/hooks/. That silently froze
# the hook at install time: every later edit to scripts/pre-push-guard.sh failed
# to reach the installed copy, and nothing anywhere reported the divergence. Same
# freshness trap as a plugin cache serving pre-edit bytes. Assert the installed
# hook tracks the source instead of snapshotting it.
GR="$T/clone"
mkdir -p "$GR/scripts"
git -C "$GR" init -q 2>/dev/null
cp "$REPO_ROOT/scripts/install-hooks.sh" "$GR/scripts/"
printf '#!/usr/bin/env bash\necho ORIGINAL\n' > "$GR/scripts/pre-push-guard.sh"
chmod +x "$GR/scripts/pre-push-guard.sh"
(cd "$GR" && ./scripts/install-hooks.sh >/dev/null 2>&1)

if [ -x "$GR/.git/hooks/pre-push" ]; then
  pass "install-hooks: pre-push installed"
else
  fail "install-hooks: pre-push installed" "missing or not executable"
fi

# Positive control: the freshly installed hook answers with the CURRENT script.
OUT=$(cd "$GR" && echo | ./.git/hooks/pre-push origin url 2>&1 || true)
if echo "$OUT" | grep -q ORIGINAL; then
  pass "install-hooks: installed hook runs the script"
else
  fail "install-hooks: installed hook runs the script" "got: $OUT"
fi

# The real assertion: edit the source, do NOT re-install, and the hook must
# follow. A `cp` install fails here and keeps printing ORIGINAL.
printf '#!/usr/bin/env bash\necho EDITED\n' > "$GR/scripts/pre-push-guard.sh"
OUT=$(cd "$GR" && echo | ./.git/hooks/pre-push origin url 2>&1 || true)
if echo "$OUT" | grep -q EDITED; then
  pass "install-hooks: installed hook tracks source edits (not a stale copy)"
else
  fail "install-hooks: installed hook tracks source edits (not a stale copy)" "got: $OUT"
fi

# --- The absent guard must announce itself ------------------------------------
# install-hooks.sh is opt-in per clone, so the guards above can simply not exist
# — and a guard that is not there is indistinguishable from a guard finding
# nothing wrong. check-hooks-installed.sh exists to break that tie.
CHECK="$REPO_ROOT/scripts/check-hooks-installed.sh"
HR="$T/hookrepo"
mkdir -p "$HR/scripts"
git -C "$HR" init -q 2>/dev/null
cp "$REPO_ROOT/scripts/install-hooks.sh" "$CHECK" "$HR/scripts/"
printf '#!/usr/bin/env bash\nexit 0\n' > "$HR/scripts/pre-push-guard.sh"
chmod +x "$HR/scripts/pre-push-guard.sh"

# Missing entirely.
OUT=$(cd "$HR" && bash scripts/check-hooks-installed.sh 2>&1); EC=$?
if [ "$EC" -eq 0 ] && echo "$OUT" | grep -q 'NOT installed'; then
  pass "hooks-installed: missing hook warns, exit 0"
else
  fail "hooks-installed: missing hook warns, exit 0" "ec=$EC out=$OUT"
fi

# A foreign pre-push hook is NOT our guard — distinct message, still exit 0.
printf '#!/usr/bin/env bash\nexit 0\n' > "$HR/.git/hooks/pre-push"
chmod +x "$HR/.git/hooks/pre-push"
OUT=$(cd "$HR" && bash scripts/check-hooks-installed.sh 2>&1); EC=$?
if [ "$EC" -eq 0 ] && echo "$OUT" | grep -q 'not this repo'; then
  pass "hooks-installed: foreign hook warns, exit 0"
else
  fail "hooks-installed: foreign hook warns, exit 0" "ec=$EC out=$OUT"
fi

# Properly installed — must be SILENT. This is the discriminator: a check that
# warned unconditionally would pass both cases above and still be useless.
(cd "$HR" && ./scripts/install-hooks.sh >/dev/null 2>&1)
OUT=$(cd "$HR" && bash scripts/check-hooks-installed.sh 2>&1); EC=$?
if [ "$EC" -eq 0 ] && [ -z "$OUT" ]; then
  pass "hooks-installed: installed hook is silent"
else
  fail "hooks-installed: installed hook is silent" "ec=$EC out=$OUT"
fi

# Outside a git checkout there is nothing to install into: silent, exit 0.
OUT=$(cd "$T" && bash "$CHECK" 2>&1); EC=$?
if [ "$EC" -eq 0 ] && [ -z "$OUT" ]; then
  pass "hooks-installed: non-git dir is silent"
else
  fail "hooks-installed: non-git dir is silent" "ec=$EC out=$OUT"
fi

print_summary
