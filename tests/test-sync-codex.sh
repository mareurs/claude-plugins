#!/bin/bash
# tests/test-sync-codex.sh — scripts/sync-codex.py, the Codex half of a release.
#
# A `codex plugin add` that changes content cancels the plugin's hook approvals. sync-codex.py
# renews only approvals that already existed and changed in content alone; it reports, and never
# approves, a hook that was never approved or whose declaration changed. Soft-skips without Codex.
#
# Every run uses a scratch CODEX_HOME; ~/.codex is never read or written. The cases that need a
# real `codex app-server` are skipped when `codex` is not on PATH.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── sync-codex ──"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC="$ROOT/scripts/sync-codex.py"
PLUGIN=cs-hint-codex
MKT=sdd-misc-plugins
VER="$(jq -r '.version' "$ROOT/$PLUGIN/.claude-plugin/plugin.json")"
H="$(mktemp -d)"
trap 'rm -rf "$H"' EXIT

echo '{"codex": []}' > "$H/none.json"
echo "{\"codex\": [\"$PLUGIN\"]}" > "$H/want.json"
run() { CODEX_HOME="$H/home" HARNESS_TARGETS="${TARGETS:-$H/none.json}" "$@"; }
sync() { run python3 "$SYNC" "$PLUGIN" "$@"; }

# --- soft skips ---
mkdir -p "$H/home"
out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "no Codex install" && pass "no config.toml: skips with exit 0" \
  || fail "no config.toml: skips with exit 0" "rc=$rc $out"
echo '[plugins."other@sdd-misc-plugins"]' > "$H/home/config.toml"
out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "is not installed in Codex" && pass "plugin absent from config: skips, installs nothing" \
  || fail "plugin absent from config: skips, installs nothing" "rc=$rc $out"
[ ! -e "$H/home/plugins" ] && pass "plugin absent from config: no cache created" || fail "plugin absent from config: no cache created"
out="$(CODEX_BIN=no-such-codex-binary sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "no Codex install" && pass "no codex binary: skips with exit 0" \
  || fail "no codex binary: skips with exit 0" "rc=$rc $out"

# --- a plugin listed in harness-targets.json is MISSING under --check, installed otherwise ---
out="$(TARGETS="$H/want.json" sync "$VER" --check 2>&1)"; rc=$?
[ "$rc" = 1 ] && printf '%s' "$out" | grep -q "^MISSING: $PLUGIN" && pass "listed and absent: --check reports MISSING, exit 1" \
  || fail "listed and absent: --check reports MISSING, exit 1" "rc=$rc $out"
[ ! -e "$H/home/plugins" ] && pass "listed and absent: --check installs nothing" || fail "listed and absent: --check installs nothing"

if ! command -v codex >/dev/null 2>&1; then
  echo "  SKIP: codex not on PATH; the app-server cases need it"
  print_summary "sync-codex"; exit 0
fi

# --- real codex, scratch home and local marketplace ---
MARKET_ROOT="$H/market"
mkdir -p "$MARKET_ROOT/.claude-plugin"
cp "$ROOT/.claude-plugin/marketplace.json" "$MARKET_ROOT/.claude-plugin/"
cp -R "$ROOT/$PLUGIN" "$MARKET_ROOT/"
SOURCE="$MARKET_ROOT/$PLUGIN"
mkdir "$SOURCE/commands"
cat > "$SOURCE/commands/demo.md" <<'COMMAND'
---
description: A fixture command
---

Print the fixture message.
COMMAND
rm -rf "$H/home"; mkdir -p "$H/home"
run codex plugin marketplace add "$MARKET_ROOT" >/dev/null 2>&1
run codex plugin add "$PLUGIN@$MKT" >/dev/null 2>&1
CACHE="$H/home/plugins/cache/$MKT/$PLUGIN/$VER"
[ -d "$CACHE" ] || { fail "fixture: codex plugin add seeds the cache" "no $CACHE"; print_summary "sync-codex"; exit 1; }

