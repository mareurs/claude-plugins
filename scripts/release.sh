#!/usr/bin/env bash
# release.sh — one-shot release for cache-based directory-source plugins
# (buddy, codescout-companion). Collapses the whole version-bump "dance"
# documented in CLAUDE.md § "When bumping a plugin version" into a single command.
#
# Usage:
#   ./scripts/release.sh <plugin> [<version>|patch|minor|major]   # default: patch
#   ./scripts/release.sh buddy 0.7.21
#   ./scripts/release.sh buddy patch
#   ./scripts/release.sh codescout-companion minor
#
# Env toggles:
#   NO_PUSH=1     do everything except `git push` (commits stay local)
#   SKIP_TESTS=1  skip the pre-flight test suites (NOT recommended)
#   MARKETPLACE=… override the marketplace key (default: sdd-misc-plugins)
#
# Steps (each gated; aborts on first failure):
#   0. pre-flight  — working tree clean; run-all.sh + buddy pytest green
#   1. version     — bump <plugin>/.claude-plugin/plugin.json + README.md table
#   2. consistency — scripts/check-versions.sh
#   3. commit      — "chore: bump <plugin> to <version>"
#   4. cache       — scripts/bump-cache.sh (seed all 3 profiles)
#   5. records     — repoint version + installPath in all 3 install records
#   6. sanity      — recorded version's cache dir exists; installPath owns its profile
#   7. push        — unless NO_PUSH=1
#   8. prints the two steps a bash script CANNOT do: codescout tracker refresh + cold restart
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PLUGIN="${1:?usage: release.sh <plugin> [<version>|patch|minor|major]}"
BUMP="${2:-patch}"
MARKETPLACE="${MARKETPLACE:-sdd-misc-plugins}"
PROFILES=("$HOME/.claude" "$HOME/.claude-sdd" "$HOME/.claude-kat")
PLUGIN_JSON="$PLUGIN/.claude-plugin/plugin.json"

[ -f "$PLUGIN_JSON" ] || { echo "✗ no $PLUGIN_JSON — unknown plugin '$PLUGIN'"; exit 1; }

CUR="$(jq -r '.version' "$PLUGIN_JSON")"
case "$BUMP" in
  patch|minor|major)
    IFS=. read -r MA MI PA <<<"$CUR"
    case "$BUMP" in
      patch) PA=$((PA + 1)) ;;
      minor) MI=$((MI + 1)); PA=0 ;;
      major) MA=$((MA + 1)); MI=0; PA=0 ;;
    esac
    VERSION="$MA.$MI.$PA" ;;
  *) VERSION="$BUMP" ;;   # explicit "X.Y.Z"
esac

echo "▶ release $PLUGIN: $CUR → $VERSION  (marketplace=$MARKETPLACE)"

# 0. pre-flight ----------------------------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ working tree not clean — commit or stash first:"; git status --short; exit 1
fi
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "▶ tests: ./tests/run-all.sh"; ./tests/run-all.sh
  if [ -x buddy/.venv/bin/pytest ]; then
    echo "▶ tests: buddy pytest"; ( cd buddy && .venv/bin/pytest tests -q )
  fi
fi

# 1. bump version sources ------------------------------------------------------
tmp="$(mktemp)"; jq --arg v "$VERSION" '.version = $v' "$PLUGIN_JSON" > "$tmp" && mv "$tmp" "$PLUGIN_JSON"
# README version-table row:  | **[<plugin>](./<plugin>/)** | <ver> | <desc> |
sed -i -E "s#(\*\*\[$PLUGIN\]\(\./$PLUGIN/\)\*\* [|] )[^ |]+( [|])#\1$VERSION\2#" README.md

# 2. consistency gate (also catches a mis-fired README sed) --------------------
./scripts/check-versions.sh

# 3. commit the bump -----------------------------------------------------------
git add "$PLUGIN_JSON" README.md
git commit -m "chore: bump $PLUGIN to $VERSION" \
           -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"

# 4. seed the versioned cache in all profiles ----------------------------------
./scripts/bump-cache.sh "$PLUGIN" "$VERSION"

# 5. repoint version + installPath in all 3 install records --------------------
for P in "${PROFILES[@]}"; do
  rec="$P/plugins/installed_plugins.json"
  [ -f "$rec" ] || { echo "  · skip $P (no install record)"; continue; }
  t="$(mktemp)"
  jq --arg v "$VERSION" --arg p "$P/plugins/cache/$MARKETPLACE/$PLUGIN/$VERSION" \
     "(.plugins[\"$PLUGIN@$MARKETPLACE\"][0].version) = \$v
      | (.plugins[\"$PLUGIN@$MARKETPLACE\"][0].installPath) = \$p" \
     "$rec" > "$t" && mv "$t" "$rec"
done

# 6. sanity: cache dir for recorded version exists; installPath owns its profile
fail=0
for P in "${PROFILES[@]}"; do
  rec="$P/plugins/installed_plugins.json"; [ -f "$rec" ] || continue
  v="$(jq -r ".plugins[\"$PLUGIN@$MARKETPLACE\"][0].version" "$rec")"
  ip="$(jq -r ".plugins[\"$PLUGIN@$MARKETPLACE\"][0].installPath" "$rec")"
  if [ -d "$P/plugins/cache/$MARKETPLACE/$PLUGIN/$v" ]; then echo "  ✓ $P  $PLUGIN $v"; else echo "  ✗ $P  $PLUGIN $v cache MISSING"; fail=1; fi
  case "$ip" in "$P"/*) ;; *) echo "  ✗ $P  installPath escapes profile: $ip"; fail=1 ;; esac
done
[ "$fail" = 0 ] || { echo "✗ sanity failed — NOT pushing. Fix records, re-run, or push manually."; exit 1; }

# 7. push ----------------------------------------------------------------------
if [ "${NO_PUSH:-0}" = "1" ]; then echo "▶ NO_PUSH=1 — committed locally, not pushed"; else git push; fi

# 8. the two steps a script cannot do ------------------------------------------
cat <<EOF

✅ $PLUGIN $VERSION released ($([ "${NO_PUSH:-0}" = "1" ] && echo local || echo pushed)).

Two steps remain — a bash script can't do them:
  1. codescout tracker — refresh version-bump-checklist (needs the MCP tool), then verify all ✅:
       artifact(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)   # update params/body for $PLUGIN $VERSION
  2. COLD-RESTART all three Claude Code instances — a resume is NOT enough (hooks
     resolve installPath at launch). Fully quit + relaunch, or run /reload-plugins.
EOF
