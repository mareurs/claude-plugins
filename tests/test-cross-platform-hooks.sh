#!/usr/bin/env bash
# tests/test-cross-platform-hooks.sh
#
# Smoke test for the hook path/interpreter handling that lets the plugins run on
# Linux, macOS, AND Windows (Git Bash). It exercises:
#   1. the python/python3 interpreter shim
#   2. cygpath -m PLUGIN_ROOT conversion (Git Bash only; self-skips elsewhere)
#   3. buddy statusline.py running via the resolved interpreter + (converted) path
#   4. codescout-companion detect-tools.sh sourcing (runs detect.py via the shim)
#   5. a real buddy hook executing end-to-end via the Node launcher (isolated HOME + CWD)
#   6. .gitattributes doing its job: no CRLF in tracked .sh/.py/.mjs
#
# Runs in tests/run-all.sh on Linux and in CI
# (.github/workflows/cross-platform-hooks.yml) on ubuntu/macos/windows.
# Exit 0 = every check passed or safely skipped.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pass=0
fail=0
ok()   { echo "  PASS: $1"; pass=$((pass + 1)); }
bad()  { echo "  FAIL: $1"; fail=$((fail + 1)); }
skip() { echo "  SKIP: $1"; }

echo "── cross-platform-hooks ($(uname -s)) ──"

# Apply the same cygpath conversion the hooks apply (no-op off Git Bash).
winpath() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# 1. interpreter shim resolves to a runnable Python (the hooks' exact expression)
PYTHON="$(command -v python3 || command -v python || echo python3)"
if "$PYTHON" -c "import sys; sys.exit(0)" 2>/dev/null; then
  ok "python shim resolves to a runnable interpreter ($PYTHON)"
else
  bad "python shim did not resolve to a runnable interpreter (got '$PYTHON')"
fi

