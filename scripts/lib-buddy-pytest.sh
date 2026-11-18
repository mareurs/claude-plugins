#!/usr/bin/env bash
# scripts/lib-buddy-pytest.sh — release.sh's buddy pytest pre-flight gate.
#
# Source this file, then call:
#   run_buddy_pytest <buddy-dir>
#
# Runner, first found: buddy/.venv/bin/pytest, then `python3 -m pytest` (or
# `python -m pytest`). With neither, prints a SKIPPED line and returns 0 — a
# machine without pytest can still release, but the log says the gate did not
# run. It used to skip without a line whenever the venv was absent, so a release
# could claim "buddy pytest green" having never run it.
#
# Returns pytest's exit status, so under `set -e` a red suite aborts the release.

run_buddy_pytest() {
  local dir="$1"
  if [ -x "$dir/.venv/bin/pytest" ]; then
    echo "▶ tests: buddy pytest (.venv)"; ( cd "$dir" && .venv/bin/pytest tests -q )
    return
  fi
  # No venv: fall back to the system python's pytest. Windows names it `python`.
  local py
  py="$(command -v python3 || command -v python || true)"
  if [ -n "$py" ] && "$py" -m pytest --version >/dev/null 2>&1; then
    echo "▶ tests: buddy pytest ($py -m pytest)"; ( cd "$dir" && "$py" -m pytest tests -q )
    return
  fi
  echo "⚠ tests: buddy pytest SKIPPED — no $dir/.venv and no pytest for python3/python"
}
