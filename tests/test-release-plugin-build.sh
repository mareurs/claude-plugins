#!/bin/bash
# tests/test-release-plugin-build.sh — scripts/lib-plugin-build.sh and its place in release.sh
#
# A session-bridge release must also build and install the binary its hooks and MCP
# server run (session-bridge/scripts/build.sh: cargo test, clippy, cargo install).
# release.sh step 0.5 does that through run_plugin_build. A plugin without a build
# script must pass through silently, and a red build must stop the release before the
# bump commit, the cache and the install records change.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── release-plugin-build ──"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../scripts/lib-plugin-build.sh"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# add_build <plugin> <exit-code> — a plugin dir whose build.sh leaves a marker and exits
add_build() {
  mkdir -p "$SANDBOX/$1/scripts"
  printf '#!/usr/bin/env bash\necho "BUILD-RAN cwd=$PWD" > "%s/%s.marker"\nexit %s\n' "$SANDBOX" "$1" "$2" > "$SANDBOX/$1/scripts/build.sh"
}

# ── Test 1: no scripts/build.sh → silent success ──
mkdir -p "$SANDBOX/plain"
OUT=$(run_plugin_build "$SANDBOX" plain 2>&1); RC=$?
if [ $RC -eq 0 ] && [ -z "$OUT" ]; then
  pass "no build script: rc 0 and no output"
else
  fail "no build script: rc 0 and no output" "rc=$RC out=$OUT"
fi

# ── Test 2: a green build.sh runs once and is reported ──
add_build green 0
OUT=$(run_plugin_build "$SANDBOX" green 2>&1); RC=$?
if [ $RC -eq 0 ] && [ -f "$SANDBOX/green.marker" ] && echo "$OUT" | grep -q "green built and installed"; then
  pass "green build: build.sh ran, rc 0, reported"
else
  fail "green build: build.sh ran, rc 0, reported" "rc=$RC out=$OUT"
fi

# ── Test 3: a red build.sh fails the gate and says nothing was bumped ──
add_build red 1
OUT=$(run_plugin_build "$SANDBOX" red 2>&1); RC=$?
if [ $RC -ne 0 ] && [ -f "$SANDBOX/red.marker" ] && echo "$OUT" | grep -q "NOT releasing"; then
  pass "red build: build.sh ran, rc nonzero, 'NOT releasing'"
else
  fail "red build: build.sh ran, rc nonzero, 'NOT releasing'" "rc=$RC out=$OUT"
fi

# ── Test 4: the real session-bridge plugin has the script this gate runs ──
if [ -f "$HERE/../session-bridge/scripts/build.sh" ]; then
  pass "session-bridge/scripts/build.sh exists"
else
  fail "session-bridge/scripts/build.sh exists" "missing"
fi

# ── Test 5: release.sh calls the gate, after the pre-flight tests and before the bump ──
REL="$HERE/../scripts/release.sh"
L_PYTEST=$(grep -n '^  run_buddy_pytest buddy' "$REL" | head -1 | cut -d: -f1)
L_BUILD=$(grep -n '^run_plugin_build "\$REPO_ROOT" "\$PLUGIN" "\$VERSION" || exit 1' "$REL" | head -1 | cut -d: -f1)
L_BUMP=$(grep -n '^# 1\. bump version sources' "$REL" | head -1 | cut -d: -f1)
if [ -n "$L_PYTEST" ] && [ -n "$L_BUILD" ] && [ -n "$L_BUMP" ] && [ "$L_PYTEST" -lt "$L_BUILD" ] && [ "$L_BUILD" -lt "$L_BUMP" ]; then
  pass "release.sh runs run_plugin_build after pre-flight and before the version bump"
else
  fail "release.sh runs run_plugin_build after pre-flight and before the version bump" "pytest=$L_PYTEST build=$L_BUILD bump=$L_BUMP"
fi

print_summary "release-plugin-build"
