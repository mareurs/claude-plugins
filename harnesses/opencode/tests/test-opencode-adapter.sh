#!/usr/bin/env bash
# harnesses/opencode/tests/test-opencode-adapter.sh — the OpenCode bridges stay wired to the Claude-side hooks
#
# WHY THIS EXISTS
#
# harnesses/opencode/plugins/*.js are bridges, not forks: they translate OpenCode events into the
# stdin/stdout JSON dialect the Claude-side hooks already speak. That coupling is invisible
# to both sides. Rename a field in a hook's lib.mjs, change the shape of a deny payload, or
# move a hook, and a bridge stops enforcing while still exiting cleanly — the silent-no-op
# failure class this repo keeps being bitten by. Nothing else in the suite touches
# harnesses/opencode/.
#
# Also installs into a throwaway config dir and checks every link resolves: an installer
# whose paths drifted installs nothing and reports success.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
H="$ROOT/harnesses/opencode"
INSTALLER="$H/install.sh"
PASS=0; FAIL=0; SKIP=0
pass() { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

echo "── opencode-adapter ──"

if ! command -v node >/dev/null 2>&1; then
  echo "  SKIP: node not found — OpenCode bridges NOT checked"; exit 0
fi

# Every hook a bridge shells out to. If one moves, that bridge stops enforcing and nothing
# fails — so this is an assertion, not a comment.
for h in codescout-companion/hooks/pre-tool-guard.mjs codescout-companion/hooks/cs-liveness.mjs \
         codescout-companion/hooks/lib.mjs codescout-companion/hooks/detect.mjs \
         buddy/hooks/run.mjs buddy/hooks/hook_dispatch.py buddy/scripts/statusline.py; do
  if [ -f "$ROOT/$h" ]; then pass "hook a bridge depends on exists: $h"
  else fail "a bridge calls $h but it is absent"; fi
done

# Syntax, before behaviour: a broken plugin throws inside opencode's loader, and the host's
# own failure mode there is not visible to us.
for f in "$H"/plugins/*.js "$H"/lib/*.mjs "$H"/tui/*/tui.js; do
  [ -f "$f" ] || continue
  if node --check "$f" 2>/dev/null; then pass "parses: ${f#"$ROOT"/}"
  else fail "does not parse: ${f#"$ROOT"/}"; fi
done
if bash -n "$INSTALLER" 2>/dev/null; then pass "install.sh parses"
else fail "install.sh does not parse"; fi
# BSD/macOS sed rejects a command directly before a closing `}` ("extra characters at the end
# of d command"); GNU sed accepts it, even with --posix, so running install.sh on Linux cannot
# catch it. Static check of the single-quoted sed scripts instead.
if grep -nE -- "-e '[^']*[^;{[:space:]]\}'" "$INSTALLER" >/dev/null; then
  fail "install.sh has a sed block closing without ';' (BSD/macOS sed rejects it)"
else pass "install.sh's sed blocks close with ';' (BSD/macOS sed)"; fi

# The installer, for real, into a sandbox: every plugin, skill and command it creates must
# resolve, and --check must agree. A drifted source path fails here, not on a user's machine.
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/oc-install-XXXXXX")"
export OPENCODE_HINT_ECHO_DIR="$SANDBOX/hint-echo-state"
# A bare install is the default set. buddy, statusline and hint-echo are opt-in (buddy runs
# Python on every tool call), and a bare --check must keep passing on such an install.
if OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" >"$SANDBOX.log" 2>&1; then
  extra=""
  for p in buddy statusline hint-echo; do
    for part in "$SANDBOX/plugins/$p.js" "$SANDBOX/plugins/$p-tui"; do
      if [ -e "$part" ] || [ -L "$part" ]; then extra="$extra ${part#"$SANDBOX"/}"; fi
    done
  done
  [ -d "$OPENCODE_HINT_ECHO_DIR" ] && extra="$extra (hint-echo channel dir)"
  if [ -z "$extra" ]; then pass "a bare install leaves the opt-in plugins out"
  else fail "a bare install installed opt-in parts:$extra"; fi
  if OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" --check >/dev/null 2>&1; then pass "a bare --check passes on a default install"
  else fail "a bare --check reports problems on a default install"; fi
else
  fail "a bare install.sh failed in a sandbox:"; sed 's/^/      /' "$SANDBOX.log"
fi
if OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" --plugins all >"$SANDBOX.log" 2>&1; then
  pass "install.sh --plugins all installs into a config dir"
  broken=$(find "$SANDBOX" -xtype l 2>/dev/null)
  if [ -z "$broken" ]; then pass "every installed link resolves"
  else fail "dangling links after install:"; printf '      %s\n' $broken; fi
  n=$(find "$SANDBOX/plugins" -name '*.js' | wc -l)
  [ "$n" -ge 1 ] && pass "plugins installed: $n" || fail "no plugin installed"
  # TUI parts are directory links whose tui.js must resolve: OpenCode loads <dir>/tui.js.
  for p in buddy statusline hint-echo; do
    if [ -f "$SANDBOX/plugins/$p-tui/tui.js" ]; then pass "tui part installed: plugins/$p-tui/tui.js"
    else fail "tui part missing or dangling: plugins/$p-tui/tui.js"; fi
  done
  [ -d "$OPENCODE_HINT_ECHO_DIR" ] && pass "hint-echo channel dir created" || fail "hint-echo channel dir not created"
  # Private: the advisories hold paths, commands and session ids. GNU stat, else BSD stat.
  mode="$(stat -c %a "$OPENCODE_HINT_ECHO_DIR" 2>/dev/null || stat -f %Lp "$OPENCODE_HINT_ECHO_DIR" 2>/dev/null)"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) pass "hint-echo channel dir mode not checked on Windows" ;;
    *) [ "$mode" = "700" ] && pass "hint-echo channel dir is 0700" || fail "hint-echo channel dir mode is $mode, want 700" ;;
  esac
  # buddy's commands: dashed names, the summon fast-path line, no Claude-only leftovers.
  S="$SANDBOX/commands/buddy-summon.md"
  if [ -f "$S" ] && awk '/^---/{n++; next} n==2 && NF {print; exit}' "$S" | grep -qx '/buddy:summon \$ARGUMENTS'; then
    pass "/buddy-summon's first body line is the prompt the summon hook keys on"
  else fail "/buddy-summon lacks its '/buddy:summon \$ARGUMENTS' first line (the hook fast path would never fire)"; fi
  if grep -l '^name: buddy:' "$SANDBOX"/commands/buddy-*.md >/dev/null 2>&1; then fail "a buddy command kept its Claude-only 'name:' key"
  else pass "buddy commands carry no Claude-only 'name:' key"; fi
  if grep -h -o '/buddy:[a-z-]*' "$SANDBOX"/commands/buddy-*.md 2>/dev/null | grep -qv '^/buddy:summon$'; then
    fail "a buddy command still names a /buddy:<cmd> that does not exist on OpenCode"
  else pass "buddy commands reference only /buddy-<cmd> names"; fi
  if [ -e "$SANDBOX/commands/buddy-install.md" ] || [ -e "$SANDBOX/commands/buddy-uninstall.md" ]; then
    fail "buddy's Claude-statusline install/uninstall commands were installed"
  else pass "buddy's Claude-statusline install/uninstall commands are not installed"; fi
  # status/legend are TUI commands (tui/buddy/tui.js); as model commands they would interrupt
  # a busy session and shadow the TUI names.
  if [ -e "$SANDBOX/commands/buddy-status.md" ] || [ -e "$SANDBOX/commands/buddy-legend.md" ]; then
    fail "buddy status/legend were installed as model commands (they are TUI commands)"
  else pass "buddy status/legend are not installed as model commands"; fi
  # Upgrade path: a stale rendered copy of OURS is removed, a user's own file is kept.
  printf 'old\n%s/buddy/scripts\n' "$ROOT" > "$SANDBOX/commands/buddy-status.md"
  printf 'my own legend\n' > "$SANDBOX/commands/buddy-legend.md"
  OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" --plugins buddy >/dev/null 2>&1
  [ -e "$SANDBOX/commands/buddy-status.md" ] && fail "a stale rendered /buddy-status survived a re-install" \
    || pass "a re-install removes a stale rendered /buddy-status"
  [ -e "$SANDBOX/commands/buddy-legend.md" ] && pass "a re-install keeps a user's own buddy-legend.md" \
    || fail "a re-install deleted a buddy-legend.md the installer did not write"
  rm -f "$SANDBOX/commands/buddy-legend.md"
  # The placeholder form only: summon.md's prose names the variable ("does not trust
  # `CLAUDE_PLUGIN_ROOT`") and that is not an unexpanded placeholder.
  if grep -rqF '${CLAUDE_PLUGIN_ROOT' "$SANDBOX/commands" 2>/dev/null; then
    fail "a rendered command still holds an unexpanded \${CLAUDE_PLUGIN_ROOT}"
  else pass "no unexpanded \${CLAUDE_PLUGIN_ROOT} in installed commands"; fi
  if OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" --check --plugins all >/dev/null 2>&1; then pass "install.sh --check --plugins all agrees after install"
  else fail "install.sh --check --plugins all reports problems right after install"; fi
  # A moved repo leaves dangling links; --check must say so (it used to report "present").
  first="$(find "$SANDBOX/plugins" -name '*.js' | head -1)"
  ln -sfn "$SANDBOX/gone.js" "$first"
  if OPENCODE_CONFIG_DIR="$SANDBOX" bash "$INSTALLER" --check --plugins all 2>/dev/null | grep -q DANGLING; then pass "install.sh --check flags a dangling plugin link"
  else fail "install.sh --check missed a dangling plugin link"; fi