out="$(sync "$VER" --check 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "REVIEW:.*never approved" && pass "check: a hook never approved is listed for review, not failed" \
  || fail "check: a hook never approved is listed for review, not failed" "rc=$rc $out"

out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "need your review" && pass "sync: a hook never approved is reported" \
  || fail "sync: a hook never approved is reported" "rc=$rc $out"
out="$(sync "$VER" --check 2>&1)"
printf '%s' "$out" | grep -q "1 hook(s) trusted" \
  && fail "sync never approves a hook the user never approved (control)" "$out" \
  || pass "sync never approves a hook the user never approved (control)"

# approve both halves, the way /hooks does
run python3 - "$SYNC" "$PLUGIN" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("sc", sys.argv[1]); sc = importlib.util.module_from_spec(spec); spec.loader.exec_module(sc)
srv = sc.AppServer(); edits = []
for h in sc.plugin_hooks(srv, sys.argv[2]):
    d, _, c = h["currentHash"].partition("/")
    edits += [{"keyPath": f'hooks.state."{h["key"]}".{f}', "mergeStrategy": "replace", "value": v} for f, v in (("trusted_hash", d), ("trusted_content_hash", c))]
srv.call("config/batchWrite", {"edits": edits, "reloadUserConfig": True}); srv.close()
PY
out="$(sync "$VER" --check 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "1 hook(s) trusted, 0 to renew" && pass "check: an approved hook reads trusted" \
  || fail "check: an approved hook reads trusted" "rc=$rc $out"

out="$(sync 9.9.9 --check 2>&1)"; rc=$?
[ "$rc" = 1 ] && printf '%s' "$out" | grep -q "STALE" && pass "check: a cache without the released version fails as STALE" \
  || fail "check: a cache without the released version fails as STALE" "rc=$rc $out"

# An approved cache can contain older bytes at the same manifest version.
cp "$CACHE/scripts/cs_tool_log.py" "$H/cached-before.py"
cp "$H/home/config.toml" "$H/config-before.toml"
echo "# same-version update" >> "$SOURCE/scripts/cs_tool_log.py"
out="$(sync "$VER" --check 2>&1)"; rc=$?
[ "$rc" = 1 ] && printf '%s' "$out" | grep -q 'STALE:.*scripts/cs_tool_log.py' \
  && cmp -s "$CACHE/scripts/cs_tool_log.py" "$H/cached-before.py" \
  && cmp -s "$H/home/config.toml" "$H/config-before.toml" \
  && pass "check: same-version stale payload is reported without writing" \
  || fail "check: same-version stale payload is reported without writing" "rc=$rc $out"
out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && cmp -s "$SOURCE/scripts/cs_tool_log.py" "$CACHE/scripts/cs_tool_log.py" \
  && printf '%s' "$out" | grep -q "(1 renewed)" \
  && pass "sync: refreshes same-version files and renews their prior approval" \
  || fail "sync: refreshes same-version files and renews their prior approval" "rc=$rc $out"
out="$(sync "$VER" --check 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "1 hook(s) trusted, 0 to renew" \
  && pass "check: freshly installed payload with generated command skill passes" \
  || fail "check: freshly installed payload with generated command skill passes" "rc=$rc $out"

# Codex generates a skill from a legacy command. Check its actual installed bytes.
GENERATED="$CACHE/.codex-plugin/migrated-command-skills/source-command-demo/SKILL.md"
cp "$GENERATED" "$H/generated-before.md"
echo "stale generated skill" >> "$GENERATED"
out="$(sync "$VER" --check 2>&1)"; rc=$?
[ "$rc" = 1 ] && printf '%s' "$out" | grep -q 'STALE:.*source-command-demo/SKILL.md' \
  && pass "check: catches stale generated command skill" \
  || fail "check: catches stale generated command skill" "rc=$rc $out"
out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && cmp -s "$GENERATED" "$H/generated-before.md" \
  && pass "sync: refreshes the generated skill through Codex" \
  || fail "sync: refreshes the generated skill through Codex" "rc=$rc $out"
