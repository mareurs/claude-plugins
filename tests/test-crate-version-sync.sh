#!/bin/bash
# tests/test-crate-version-sync.sh — a plugin's Rust crate version tracks its plugin.json
#
# session-bridge ships a Rust binary, and `session-bridge --version` prints the crate
# version. The 0.3.0 bump changed plugin.json and not Cargo.toml, so the binary kept
# printing 0.2.0. Two things now keep them equal:
#   - scripts/check-versions.sh reports a MISMATCH when <plugin>/mcp-server/Cargo.toml
#     differs from plugin.json.
#   - run_plugin_build <root> <plugin> <version> writes <version> into Cargo.toml and
#     Cargo.lock BEFORE it builds, so the installed binary carries the new version. A red
#     build restores both files, so a failed release leaves nothing behind.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── crate-version-sync ──"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../scripts/lib-plugin-build.sh"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# make_plugin <root> <plugin-version> <crate-version> <build-exit>
# A plugin "p" with a crate "p-mcp"; its build.sh records the version line it saw.
make_plugin() {
  local root="$1"
  mkdir -p "$root/p/.claude-plugin" "$root/p/mcp-server" "$root/p/scripts"
  printf '{"name":"p","version":"%s"}\n' "$2" > "$root/p/.claude-plugin/plugin.json"
  printf '[package]\nname = "p-mcp"\nversion = "%s"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1" }\n' "$3" > "$root/p/mcp-server/Cargo.toml"
  printf '[[package]]\nname = "other"\nversion = "9.9.9"\n\n[[package]]\nname = "p-mcp"\nversion = "%s"\n' "$3" > "$root/p/mcp-server/Cargo.lock"
  printf '#!/usr/bin/env bash\ngrep -m1 "^version" "%s/p/mcp-server/Cargo.toml" > "%s/seen"\nexit %s\n' "$root" "$root" "$4" > "$root/p/scripts/build.sh"
}

# ── Test 1: check-versions flags a crate that lags plugin.json ──
R1="$SANDBOX/r1"; mkdir -p "$R1/scripts"
cp "$HERE/../scripts/check-versions.sh" "$R1/scripts/"
make_plugin "$R1" 0.3.1 0.2.0 0
OUT=$(bash "$R1/scripts/check-versions.sh" 2>&1); RC=$?
if [ $RC -ne 0 ] && echo "$OUT" | grep -q "MISMATCH: p crate Cargo.toml=0.2.0, plugin.json=0.3.1"; then
  pass "check-versions: lagging crate is a MISMATCH"
else
  fail "check-versions: lagging crate is a MISMATCH" "rc=$RC out=$OUT"
fi

# ── Test 2: check-versions accepts an equal crate ──
R2="$SANDBOX/r2"; mkdir -p "$R2/scripts"
cp "$HERE/../scripts/check-versions.sh" "$R2/scripts/"
make_plugin "$R2" 0.3.1 0.3.1 0
OUT=$(bash "$R2/scripts/check-versions.sh" 2>&1); RC=$?
if [ $RC -eq 0 ] && echo "$OUT" | grep -q "OK: p crate Cargo.toml 0.3.1"; then
  pass "check-versions: equal crate passes"
else
  fail "check-versions: equal crate passes" "rc=$RC out=$OUT"
fi

# ── Test 3: run_plugin_build with a version sets Cargo.toml and Cargo.lock before the build ──
R3="$SANDBOX/r3"; make_plugin "$R3" 0.3.1 0.2.0 0
OUT=$(run_plugin_build "$R3" p 0.3.2 2>&1); RC=$?
SEEN="$(cat "$R3/seen" 2>/dev/null)"
if [ $RC -eq 0 ] \
   && [ "$SEEN" = 'version = "0.3.2"' ] \
   && grep -q '^version = "0.3.2"' "$R3/p/mcp-server/Cargo.toml" \
   && awk '/name = "p-mcp"/{f=1;next} f&&/^version/{print; exit}' "$R3/p/mcp-server/Cargo.lock" | grep -q '"0.3.2"' \
   && awk '/name = "other"/{f=1;next} f&&/^version/{print; exit}' "$R3/p/mcp-server/Cargo.lock" | grep -q '"9.9.9"' \
   && grep -q 'serde = { version = "1" }' "$R3/p/mcp-server/Cargo.toml"; then
  pass "versioned build: build.sh saw the new version; Cargo.toml and own Cargo.lock entry bumped, others untouched"
else
  fail "versioned build: new version written before build" "rc=$RC seen=$SEEN out=$OUT"
fi

# ── Test 4: a red build restores Cargo.toml and Cargo.lock ──
R4="$SANDBOX/r4"; make_plugin "$R4" 0.3.1 0.2.0 1
cp "$R4/p/mcp-server/Cargo.toml" "$SANDBOX/toml.before"; cp "$R4/p/mcp-server/Cargo.lock" "$SANDBOX/lock.before"
OUT=$(run_plugin_build "$R4" p 0.3.2 2>&1); RC=$?
if [ $RC -ne 0 ] \
   && cmp -s "$SANDBOX/toml.before" "$R4/p/mcp-server/Cargo.toml" \
   && cmp -s "$SANDBOX/lock.before" "$R4/p/mcp-server/Cargo.lock"; then
  pass "red build: Cargo.toml and Cargo.lock restored byte-for-byte"
else
  fail "red build: Cargo.toml and Cargo.lock restored" "rc=$RC out=$OUT"
fi

# ── Test 5: without a version argument the manifests are not touched ──
R5="$SANDBOX/r5"; make_plugin "$R5" 0.3.1 0.2.0 0
cp "$R5/p/mcp-server/Cargo.toml" "$SANDBOX/toml5.before"
run_plugin_build "$R5" p >/dev/null 2>&1; RC=$?
if [ $RC -eq 0 ] && cmp -s "$SANDBOX/toml5.before" "$R5/p/mcp-server/Cargo.toml"; then
  pass "no version argument: Cargo.toml untouched"
else
  fail "no version argument: Cargo.toml untouched" "rc=$RC"
fi

# ── Test 6: a plugin with no crate ignores the version argument ──
R6="$SANDBOX/r6"; mkdir -p "$R6/q/scripts"
printf '#!/usr/bin/env bash\nexit 0\n' > "$R6/q/scripts/build.sh"
OUT=$(run_plugin_build "$R6" q 1.0.1 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "no crate: version argument ignored"; else fail "no crate: version argument ignored" "rc=$RC out=$OUT"; fi

# ── Test 7: release.sh hands the new version to run_plugin_build ──
if grep -q '^run_plugin_build "\$REPO_ROOT" "\$PLUGIN" "\$VERSION" || exit 1' "$HERE/../scripts/release.sh"; then
  pass "release.sh passes \$VERSION to run_plugin_build"
else
  fail "release.sh passes \$VERSION to run_plugin_build" "call site not found"
fi

print_summary "crate-version-sync"
