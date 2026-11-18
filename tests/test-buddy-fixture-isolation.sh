#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${BUDDY_TEST_PYTHON:-$(command -v python3 || command -v python || true)}"
if [ -z "$PY" ] || ! "$PY" -m pytest --version >/dev/null 2>&1; then
  echo "SKIP: buddy fixture isolation requires Python with pytest"
  exit 0
fi
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
ANCESTOR="$SCRATCH/enclosing"
mkdir -p "$ANCESTOR/.git" "$SCRATCH/global-buddy" "$SCRATCH/codescout-state"
rc=0
(
  cd "$ROOT/buddy"
  BUDDY_HOME="$SCRATCH/global-buddy" CS_TEST_STATE_SANDBOX="$SCRATCH/codescout-state" XDG_STATE_HOME="$SCRATCH/codescout-state" \
    "$PY" -m pytest tests -q --basetemp "$ANCESTOR/pytest"
) || rc=$?
if ! "$PY" - "$ANCESTOR" <<'PY'
from pathlib import Path
import sys
unexpected=sorted(p.name for p in Path(sys.argv[1]).iterdir() if p.name not in {'.git','pytest'})
assert not unexpected, f"buddy fixtures wrote ancestor state: {unexpected}"
print('PASS: buddy fixtures leave their enclosing project untouched')
PY
then
  rc=1
fi
exit "$rc"
