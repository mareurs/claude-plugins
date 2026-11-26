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

run() { CODEX_HOME="$H/home" "$@"; }
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

if ! command -v codex >/dev/null 2>&1; then
  echo "  SKIP: codex not on PATH; the app-server cases need it"
  print_summary "sync-codex"; exit 0
fi

# --- real codex, scratch home ---
rm -rf "$H/home"; mkdir -p "$H/home"
run codex plugin marketplace add "$ROOT" >/dev/null 2>&1
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

# content-only change: the approval is renewed
echo "# change" >> "$CACHE/scripts/cs_tool_log.py"
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
echo "# change 2" >> "$CACHE/scripts/cs_tool_log.py"
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

print_summary "sync-codex"