else
  fail "install.sh --plugins all failed in a sandbox:"; sed 's/^/      /' "$SANDBOX.log"
fi
# Missing PyYAML disables optional consolidation, not core SessionStart. The warning must
# name the affected feature. A stub python3 makes the installer's import probe fail.
mkdir -p "$SANDBOX/fakebin"
printf '#!/bin/sh\nexit 1\n' > "$SANDBOX/fakebin/python3"
chmod +x "$SANDBOX/fakebin/python3"
if PATH="$SANDBOX/fakebin:$PATH" OPENCODE_CONFIG_DIR="$SANDBOX/nopyyaml" bash "$INSTALLER" --plugins buddy 2>&1 >/dev/null | grep -q 'no PyYAML.*memory consolidation'; then
  pass "install.sh warns when buddy's Python has no PyYAML"
else fail "install.sh did not warn about a Python without PyYAML"; fi
if bash "$INSTALLER" --definitely-not-a-flag >/dev/null 2>&1; then fail "install.sh accepted an unknown flag (it would install)"
else pass "install.sh rejects unknown flags"; fi
unset OPENCODE_HINT_ECHO_DIR
rm -rf "$SANDBOX" "$SANDBOX.log"

# session-bridge needs its Rust binary. The installer must say so when it is missing (warn,
# exit 0, keep the user's own plugins and opencode.json untouched), and stay quiet when
# SESSION_BRIDGE_BIN or PATH provides it. PATH is rebuilt without any dir that already holds a
# session-bridge, so a binary on the developer's machine cannot hide the "missing" case.
SB="$(mktemp -d "${TMPDIR:-/tmp}/oc-sb-XXXXXX")"
CLEAN_PATH=""
IFS=: read -ra _dirs <<<"$PATH"
for d in "${_dirs[@]}"; do [ -x "$d/session-bridge" ] || CLEAN_PATH="${CLEAN_PATH:+$CLEAN_PATH:}$d"; done
mkdir -p "$SB/cfg/plugins"
echo '// user plugin' > "$SB/cfg/plugins/mine.js"
echo '{"provider":{"keep":"me"}}' > "$SB/cfg/opencode.json"
cp "$SB/cfg/opencode.json" "$SB/opencode.json.orig"
if OPENCODE_CONFIG_DIR="$SB/cfg" PATH="$CLEAN_PATH" env -u SESSION_BRIDGE_BIN bash "$INSTALLER" --plugins session-bridge >"$SB/out.log" 2>&1; then
  pass "install.sh session-bridge exits 0 with the binary missing"