rm "$SOURCE/commands/demo.md"
out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ ! -e "$GENERATED" ] && [ ! -e "$CACHE/commands/demo.md" ] \
  && pass "sync: removes obsolete command and generated skill" \
  || fail "sync: removes obsolete command and generated skill" "rc=$rc $out"

# Reinstalling directly through Codex leaves a modified approval for matching bytes.
echo "# fresh content with old approval" >> "$SOURCE/scripts/cs_tool_log.py"
run codex plugin add "$PLUGIN@$MKT" >/dev/null 2>&1
out="$(sync "$VER" --check 2>&1)"; rc=$?
[ "$rc" = 1 ] && printf '%s' "$out" | grep -q "MODIFIED" && pass "check: a content change reads MODIFIED and fails" \
  || fail "check: a content change reads MODIFIED and fails" "rc=$rc $out"
out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "(1 renewed)" && pass "sync: renews the approval of a content-only change" \
  || fail "sync: renews the approval of a content-only change" "rc=$rc $out"
sync "$VER" --check >/dev/null 2>&1 && pass "check: trusted again after the renewal" || fail "check: trusted again after the renewal"

# declaration change: reported, never renewed
KEY="$PLUGIN@$MKT:hooks/hooks.json:post_tool_use:0:0"
before="$(run python3 -c "import tomllib,sys;print(tomllib.load(open('$H/home/config.toml','rb'))['hooks']['state']['$KEY']['trusted_content_hash'])")"
python3 - "$H/home/config.toml" <<'PY'
import re, sys
p = sys.argv[1]; t = open(p).read()
t = re.sub(r'(trusted_hash = "sha256:)[0-9a-f]{4}', r'\g<1>0000', t, count=1)
open(p, "w").write(t)
PY
echo "# change 2" >> "$SOURCE/scripts/cs_tool_log.py"
run codex plugin add "$PLUGIN@$MKT" >/dev/null 2>&1
out="$(sync "$VER" 2>&1)"; rc=$?
after="$(run python3 -c "import tomllib,sys;print(tomllib.load(open('$H/home/config.toml','rb'))['hooks']['state']['$KEY']['trusted_content_hash'])")"
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "its declaration changed" && [ "$before" = "$after" ] \
  && pass "sync: a changed declaration is reported and its approval is not renewed" \
  || fail "sync: a changed declaration is reported and its approval is not renewed" "rc=$rc before=$before after=$after $out"

# a cache without the version: the add runs, then the hooks are checked
rm -rf "$CACHE"
out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ -d "$CACHE" ] && printf '%s' "$out" | grep -q "cache $VER seeded" \
  && pass "sync: a missing cache runs codex plugin add and seeds the version" \
  || fail "sync: a missing cache runs codex plugin add and seeds the version" "rc=$rc $out"

# An explicitly disabled plugin stays disabled even when its version is missing.
# plugin add would enable it as a side effect.
sed -i 's/^enabled = true$/enabled = false/' "$H/home/config.toml"
rm -rf "$CACHE"
out="$(sync "$VER" --check 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "disabled in Codex" \
  && pass "check: a disabled plugin does not require a current cache" \
  || fail "check: a disabled plugin does not require a current cache" "rc=$rc $out"
out="$(sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ ! -e "$CACHE" ] && grep -qx 'enabled = false' "$H/home/config.toml" \
  && pass "sync: a disabled plugin stays disabled and is not reinstalled" \
  || fail "sync: a disabled plugin stays disabled and is not reinstalled" "rc=$rc $out"

# --- listed and absent: the sync installs it (config.toml has the marketplace, not the plugin) ---
rm -rf "$H/home"; mkdir -p "$H/home"
run codex plugin marketplace add "$MARKET_ROOT" >/dev/null 2>&1
cp "$H/home/config.toml" "$H/market-only.toml"
out="$(TARGETS="$H/want.json" sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ -d "$H/home/plugins/cache/$MKT/$PLUGIN/$VER" ] \
  && pass "sync: a plugin listed in harness-targets.json and absent is installed" \
  || fail "sync: a plugin listed in harness-targets.json and absent is installed" "rc=$rc $out"

