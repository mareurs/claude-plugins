#!/bin/bash
# tests/test-release-installed-profiles.sh — bump-cache.sh and repoint-install-records.sh
#
# F-15: release.sh seeded the versioned cache in every profile in lib-profiles.sh and its
# jq repoint CREATED the "<plugin>@<marketplace>" key in any record that lacked it, so a
# plugin installed only in ~/.claude-kat was written into all four profiles. Both scripts
# must now touch only profiles whose install record already carries the plugin.
#
# Every invocation runs with HOME pointed at a temp dir; the real profiles are never read.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── release-installed-profiles ──"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN=sdd
MKT=sdd-misc-plugins
VER="$(jq -r '.version' "$ROOT/$PLUGIN/.claude-plugin/plugin.json")"

H="$(mktemp -d)"
trap 'rm -rf "$H"' EXIT
for p in .claude .claude-sdd .claude-kat .claude-stef; do mkdir -p "$H/$p/plugins"; done

KAT="$H/.claude-kat/plugins/installed_plugins.json"
CLD="$H/.claude/plugins/installed_plugins.json"
write_kat() {
  cat > "$KAT" <<EOF
{"version":2,"plugins":{"$PLUGIN@$MKT":[{"scope":"user","version":"0.0.1","installPath":"$H/.claude-kat/plugins/cache/$MKT/$PLUGIN/0.0.1"}]}}
EOF
}
write_kat
echo '{"version":2,"plugins":{"buddy@'$MKT'":[{"scope":"user","version":"1.0.0","installPath":"x"}]}}' > "$CLD"
sha_cld="$(sha256sum "$CLD" | cut -d' ' -f1)"

# --- plugin installed in kat only ---
out="$(HOME="$H" bash "$ROOT/scripts/bump-cache.sh" $PLUGIN "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "bump-cache exits 0" || fail "bump-cache exits 0" "rc=$rc: $out"
[ -d "$H/.claude-kat/plugins/cache/$MKT/$PLUGIN/$VER" ] && pass "bump-cache seeds the installed profile" \
  || fail "bump-cache seeds the installed profile" "no cache dir in .claude-kat"
stray=""
for p in .claude .claude-sdd .claude-stef; do
  [ -e "$H/$p/plugins/cache" ] && stray="$stray $p"
done
[ -z "$stray" ] && pass "bump-cache seeds no other profile" || fail "bump-cache seeds no other profile" "cache in:$stray"