else fail "install.sh session-bridge failed with the binary missing"; fi
if grep -q 'session-bridge/scripts/build.sh' "$SB/out.log" && grep -qi 'not found' "$SB/out.log"; then
  pass "install.sh warns about the missing binary and names the build command"
else fail "install.sh did not warn about the missing session-bridge binary"; fi
[ -f "$SB/cfg/plugins/mine.js" ] && [ -L "$SB/cfg/plugins/session-bridge.js" ] \
  && pass "install.sh keeps an unrelated plugin and links session-bridge" \
  || fail "install.sh lost an unrelated plugin or did not link session-bridge"
cmp -s "$SB/cfg/opencode.json" "$SB/opencode.json.orig" && pass "install.sh leaves opencode.json untouched" \
  || fail "install.sh changed opencode.json"
printf '#!/bin/sh\nexit 0\n' > "$SB/fake-sb"; chmod +x "$SB/fake-sb"
OPENCODE_CONFIG_DIR="$SB/cfg" PATH="$CLEAN_PATH" SESSION_BRIDGE_BIN="$SB/fake-sb" bash "$INSTALLER" --plugins session-bridge >"$SB/out2.log" 2>&1
if grep -qi 'not found' "$SB/out2.log"; then fail "install.sh warned although SESSION_BRIDGE_BIN names a binary"
else pass "install.sh stays quiet when SESSION_BRIDGE_BIN names a binary"; fi
if OPENCODE_CONFIG_DIR="$SB/cfg" PATH="$CLEAN_PATH" env -u SESSION_BRIDGE_BIN bash "$INSTALLER" --check --plugins session-bridge 2>&1 | grep -q 'session-bridge binary: missing'; then
  pass "install.sh --check reports a missing binary"
