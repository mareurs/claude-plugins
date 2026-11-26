#!/bin/bash
# tests/test-session-bridge-run-sh.sh — session-bridge/hooks/run.sh stays silent where it must.
# An asyncRewake hook that exits 2 wakes the session with its stderr, so `watch` must exit 0
# without a marker file and on a binary that lacks the watch mode.

source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

RUN_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../session-bridge/hooks" && pwd)/run.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sb-run-sh-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "── session-bridge-run-sh ──"

# fake <help-watch-rc>: write a fake binary that logs its argv.
fake() {
  mkdir -p "$TMP/home/.cargo/bin"
  cat >"$TMP/home/.cargo/bin/session-bridge" <<EOF
#!/bin/sh
echo "\$*" >>"$TMP/calls.log"
if [ "\$1" = help ]; then exit $1; fi
if [ "\$1" = watch ]; then echo "WAKE TEXT" >&2; exit 2; fi
exit 0
EOF
  chmod +x "$TMP/home/.cargo/bin/session-bridge"
  : >"$TMP/calls.log"
}

# run_sh <args>: run run.sh in the sandbox; sets RC, OUT, ERR.
run_sh() {
  RC=0
  env -u CLAUDE_CONFIG_DIR HOME="$TMP/home" "$RUN_SH" "$@" >"$TMP/out" 2>"$TMP/err" || RC=$?
  OUT="$(cat "$TMP/out")"; ERR="$(cat "$TMP/err")"
}

mkdir -p "$TMP/home/.claude"

# (1) no marker: silent, binary never called
fake 0
rm -f "$TMP/home/.claude/session-bridge-wake"
run_sh watch
if [ "$RC" -eq 0 ] && [ -z "$OUT$ERR" ] && [ ! -s "$TMP/calls.log" ]; then
  pass "no marker: exit 0, silent, binary not called"
else fail "no marker" "rc=$RC out=[$OUT] err=[$ERR] calls=[$(cat "$TMP/calls.log")]"; fi

# (2) marker, old binary (help watch exits 2): silent, watch never invoked
touch "$TMP/home/.claude/session-bridge-wake"
fake 2
run_sh watch
if [ "$RC" -eq 0 ] && [ -z "$OUT$ERR" ] && ! grep -qx 'watch' "$TMP/calls.log"; then
  pass "old binary: exit 0, silent, watch not invoked"
else fail "old binary" "rc=$RC out=[$OUT] err=[$ERR] calls=[$(cat "$TMP/calls.log")]"; fi

# (3) marker, new binary: watch runs and its exit code and stderr pass through
fake 0
run_sh watch
if [ "$RC" -eq 2 ] && [ "$ERR" = "WAKE TEXT" ]; then
  pass "new binary: watch exec'd, exit 2 with stderr"
else fail "new binary" "rc=$RC err=[$ERR]"; fi

# (4) other events call `hook <event>`
for ev in session-start prompt post-tool; do
  fake 0
  run_sh "$ev"
  if [ "$RC" -eq 0 ] && grep -qx "hook $ev" "$TMP/calls.log"; then
    pass "$ev calls hook $ev"
  else fail "$ev" "rc=$RC calls=[$(cat "$TMP/calls.log")]"; fi
done

# (5) no binary installed
rm -rf "$TMP/home/.cargo"
for ev in watch prompt; do
  run_sh "$ev"
  if [ "$RC" -eq 0 ] && [ -z "$OUT$ERR" ]; then
    pass "no binary: $ev exits 0"
  else fail "no binary: $ev" "rc=$RC out=[$OUT] err=[$ERR]"; fi
done

# (6) Codex: the same hooks.json runs there, and the binary's default harness is claude. The host is
# the nearest `codex` or `claude` process above run.sh (comm, which is the file name of a script);
# stand-in scripts of those names play the hosts. Bug 2026-11-26 "codex plugin add installs hooks
# that run as harness claude".
mkdir -p "$TMP/bin"
for h in codex claude; do printf '#!/bin/sh\n"$@"\n' >"$TMP/bin/$h"; chmod +x "$TMP/bin/$h"; done
run_under() {  # run_under <codex|claude|none> <run.sh args>: sets RC, OUT, ERR
  local host="$1"; shift; RC=0
  if [ "$host" = none ]; then run_sh "$@"; return; fi
  env -u CLAUDE_CONFIG_DIR HOME="$TMP/home" "$TMP/bin/$host" "$RUN_SH" "$@" >"$TMP/out" 2>"$TMP/err" || RC=$?
  OUT="$(cat "$TMP/out")"; ERR="$(cat "$TMP/err")"
}
for ev in session-start prompt post-tool; do
  fake 0; run_under codex "$ev"
  if [ "$RC" -eq 0 ] && grep -qx "hook $ev --harness codex" "$TMP/calls.log"; then
    pass "under codex, $ev calls hook $ev --harness codex"
  else fail "under codex, $ev" "rc=$RC calls=[$(cat "$TMP/calls.log")]"; fi
  for host in claude none; do
    fake 0; run_under $host "$ev"
    if [ "$RC" -eq 0 ] && grep -qx "hook $ev" "$TMP/calls.log"; then
      pass "control: under $host, $ev still calls hook $ev with no harness flag"
    else fail "control: under $host, $ev" "rc=$RC calls=[$(cat "$TMP/calls.log")]"; fi
  done
done
mkdir -p "$TMP/home/.claude"; touch "$TMP/home/.claude/session-bridge-wake"
fake 0; run_under codex watch
if [ "$RC" -eq 0 ] && [ -z "$OUT$ERR" ] && [ ! -s "$TMP/calls.log" ]; then
  pass "under codex, watch is a silent no-op even with the marker (the binary is not called)"
else fail "under codex, watch" "rc=$RC out=[$OUT] err=[$ERR] calls=[$(cat "$TMP/calls.log")]"; fi
fake 0; run_under claude watch
if [ "$RC" -eq 2 ] && [ "$ERR" = "WAKE TEXT" ]; then
  pass "control: under claude, watch still runs with the marker"
else fail "control: under claude, watch" "rc=$RC err=[$ERR]"; fi

print_summary "session-bridge-run-sh"