# A leftover cache does not register an otherwise absent plugin.
cp "$H/market-only.toml" "$H/home/config.toml"
out="$(TARGETS="$H/want.json" sync "$VER" 2>&1)"; rc=$?
[ "$rc" = 0 ] && grep -Fq "[plugins.\"$PLUGIN@$MKT\"]" "$H/home/config.toml" \
  && pass "sync: registers a listed plugin when a matching cache already exists" \
  || fail "sync: registers a listed plugin when a matching cache already exists" "rc=$rc $out"

# Codex release packages for Buddy and Companion use the shared copy filter.
for PLUGIN in codescout-companion buddy; do
  SOURCE="$MARKET_ROOT/$PLUGIN"
  mkdir -p "$SOURCE/.claude-plugin" "$SOURCE/.buddy" "$SOURCE/.codescout" \
    "$SOURCE/hooks/__pycache__" "$SOURCE/node_modules/ws"
  jq '{name, version, description}' "$ROOT/$PLUGIN/.claude-plugin/plugin.json" > "$SOURCE/.claude-plugin/plugin.json"
  VER="$(jq -r '.version' "$SOURCE/.claude-plugin/plugin.json")"
  TRACE=.buddy/.session-start-trace.log
  printf 'fixture\n' > "$SOURCE/$TRACE"
  printf 'fixture\n' > "$SOURCE/.codescout/local-state"
  printf 'fixture\n' > "$SOURCE/.orphaned_at"
  printf 'fixture\n' > "$SOURCE/hooks/__pycache__/hook.pyc"
  printf 'module.exports = "fixture";\n' > "$SOURCE/node_modules/ws/index.js"
  run codex plugin add "$PLUGIN@$MKT" >/dev/null 2>&1
  CACHE="$H/home/plugins/cache/$MKT/$PLUGIN/$VER"
  [ -f "$CACHE/$TRACE" ] || { fail "$PLUGIN fixture: Codex copies the raw trace" "$CACHE"; print_summary "sync-codex"; exit 1; }

  out="$(sync "$VER" --check 2>&1)"; rc=$?
  [ "$rc" = 1 ] && printf '%s' "$out" | grep -q 'STALE:.*\.buddy/\.session-start-trace\.log' && [ -f "$CACHE/$TRACE" ] \
    && pass "$PLUGIN check: detects the trace in an older cache" \
    || fail "$PLUGIN check: detects the trace in an older cache" "rc=$rc $out"
  out="$(sync "$VER" 2>&1)"; rc=$?
  [ "$rc" = 0 ] && [ ! -e "$CACHE/.buddy" ] && [ ! -e "$CACHE/.codescout" ] \
    && [ ! -e "$CACHE/.orphaned_at" ] && [ ! -e "$CACHE/hooks/__pycache__" ] \
    && [ -f "$SOURCE/$TRACE" ] \
    && pass "$PLUGIN sync: installs the filtered package" \
    || fail "$PLUGIN sync: installs the filtered package" "rc=$rc $out"
  cmp -s "$SOURCE/node_modules/ws/index.js" "$CACHE/node_modules/ws/index.js" \
    && pass "$PLUGIN sync: preserves runtime dependencies" \
    || fail "$PLUGIN sync: preserves runtime dependencies"
  run python3 -c 'import sys,tomllib; assert tomllib.load(open(sys.argv[1],"rb"))["marketplaces"][sys.argv[2]]["source"] == sys.argv[3]' \
      "$H/home/config.toml" "$MKT" "$MARKET_ROOT" \
    && pass "$PLUGIN sync: preserves the registered marketplace source" \
    || fail "$PLUGIN sync: preserves the registered marketplace source"
  printf 'new state\n' >> "$SOURCE/$TRACE"
  out="$(sync "$VER" --check 2>&1)"; rc=$?
  [ "$rc" = 0 ] && [ ! -e "$CACHE/.buddy" ] \
    && pass "$PLUGIN check: a changed source trace leaves the cache current" \
    || fail "$PLUGIN check: a changed source trace leaves the cache current" "rc=$rc $out"
done

print_summary "sync-codex"
