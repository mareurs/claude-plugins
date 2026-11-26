#!/usr/bin/env bash
# scripts/prune-orphan-pins.sh <plugin> [--apply]
#
# Lists, and with --apply removes, the elements of "<plugin>@<marketplace>" in every profile's
# install record whose projectPath directory no longer exists (a deleted git worktree).
# Claude Code keeps one element per project directory for a `local` or `project` install and
# never prunes it, so such an element keeps an old version for a path nobody opens.
#
# Dry run by default. --apply copies the record to <record>.bak-orphan-<date> first and removes
# only elements with a non-empty projectPath that is not a directory. A `user` element has no
# projectPath and is never touched. Profiles without the plugin are skipped.
#
# Env: MARKETPLACE=… overrides the marketplace key (default: sdd-misc-plugins)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-profiles.sh
source "$SCRIPT_DIR/lib-profiles.sh"

PLUGIN="${1:?usage: prune-orphan-pins.sh <plugin> [--apply]}"
APPLY=0
[ "${2:-}" = "--apply" ] && APPLY=1
MARKETPLACE="${MARKETPLACE:-sdd-misc-plugins}"
KEY="$PLUGIN@$MARKETPLACE"

found=0
for P in "${PROFILES[@]}"; do
  profile_has_plugin "$P" "$PLUGIN" "$MARKETPLACE" || continue
  rec="$P/plugins/installed_plugins.json"
  orphans=()
  while IFS= read -r ppath; do
    [ -n "$ppath" ] && [ ! -d "$ppath" ] && orphans+=("$ppath")
  done < <(jq -r --arg k "$KEY" '.plugins[$k][] | .projectPath // empty' "$rec")
  [ "${#orphans[@]}" -gt 0 ] || continue
  for o in "${orphans[@]}"; do
    found=$((found + 1))
    echo "ORPHAN: $KEY in $P — projectPath $o"
  done
  if [ "$APPLY" = 1 ]; then
    cp -p "$rec" "$rec.bak-orphan-$(date +%Y%m%d)"
    t="$(mktemp)"
    printf '%s\n' "${orphans[@]}" | jq -R . | jq -s . > "$t.list"
    jq --arg k "$KEY" --slurpfile gone "$t.list" \
       '.plugins[$k] |= map(select((.projectPath // "") as $p | ($gone[0] | index($p)) == null))' \
       "$rec" > "$t" && mv "$t" "$rec"
    rm -f "$t.list"
    echo "  removed ${#orphans[@]}; backup $rec.bak-orphan-$(date +%Y%m%d)"
  fi
done
[ "$found" -gt 0 ] || echo "no orphan pins for $KEY"
[ "$found" = 0 ] || [ "$APPLY" = 1 ] || echo "dry run: nothing changed. Re-run with --apply to remove them."