# 2. cygpath -m converts the repo root to a native (drive-letter) Windows path
if command -v cygpath >/dev/null 2>&1; then
  conv="$(cygpath -m "$ROOT")"
  case "$conv" in
    [A-Za-z]:/*) ok "cygpath -m yields a Windows path ($conv)" ;;
    *)           bad "cygpath -m did not yield a drive path ($conv)" ;;
  esac
else
  skip "cygpath absent (not Git Bash) — PLUGIN_ROOT conversion is a no-op here"
fi

# 3. buddy statusline.py runs via the resolved interpreter from the (converted) path
SELF="$(winpath "$ROOT/buddy/scripts")"
if printf '%s' '{}' | "$PYTHON" "$SELF/statusline.py" >/dev/null 2>&1; then
  ok "buddy statusline.py runs via resolved interpreter + path"
else
  bad "buddy statusline.py failed via resolved interpreter + path"
fi

# 4. detect-tools.sh sources cleanly (runs detect.py via cygpath + the shim)
if ( CWD="$ROOT"; . "$ROOT/codescout-companion/hooks/detect-tools.sh" ) >/dev/null 2>&1; then
  ok "codescout-companion detect-tools.sh sources + runs detect.py"
else
  bad "codescout-companion detect-tools.sh failed to source"
fi

# 5. a real buddy hook executes end-to-end via the Node launcher → Python
#    dispatcher (the cross-platform path). Proves node resolves a Python
#    interpreter and PLUGIN_ROOT reaches Python's sys.path so the
#    `from scripts...` imports resolve. Node is guaranteed wherever Claude Code
#    runs; if absent here we skip rather than fail.
tmp="$(mktemp -d 2>/dev/null || mktemp -d -t cphooks)"
ev='{"session_id":"ci-smoke","cwd":"'"$tmp"'","tool_name":"Read","tool_input":{},"prompt":"hi"}'
if ! command -v node >/dev/null 2>&1; then
  skip "node absent — buddy launcher end-to-end check requires Node (Claude Code ships it)"
elif printf '%s' "$ev" | HOME="$tmp" node "$ROOT/buddy/hooks/run.mjs" post-tool-use >/dev/null 2>&1; then
  ok "buddy hook runs end-to-end via node launcher → python dispatcher"
else
  bad "buddy hook failed end-to-end via node launcher"
fi
rm -rf "$tmp" 2>/dev/null || true

# 5b. launcher exit-code + interpreter-probe semantics (all require node).
if command -v node >/dev/null 2>&1; then
  LAUNCH="$ROOT/buddy/hooks/run.mjs"

  # (a) the dispatcher actually RAN (side effect written) — not a silent no-op.
  t2="$(mktemp -d 2>/dev/null || mktemp -d -t cphooks)"
  printf '%s' '{"session_id":"cp-se","cwd":"'"$t2"'"}' | node "$LAUNCH" session-start >/dev/null 2>&1
  if [ "$(cat "$t2/.buddy/.current_session_id" 2>/dev/null)" = "cp-se" ]; then
    ok "launcher: dispatcher ran (pointer written)"
  else
    bad "launcher: dispatcher did not write state (silent no-op)"
  fi
  rm -rf "$t2" 2>/dev/null || true

  # (b) an intentional pre-tool-use judge block (exit 2) is forwarded.
  t3="$(mktemp -d 2>/dev/null || mktemp -d -t cphooks)"
  sd="$t3/.buddy/blk"; mkdir -p "$sd"
  now="$(date +%s)"  # verdict must be fresh — should_block filters by a TTL
  printf '{"session_id":"blk","last_updated":%s,"active_verdicts":[{"ts":%s,"verdict":"cs-misuse","severity":"blocking","evidence":"e","correction":"c","affected_tools":["read_file"],"acknowledged":false}]}' "$now" "$now" > "$sd/cs_verdicts.json"
  rc=0
  printf '%s' '{"session_id":"blk","cwd":"'"$t3"'","tool_name":"Read"}' \
    | BUDDY_CS_JUDGE_ENABLED=true BUDDY_JUDGE_BLOCK=true node "$LAUNCH" pre-tool-use >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 2 ] && ok "launcher: forwards intentional block (exit 2)" \
    || bad "launcher: intentional block not forwarded (rc=$rc)"
  rm -rf "$t3" 2>/dev/null || true

  # (c) malformed stdin fails open (exit 0).
  rc=0
  printf 'not json' | node "$LAUNCH" session-start >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 0 ] && ok "launcher: malformed stdin fails open (exit 0)" \
    || bad "launcher: malformed stdin rc=$rc"

  # (d) a nonzero-exiting `python3` (Windows Store-alias-stub analogue) must NOT
  #     disable buddy — the probe skips it and falls through to a real python.
  if command -v python >/dev/null 2>&1; then
    stub="$(mktemp -d 2>/dev/null || mktemp -d -t cpstub)"
    printf '#!/bin/sh\nexit 9009\n' > "$stub/python3"; chmod +x "$stub/python3"
    t4="$(mktemp -d 2>/dev/null || mktemp -d -t cphooks)"
    printf '%s' '{"session_id":"cp-stub","cwd":"'"$t4"'"}' \
      | PATH="$stub:$PATH" node "$LAUNCH" session-start >/dev/null 2>&1
    if [ "$(cat "$t4/.buddy/.current_session_id" 2>/dev/null)" = "cp-stub" ]; then
      ok "launcher: skips a nonzero-exiting python3 stub, uses real python"
    else
      bad "launcher: nonzero python3 stub disabled buddy (probe regression)"
    fi
    rm -rf "$stub" "$t4" 2>/dev/null || true
  else
    skip "no real \`python\` besides python3 — stub-fallthrough check skipped"
  fi
else
  skip "node absent — launcher exit-code/probe checks require Node"
fi

# 6. .gitattributes guard: no CRLF in tracked shell/python scripts. On a Windows
#    checkout this fails loudly if `*.sh text eol=lf` ever stops working.
crlf="$(git -C "$ROOT" grep -lI "$(printf '\r')" -- '*.sh' '*.py' '*.mjs' 2>/dev/null || true)"
if [ -z "$crlf" ]; then
  ok "no CRLF in tracked .sh/.py/.mjs (LF enforced by .gitattributes)"
else
  bad "CRLF found in tracked scripts: $crlf"
fi

echo "── cross-platform-hooks: $pass passed, $fail failed ──"
[ "$fail" -eq 0 ]
