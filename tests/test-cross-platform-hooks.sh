#!/usr/bin/env bash
# tests/test-cross-platform-hooks.sh
#
# Smoke test for the hook path/interpreter handling that lets the plugins run on
# Linux, macOS, AND Windows (Git Bash). It exercises:
#   1. the python/python3 interpreter shim
#   2. cygpath -m PLUGIN_ROOT conversion (Git Bash only; self-skips elsewhere)
#   3. buddy statusline.py running via the resolved interpreter + (converted) path
#   4. codescout-companion detect-tools.sh sourcing (runs detect.py via the shim)
#   5. a real buddy hook executing end-to-end (isolated HOME + CWD)
#   6. .gitattributes doing its job: no CRLF in tracked .sh/.py
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

# 5. a real buddy hook executes end-to-end (isolated HOME + CWD — no pollution).
#    Proves the cygpath-converted PLUGIN_ROOT reaches Python's sys.path so the
#    `from scripts...` imports resolve on Windows.
tmp="$(mktemp -d 2>/dev/null || mktemp -d -t cphooks)"
ev='{"session_id":"ci-smoke","cwd":"'"$tmp"'","tool_name":"Read","tool_input":{},"prompt":"hi"}'
if printf '%s' "$ev" | HOME="$tmp" bash "$ROOT/buddy/hooks/post-tool-use.sh" >/dev/null 2>&1; then
  ok "buddy post-tool-use.sh runs end-to-end"
else
  bad "buddy post-tool-use.sh failed end-to-end"
fi
rm -rf "$tmp" 2>/dev/null || true

# 6. .gitattributes guard: no CRLF in tracked shell/python scripts. On a Windows
#    checkout this fails loudly if `*.sh text eol=lf` ever stops working.
crlf="$(git -C "$ROOT" grep -lI "$(printf '\r')" -- '*.sh' '*.py' 2>/dev/null || true)"
if [ -z "$crlf" ]; then
  ok "no CRLF in tracked .sh/.py (LF enforced by .gitattributes)"
else
  bad "CRLF found in tracked scripts: $crlf"
fi

echo "── cross-platform-hooks: $pass passed, $fail failed ──"
[ "$fail" -eq 0 ]
