#!/bin/bash
# scripts/check-skill-skew.sh — where the working tree and the installed cache disagree about skills.
# Exit 0 = no skew, Exit 1 = skew found.
#
# The Skill tool prints the WORKING TREE of a directory-source plugin as "Base directory" but
# serves the skill text from the versioned cache (`installPath`), measured 2026-11-25 on Claude
# Code 2.1.332 (skill-loading-session-log F-6, memory plugin-load-channels). A skill that reads
# its helper files through the printed directory therefore mixes text from the last release with
# helpers from the tree. Between a commit that edits a skill and the next release the two differ.
#
# Only skills/ and commands/ are compared. Hooks resolve through CLAUDE_PLUGIN_ROOT to the working
# tree, so no skew exists for them. Python caches are ignored. Every element of a plugin's install
# record is checked, because an element pinned to an older cache serves older text.
#
# This script DETECTS and FAILS; it never copies or rewrites anything. The fix is a release.
#
# Usage:
#   ./scripts/check-skill-skew.sh                      # every plugin this repo publishes
#   ./scripts/check-skill-skew.sh codescout-companion
#   MARKETPLACE=other ./scripts/check-skill-skew.sh

set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKETPLACE="${MARKETPLACE:-sdd-misc-plugins}"
source "$REPO_ROOT/scripts/lib-profiles.sh"   # PROFILES

if [ "$#" -gt 0 ]; then
  PLUGINS=("$@")
else
  PLUGINS=()
  for pj in "$REPO_ROOT"/*/.claude-plugin/plugin.json; do
    [ -f "$pj" ] || continue
    PLUGINS+=("$(basename "$(dirname "$(dirname "$pj")")")")
  done
fi

skewed=0
checked=0
skewed_plugins=()

for PLUGIN in "${PLUGINS[@]}"; do
  if [ ! -f "$REPO_ROOT/$PLUGIN/.claude-plugin/plugin.json" ]; then
    echo "SKIP: $PLUGIN — no $PLUGIN/.claude-plugin/plugin.json in this repo"
    continue
  fi
  key="$PLUGIN@$MARKETPLACE"
  plugin_skewed=0

  for P in "${PROFILES[@]}"; do
    rec="$P/plugins/installed_plugins.json"
    [ -f "$rec" ] || continue
    jq -e --arg k "$key" '.plugins | has($k)' "$rec" >/dev/null 2>&1 || continue
    profile="$(basename "$P")"

    while IFS=$'\t' read -r version path; do
      [ -n "$path" ] || continue
      checked=$((checked + 1))
      for sub in skills commands; do
        tree="$REPO_ROOT/$PLUGIN/$sub"
        cache="$path/$sub"
        [ -d "$tree" ] || [ -d "$cache" ] || continue
        # A directory present on one side only is a skew of every file in it.
        [ -d "$tree" ] || tree=/dev/null/none
        [ -d "$cache" ] || cache=/dev/null/none
        while IFS= read -r line; do
          case "$line" in
            "Files "*" differ")
              f="${line#Files }"; f="${f%% and *}"
              echo "SKEW $PLUGIN $profile ($version): $sub/${f#"$tree"/} differs"
              ;;
            "Only in "*)
              d="${line#Only in }"; name="${d#*: }"; d="${d%%: *}"
              case "$d" in
                "$tree"*) side="tree only";  rel="${d#"$tree"}" ;;
                *)        side="cache only"; rel="${d#"$cache"}" ;;
              esac
              rel="${rel#/}"
              echo "SKEW $PLUGIN $profile ($version): $sub/${rel:+$rel/}$name $side"
              ;;
          esac
          plugin_skewed=1
        done < <(diff -rq -x __pycache__ -x '*.pyc' "$tree" "$cache" 2>/dev/null)
      done
    done < <(jq -r --arg k "$key" '.plugins[$k][] | [.version, .installPath] | @tsv' "$rec")
  done

  if [ "$plugin_skewed" = 1 ]; then
    skewed=1
    skewed_plugins+=("$PLUGIN")
  fi
done

if [ "$skewed" = 1 ]; then
  for p in "${skewed_plugins[@]}"; do
    echo "committed, not live: ./scripts/release.sh $p   (or revert the tree edit)"
  done
  exit 1
fi
echo "no skew: $checked install record element(s) checked"
exit 0