else fail "install.sh --check did not report the missing binary"; fi
# ...and its summary must not then claim everything is present; the exit code stays 0.
chk="$(OPENCODE_CONFIG_DIR="$SB/cfg" PATH="$CLEAN_PATH" env -u SESSION_BRIDGE_BIN bash "$INSTALLER" --check --plugins session-bridge 2>&1)"; rc=$?
last="$(printf '%s\n' "$chk" | tail -1)"
if [ "$rc" -eq 0 ] && printf '%s' "$last" | grep -q 'except the session-bridge binary' && [ "$last" != "all requested components present" ]; then
  pass "install.sh --check summary names the missing binary (exit 0)"
else fail "install.sh --check summary hides the missing binary (rc=$rc): $last"; fi

# build.sh's link step: the binary is linked at ${SESSION_BRIDGE_BIN_DIR:-~/.local/bin}, a path
# no release changes. SB_BUILD_SKIP_CARGO=1 skips test/clippy/install (they are the crate's own
# job); a fake cargo bin dir stands in for the install result. Never the real ~/.local/bin.
BUILD="$ROOT/session-bridge/scripts/build.sh"
mkdir -p "$SB/cargo/bin" "$SB/bindir"
printf '#!/bin/sh\necho v1\n' > "$SB/cargo/bin/session-bridge"; chmod +x "$SB/cargo/bin/session-bridge"
run_build() { SB_BUILD_SKIP_CARGO=1 CARGO_HOME="$SB/cargo" SESSION_BRIDGE_BIN_DIR="$SB/bindir" bash "$BUILD" 2>&1; }
out="$(run_build)"
if [ -x "$SB/bindir/session-bridge" ] && [ "$("$SB/bindir/session-bridge")" = "v1" ] && printf '%s' "$out" | grep -q "$SB/bindir/session-bridge"; then
  pass "build.sh links the binary into SESSION_BRIDGE_BIN_DIR and prints the path"
else fail "build.sh did not link/print the binary path: $out"; fi
printf '#!/bin/sh\necho v2\n' > "$SB/cargo/bin/session-bridge"
out="$(run_build)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(readlink "$SB/bindir/session-bridge")" = "$SB/cargo/bin/session-bridge" ] && [ "$("$SB/bindir/session-bridge" 2>/dev/null)" = "v2" ]; then
  pass "build.sh keeps a link that already points at the cargo binary (idempotent)"
else fail "build.sh failed to re-run over its own link (rc=$rc): $out"; fi
# A symlink pointing anywhere else is not ours: build.sh must refuse, not repoint it.
ln -sfn "$SB/elsewhere" "$SB/bindir/session-bridge"
out="$(run_build)"; rc=$?
if [ "$rc" -ne 0 ] && [ "$(readlink "$SB/bindir/session-bridge")" = "$SB/elsewhere" ] && printf '%s' "$out" | grep -q "refusing"; then
  pass "build.sh refuses to replace a symlink that points somewhere else"
else fail "build.sh repointed or ignored a foreign symlink (rc=$rc): $out"; fi
# A foreign regular file at the link target is the user's own: build.sh must refuse, not replace.
rm -f "$SB/bindir/session-bridge"
echo 'user binary' > "$SB/bindir/session-bridge"
out="$(run_build)"; rc=$?
if [ "$rc" -ne 0 ] && [ "$(cat "$SB/bindir/session-bridge")" = "user binary" ] && printf '%s' "$out" | grep -q "$SB/bindir/session-bridge"; then
  pass "build.sh refuses to overwrite a foreign regular file at the link target"
else fail "build.sh clobbered or ignored a foreign file (rc=$rc): $out"; fi
if bash "$INSTALLER" --help 2>&1 | grep -q "$ROOT/session-bridge/scripts/build.sh"; then pass "install.sh --help prints the resolved build.sh path"
else fail "install.sh --help does not name build.sh"; fi
rm -rf "$SB"

# The behaviour suites, one per bridge. On failure, print the failing cases in full: a
# count alone sends the developer back to re-run node by hand.
for t in "$H"/tests/test-*.mjs; do
  [ -f "$t" ] || continue
  out="$(node "$t" 2>&1)"; rc=$?
  p=$(printf '%s\n' "$out" | grep -c '^  PASS:'); f=$(printf '%s\n' "$out" | grep -c '^  FAIL:')
  PASS=$((PASS+p)); FAIL=$((FAIL+f))
  echo "  ${t#"$ROOT"/}: $p passed, $f failed"
  if [ "$f" -gt 0 ]; then
    printf '%s\n' "$out" | awk '/^  FAIL:/{show=1} /^  PASS:/{show=0} show' | sed 's/^/    /'
  elif [ "$rc" -ne 0 ]; then
    echo "  FAIL: ${t#"$ROOT"/} exited $rc with no FAIL line — it crashed"; FAIL=$((FAIL+1))
    printf '%s\n' "$out" | tail -20 | sed 's/^/      /'
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
