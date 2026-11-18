#!/usr/bin/env bash
# scripts/lib-profiles.sh — the Claude Code profiles every release script covers.
#
# Source this file, then loop over "${PROFILES[@]}".
#
# One list, kept here, because release.sh, bump-cache.sh and check-profile-parity.sh
# each held a copy of it. ~/.claude-stef was missing from all three: the 1.20.22
# release seeded no cache there, and the parity gate passed on "3 profile(s)" while
# that profile stayed on 1.20.21 without the wake hook (2026-10-29).
# tests/test-profile-list-single-source.sh pins that no script keeps its own copy.
#
# A profile whose install record lacks "<plugin>@<marketplace>" is skipped by bump-cache.sh,
# repoint-install-records.sh and check-profile-parity.sh: a release must not install a
# plugin into a profile that never had it (F-15). Test with profile_has_plugin.
PROFILES=("$HOME/.claude" "$HOME/.claude-sdd" "$HOME/.claude-kat" "$HOME/.claude-stef")

# profile_has_plugin <profile_dir> <plugin> <marketplace>
# Exit 0 iff the profile's installed_plugins.json exists and has the "<plugin>@<marketplace>" key.
profile_has_plugin() {
  local rec="$1/plugins/installed_plugins.json"
  [ -f "$rec" ] || return 1
  jq -e --arg k "$2@$3" '.plugins | has($k)' "$rec" >/dev/null 2>&1
}
