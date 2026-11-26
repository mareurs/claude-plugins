#!/usr/bin/env bash
# scripts/repoint-install-records.sh <plugin> <version>
#
# Repoints version + installPath of EVERY element of "<plugin>@<marketplace>" in the install record
# of every profile (list: lib-profiles.sh) that ALREADY has the plugin, then checks that
# the recorded version's cache dir exists and installPath owns its profile.
# Every element: a `local` or `project` install is one element per project directory, so a
# plugin used from a worktree has a sibling element that [0] alone leaves on the old version.
# Profiles without the plugin are skipped: the jq assignment would otherwise CREATE the key
# and install the plugin there (F-15). Exit 1 on a sanity failure.
#
# Env: MARKETPLACE=… overrides the marketplace key (default: sdd-misc-plugins)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-profiles.sh
source "$SCRIPT_DIR/lib-profiles.sh"

PLUGIN="${1:?usage: repoint-install-records.sh <plugin> <version>}"
VERSION="${2:?usage: repoint-install-records.sh <plugin> <version>}"
MARKETPLACE="${MARKETPLACE:-sdd-misc-plugins}"

# 5. repoint version + installPath in every installed profile's record ---------
for P in "${PROFILES[@]}"; do
  if ! profile_has_plugin "$P" "$PLUGIN" "$MARKETPLACE"; then
    echo "  · skip $P ($PLUGIN not installed)"
    continue
  fi
  rec="$P/plugins/installed_plugins.json"
  t="$(mktemp)"
  jq --arg v "$VERSION" --arg p "$P/plugins/cache/$MARKETPLACE/$PLUGIN/$VERSION" \
     ".plugins[\"$PLUGIN@$MARKETPLACE\"] |= map(.version = \$v | .installPath = \$p)" \
     "$rec" > "$t" && mv "$t" "$rec"
done

# 6. sanity: cache dir for recorded version exists; installPath owns its profile
fail=0
for P in "${PROFILES[@]}"; do
  profile_has_plugin "$P" "$PLUGIN" "$MARKETPLACE" || continue
  rec="$P/plugins/installed_plugins.json"
  while IFS=$'\t' read -r v ip; do
    if [ -d "$P/plugins/cache/$MARKETPLACE/$PLUGIN/$v" ]; then echo "  ✓ $P  $PLUGIN $v"; else echo "  ✗ $P  $PLUGIN $v cache MISSING"; fail=1; fi
    case "$ip" in "$P"/*) ;; *) echo "  ✗ $P  installPath escapes profile: $ip"; fail=1 ;; esac
  done < <(jq -r ".plugins[\"$PLUGIN@$MARKETPLACE\"][] | [.version, .installPath] | @tsv" "$rec")
done
[ "$fail" = 0 ] || { echo "✗ sanity failed — NOT pushing. Fix records, re-run, or push manually."; exit 1; }