out="$(HOME="$H" bash "$ROOT/scripts/repoint-install-records.sh" $PLUGIN "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "repoint exits 0" || fail "repoint exits 0" "rc=$rc: $out"
[ "$(jq -r ".plugins[\"$PLUGIN@$MKT\"][0].version" "$KAT")" = "$VER" ] && pass "repoint updates the installed record" \
  || fail "repoint updates the installed record" "$(cat "$KAT")"
[ "$(jq -r ".plugins[\"$PLUGIN@$MKT\"][0].installPath" "$KAT")" = "$H/.claude-kat/plugins/cache/$MKT/$PLUGIN/$VER" ] \
  && pass "repoint sets installPath inside the profile" || fail "repoint sets installPath inside the profile"
[ "$(sha256sum "$CLD" | cut -d' ' -f1)" = "$sha_cld" ] && pass "record lacking the plugin is byte-identical" \
  || fail "record lacking the plugin is byte-identical" "$(cat "$CLD")"
made=""
for p in .claude-sdd .claude-stef; do
  [ -e "$H/$p/plugins/installed_plugins.json" ] && made="$made $p"
done
[ -z "$made" ] && pass "no install record created elsewhere" || fail "no install record created elsewhere" "created in:$made"

# --- a sibling element for a deleted worktree ---
# `local`/`project` installs are one element per project directory. [0] alone was repointed, so the
# element of a removed worktree kept the old version (sdd in kat and stef, 2026-11-26).
LIVE="$H/live-project"; GONE="$H/gone-worktree"; mkdir -p "$LIVE"
cat > "$KAT" <<EOF
{"version":2,"plugins":{"$PLUGIN@$MKT":[
 {"scope":"local","projectPath":"$LIVE","version":"0.0.1","installPath":"$H/.claude-kat/plugins/cache/$MKT/$PLUGIN/0.0.1"},
 {"scope":"local","projectPath":"$GONE","version":"0.0.1","installPath":"$H/.claude-kat/plugins/cache/$MKT/$PLUGIN/0.0.1"},
 {"scope":"user","version":"0.0.1","installPath":"$H/.claude-kat/plugins/cache/$MKT/$PLUGIN/0.0.1"}]}}
EOF
HOME="$H" bash "$ROOT/scripts/bump-cache.sh" $PLUGIN "$VER" >/dev/null 2>&1
HOME="$H" bash "$ROOT/scripts/repoint-install-records.sh" $PLUGIN "$VER" >/dev/null 2>&1
[ "$(jq -r "[.plugins[\"$PLUGIN@$MKT\"][].version] | unique | join(\",\")" "$KAT")" = "$VER" ] \
  && pass "repoint updates every element, siblings included" \
  || fail "repoint updates every element, siblings included" "$(jq -c '[.plugins[][].version]' "$KAT")"
out="$(HOME="$H" bash "$ROOT/scripts/check-profile-parity.sh" $PLUGIN 2>&1)"
printf '%s\n' "$out" | grep -q "ORPHAN: $PLUGIN in $H/.claude-kat — element \[1\]" \
  && pass "parity names the element of a deleted directory as ORPHAN" \
  || fail "parity names the element of a deleted directory as ORPHAN" "$out"
printf '%s\n' "$out" | grep -q "ORPHAN.*$LIVE" \
  && fail "parity does not flag a live project directory (control)" "$out" \
  || pass "parity does not flag a live project directory (control)"
sha_kat="$(sha256sum "$KAT" | cut -d' ' -f1)"
HOME="$H" bash "$ROOT/scripts/prune-orphan-pins.sh" $PLUGIN >/dev/null 2>&1
[ "$(sha256sum "$KAT" | cut -d' ' -f1)" = "$sha_kat" ] && pass "prune is a dry run without --apply" \
  || fail "prune is a dry run without --apply" "$(cat "$KAT")"
HOME="$H" bash "$ROOT/scripts/prune-orphan-pins.sh" $PLUGIN --apply >/dev/null 2>&1
[ "$(jq -r "[.plugins[\"$PLUGIN@$MKT\"][] | .projectPath // \"user\"] | join(\",\")" "$KAT")" = "$LIVE,user" ] \
  && pass "prune --apply removes only the orphan; a live project and the user element stay" \
  || fail "prune --apply removes only the orphan; a live project and the user element stay" "$(jq -c '[.plugins[][]|.projectPath]' "$KAT")"
ls "$KAT".bak-orphan-* >/dev/null 2>&1 && pass "prune --apply leaves a backup of the record" || fail "prune --apply leaves a backup of the record"
rm -rf "$H/.claude-kat/plugins/cache" "$KAT".bak-orphan-*

# --- plugin installed nowhere ---
rm -rf "$H/.claude-kat/plugins/cache"
echo '{"version":2,"plugins":{}}' > "$KAT"
sha_kat="$(sha256sum "$KAT" | cut -d' ' -f1)"
for s in bump-cache repoint-install-records; do
  out="$(HOME="$H" bash "$ROOT/scripts/$s.sh" $PLUGIN "$VER" 2>&1)"; rc=$?
  [ "$rc" = 0 ] && pass "$s exits 0 when installed nowhere" || fail "$s exits 0 when installed nowhere" "rc=$rc: $out"
  n="$(printf '%s\n' "$out" | grep -c "skip .* ($PLUGIN not installed)")"
  [ "$n" = 4 ] && pass "$s prints the skip line four times" || fail "$s prints the skip line four times" "got $n: $out"
done
[ "$(sha256sum "$KAT" | cut -d' ' -f1)" = "$sha_kat" ] && pass "nothing changed when installed nowhere" \
  || fail "nothing changed when installed nowhere"
[ ! -e "$H/.claude-kat/plugins/cache" ] && pass "no cache created when installed nowhere" \
  || fail "no cache created when installed nowhere"

print_summary "release-installed-profiles"
