#!/bin/bash
# tests/test-check-skill-skew.sh — scripts/check-skill-skew.sh
#
# F-6 (skill-loading-session-log): the Skill tool prints the WORKING TREE as "Base directory"
# but serves the skill text from the versioned cache (`installPath`). Between a commit that
# edits a skill and the next release the two differ, and a skill that reads its helper files
# through the printed directory mixes the old text with new helpers. The script names every
# skills/ and commands/ file where the tree and the installed cache disagree.
#
# Hooks, agents and the rest of a plugin are not compared: hooks resolve through
# CLAUDE_PLUGIN_ROOT to the working tree, so no skew exists for them.
#
# Every invocation runs against a temp repo and a temp HOME; the real profiles are never read.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── check-skill-skew ──"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MKT=sdd-misc-plugins
PLUGIN=fakeplug
VER=1.0.0

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
R="$T/repo"; H="$T/home"
mkdir -p "$R/scripts" "$H"
cp "$ROOT/scripts/check-skill-skew.sh" "$ROOT/scripts/lib-profiles.sh" "$R/scripts/" 2>/dev/null

# A plugin in the temp repo, and the same bytes in the cache of profile .claude.
mkdir -p "$R/$PLUGIN/.claude-plugin" "$R/$PLUGIN/skills/greet/references" "$R/$PLUGIN/commands" "$R/$PLUGIN/hooks"
echo "{\"name\":\"$PLUGIN\",\"version\":\"$VER\"}" > "$R/$PLUGIN/.claude-plugin/plugin.json"
echo "say hello" > "$R/$PLUGIN/skills/greet/SKILL.md"
echo "ref one" > "$R/$PLUGIN/skills/greet/references/a.md"
echo "do it" > "$R/$PLUGIN/commands/go.md"
echo "hook v1" > "$R/$PLUGIN/hooks/h.mjs"

CACHE="$H/.claude/plugins/cache/$MKT/$PLUGIN/$VER"
fresh_cache() { rm -rf "$CACHE"; mkdir -p "$(dirname "$CACHE")"; cp -a "$R/$PLUGIN" "$CACHE"; }
mkdir -p "$H/.claude/plugins" "$H/.claude-sdd/plugins" "$H/.claude-kat/plugins" "$H/.claude-stef/plugins"
cat > "$H/.claude/plugins/installed_plugins.json" <<EOF
{"version":2,"plugins":{"$PLUGIN@$MKT":[{"scope":"user","version":"$VER","installPath":"$CACHE"}]}}
EOF
run() { HOME="$H" bash "$R/scripts/check-skill-skew.sh" "$@" 2>&1; }

# --- 1. tree and cache identical ---
fresh_cache
out="$(run)"; rc=$?
[ "$rc" = 0 ] && pass "identical tree and cache: exit 0" || fail "identical tree and cache: exit 0" "rc=$rc: $out"
case "$out" in *"no skew"*) pass "identical: says no skew" ;; *) fail "identical: says no skew" "$out" ;; esac

# --- 2. an edited SKILL.md in the tree ---
echo "say hello, loudly" > "$R/$PLUGIN/skills/greet/SKILL.md"
out="$(run)"; rc=$?
[ "$rc" = 1 ] && pass "edited skill: exit 1" || fail "edited skill: exit 1" "rc=$rc: $out"
case "$out" in *"$PLUGIN"*".claude"*"skills/greet/SKILL.md"*) pass "edited skill: names plugin, profile and file" ;; *) fail "edited skill: names plugin, profile and file" "$out" ;; esac
case "$out" in *"release.sh $PLUGIN"*) pass "edited skill: names the fix" ;; *) fail "edited skill: names the fix" "$out" ;; esac

# --- 3. a helper file that exists only in the tree ---
fresh_cache
echo "ref two" > "$R/$PLUGIN/skills/greet/references/b.md"
out="$(run)"; rc=$?
[ "$rc" = 1 ] && pass "new helper in the tree: exit 1" || fail "new helper in the tree: exit 1" "rc=$rc: $out"
case "$out" in *"skills/greet/references/b.md"*) pass "new helper: names the file" ;; *) fail "new helper: names the file" "$out" ;; esac

# --- 4. only a __pycache__ differs ---
fresh_cache
mkdir -p "$R/$PLUGIN/skills/greet/__pycache__"; echo x > "$R/$PLUGIN/skills/greet/__pycache__/m.cpython-313.pyc"
out="$(run)"; rc=$?
[ "$rc" = 0 ] && pass "__pycache__ only: exit 0" || fail "__pycache__ only: exit 0" "rc=$rc: $out"
rm -rf "$R/$PLUGIN/skills/greet/__pycache__"

# --- 5. an edited command ---
fresh_cache
echo "do it twice" > "$R/$PLUGIN/commands/go.md"
out="$(run)"; rc=$?
[ "$rc" = 1 ] && pass "edited command: exit 1" || fail "edited command: exit 1" "rc=$rc: $out"
case "$out" in *"commands/go.md"*) pass "edited command: names the file" ;; *) fail "edited command: names the file" "$out" ;; esac

# --- 6. a hook edit alone is not skew (hooks load from the working tree) ---
fresh_cache
echo "hook v2" > "$R/$PLUGIN/hooks/h.mjs"
out="$(run)"; rc=$?
[ "$rc" = 0 ] && pass "hook edit only: exit 0" || fail "hook edit only: exit 0" "rc=$rc: $out"

# --- 7. a profile without the plugin is skipped; plugin argument selects ---
fresh_cache
echo "say hello, quietly" > "$R/$PLUGIN/skills/greet/SKILL.md"
out="$(run "$PLUGIN")"; rc=$?
[ "$rc" = 1 ] && pass "plugin argument: exit 1 on skew" || fail "plugin argument: exit 1 on skew" "rc=$rc: $out"
n="$(printf '%s\n' "$out" | grep -c "\.claude-sdd\|\.claude-kat\|\.claude-stef")"
[ "$n" = 0 ] && pass "profiles without the plugin are not reported" || fail "profiles without the plugin are not reported" "$out"

# --- 8. a plugin installed nowhere ---
out="$(run nosuchplug)"; rc=$?
[ "$rc" = 0 ] && pass "unknown plugin: exit 0" || fail "unknown plugin: exit 0" "rc=$rc: $out"

print_summary "check-skill-skew"
