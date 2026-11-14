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
# buddy's SessionStart does nothing, silently, without PyYAML: the installer must say so. A
# stub python3 that cannot import anything stands in for an interpreter without it.
mkdir -p "$SANDBOX/fakebin"
printf '#!/bin/sh\nexit 1\n' > "$SANDBOX/fakebin/python3"
chmod +x "$SANDBOX/fakebin/python3"
if PATH="$SANDBOX/fakebin:$PATH" OPENCODE_CONFIG_DIR="$SANDBOX/nopyyaml" bash "$INSTALLER" --plugins buddy 2>&1 >/dev/null | grep -q 'no PyYAML'; then
  pass "install.sh warns when buddy's Python has no PyYAML"
else fail "install.sh did not warn about a Python without PyYAML"; fi
if bash "$INSTALLER" --definitely-not-a-flag >/dev/null 2>&1; then fail "install.sh accepted an unknown flag (it would install)"
else pass "install.sh rejects unknown flags"; fi
unset OPENCODE_HINT_ECHO_DIR
rm -rf "$SANDBOX" "$SANDBOX.log"

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
