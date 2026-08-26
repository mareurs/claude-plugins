#!/bin/bash
# Validates that OUR plugins are recorded identically across all Claude Code profiles.
# Exit 0 = parity holds, Exit 1 = drift found.
#
# Scope: the plugins this repo publishes (marketplace `sdd-misc-plugins` by default).
# Third-party plugins and per-profile settings are deliberately NOT checked — those
# diverge by design (e.g. ~/.claude-sdd carries hookify + andrej-karpathy-skills, and
# permissions/model/theme differ per profile on purpose).
#
# Four drift classes, all measured 2026-08-26:
#
#   1. STALE SIBLING — `.plugins["<plugin>@<marketplace>"]` is an ARRAY, one element per
#      install scope (`user`, plus one per `project` install). release.sh steps 5 and 6
#      both address `[0]`, and the version-bump-checklist tracker's gather prompt used to
#      as well, so an element pinned to a superseded version was invisible to every check.
#      Found in ~/.claude-kat: codescout-companion [0]=1.16.17 (user) alongside
#      [1]=1.16.16 (project, projectPath=/home/marius), while the release reported green.
#      The 1.16.16 cache dir still existed, so the stale record resolved to real bytes and
#      would serve pre-fix code rather than erroring.
#      Origin: one `/plugin install` run with cwd=~ on 2026-08-24T14:06:57.809Z, which
#      created project-scope entries for three unrelated plugins in the same second.
#   2. CROSS-PROFILE — an installPath under a different profile's root (2026-05-16 class).
#   3. MISSING CACHE — a recorded version with no cache dir on disk. The #1 cause of
#      "plugin appears installed but hook never fires".
#   4. VERSION SKEW — profiles recording different versions of the same plugin.
#
# This script DETECTS and FAILS; it never rewrites a record. A project-scope entry pinning
# an older version may be deliberate somewhere, so the repair stays a human call.
#
# Usage:
#   ./scripts/check-profile-parity.sh                 # every plugin this repo publishes
#   ./scripts/check-profile-parity.sh codescout-companion
#   MARKETPLACE=other ./scripts/check-profile-parity.sh

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKETPLACE="${MARKETPLACE:-sdd-misc-plugins}"
PROFILES=("$HOME/.claude" "$HOME/.claude-sdd" "$HOME/.claude-kat")

# Which plugins to check: argv, else every plugin.json in the repo.
if [ "$#" -gt 0 ]; then
  PLUGINS=("$@")
else
  PLUGINS=()
  for pj in "$REPO_ROOT"/*/.claude-plugin/plugin.json; do
    [ -f "$pj" ] || continue
    PLUGINS+=("$(basename "$(dirname "$(dirname "$pj")")")")
  done
fi

errors=0
checked=0

for PLUGIN in "${PLUGINS[@]}"; do
  PLUGIN_JSON="$REPO_ROOT/$PLUGIN/.claude-plugin/plugin.json"
  if [ ! -f "$PLUGIN_JSON" ]; then
    echo "SKIP: $PLUGIN — no $PLUGIN/.claude-plugin/plugin.json in this repo"
    continue
  fi
  canonical="$(jq -r '.version' "$PLUGIN_JSON")"
  key="$PLUGIN@$MARKETPLACE"

  present_profiles=()
  declare -A seen_versions=()
  plugin_errors=0

  for P in "${PROFILES[@]}"; do
    rec="$P/plugins/installed_plugins.json"
    [ -f "$rec" ] || continue

    n="$(jq -r --arg k "$key" '.plugins[$k] // [] | length' "$rec")"
    [ "$n" -gt 0 ] || continue
    present_profiles+=("$P")

    # EVERY element, not just [0] — this is the whole point of the script.
    while IFS=$'\t' read -r idx ver scope ipath ppath; do
      seen_versions["$ver"]=1

      if [ "$ver" != "$canonical" ]; then
        echo "STALE: $PLUGIN in $P — element [$idx] (scope=$scope${ppath:+, projectPath=$ppath}) records $ver, canonical is $canonical"
        plugin_errors=$((plugin_errors + 1))
      fi

      case "$ipath" in
        "$P"/*) ;;
        *) echo "CROSS-PROFILE: $PLUGIN in $P — element [$idx] installPath escapes its profile: $ipath"
           plugin_errors=$((plugin_errors + 1)) ;;
      esac

      if [ ! -d "$P/plugins/cache/$MARKETPLACE/$PLUGIN/$ver" ]; then
        echo "MISSING CACHE: $PLUGIN in $P — element [$idx] records $ver but the cache dir for it does not exist"
        plugin_errors=$((plugin_errors + 1))
      fi
    done < <(jq -r --arg k "$key" '.plugins[$k] // [] | to_entries[] | [(.key|tostring), .value.version, (.value.scope // "-"), (.value.installPath // "-"), (.value.projectPath // "")] | @tsv' "$rec")
  done

  if [ "${#present_profiles[@]}" -eq 0 ]; then
    # Not installed anywhere is not a failure — sdd is stable and uninstalled by design.
    echo "OK: $PLUGIN $canonical — not installed in any profile (nothing to keep in parity)"
    unset seen_versions
    continue
  fi

  checked=$((checked + 1))

  if [ "${#seen_versions[@]}" -gt 1 ]; then
    echo "VERSION SKEW: $PLUGIN — more than one version recorded across profiles: ${!seen_versions[*]}"
    plugin_errors=$((plugin_errors + 1))
  fi

  # Installed in some profiles but not others is drift worth naming, not a hard failure —
  # a profile may legitimately not have it yet.
  if [ "${#present_profiles[@]}" -ne "${#PROFILES[@]}" ]; then
    echo "WARN: $PLUGIN installed in ${#present_profiles[@]}/${#PROFILES[@]} profiles (${present_profiles[*]})"
  fi

  if [ "$plugin_errors" -eq 0 ]; then
    echo "OK: $PLUGIN $canonical — parity across ${#present_profiles[@]} profile(s), one canonical version, caches present"
  fi
  errors=$((errors + plugin_errors))
  unset seen_versions
done

echo ""
if [ "$errors" -gt 0 ]; then
  echo "FAILED: $errors profile-parity problem(s) across $checked plugin(s)."
  echo ""
  echo "This script never rewrites a record — the repair is a judgement call:"
  echo "  · STALE from an accidental cwd=~ install → back up the record, then drop the"
  echo "    project-scope element whose projectPath is \$HOME. A project-scope pin elsewhere"
  echo "    may be deliberate; check projectPath before removing anything."
  echo "  · MISSING CACHE → ./scripts/bump-cache.sh <plugin> <version>"
  echo "  · CROSS-PROFILE → repoint installPath to the record's own profile root"
  exit 1
else
  echo "Profile parity holds across $checked plugin(s)."
fi
