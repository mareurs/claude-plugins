#!/usr/bin/env bash
# Hook fixtures must stay isolated even when TMPDIR is beneath another project.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/hook-fixture-isolation-XXXXXX")" || exit 1
trap 'rm -rf "$T"' EXIT
pass=0
fail=0

for suite in \
  tests/test-cross-platform-hooks.sh \
  tests/test-skill-hints-lib.sh \
  codescout-companion/hooks/constitution-epoch-bump.test.sh \
  tests/test-suspicious-zero-hint.sh \
  codescout-companion/hooks/constitution-brief.test.sh \
  codescout-companion/hooks/constitution-guard.test.sh \
  codescout-companion/hooks/skill-hints.test.sh; do
  name="$(basename "$suite")"
  case_root="$T/$name"
  project="$case_root/ancestor"
  fixture_tmp="$project/tmp"
  mkdir -p "$project/.git" "$fixture_tmp" "$case_root/home" \
    "$case_root/profile" "$case_root/buddy" "$case_root/state"
  log="$case_root/output.log"
  if (
    cd "$project"
    HOME="$case_root/home" CLAUDE_CONFIG_DIR="$case_root/profile" \
      BUDDY_HOME="$case_root/buddy" XDG_STATE_HOME="$case_root/state" \
      CS_TEST_STATE_SANDBOX="$case_root/state" TMPDIR="$fixture_tmp" \
      bash "$ROOT/$suite"
  ) >"$log" 2>&1; then
    pass=$((pass + 1))
    echo "  PASS: $name beneath an enclosing project"
  else
    fail=$((fail + 1))
    echo "  FAIL: $name beneath an enclosing project"
    cat "$log"
  fi

  if [ ! -e "$project/.buddy" ] && [ ! -e "$project/.codescout/constitution-seen" ]; then
    pass=$((pass + 1))
    echo "  PASS: $name left ancestor state untouched"
  else
    fail=$((fail + 1))
    echo "  FAIL: $name wrote state into its ancestor project"
    find "$project/.buddy" -maxdepth 3 -type f -print 2>/dev/null || true
  fi

  if remaining="$(find "$fixture_tmp" -mindepth 1 -maxdepth 1 -print -quit)" && [ -z "$remaining" ]; then
    pass=$((pass + 1))
    echo "  PASS: $name removed its owned fixture directories"
  else
    fail=$((fail + 1))
    echo "  FAIL: $name left owned fixture directories behind"
  fi
done

echo "── hook fixture isolation: $pass passed, $fail failed ──"
[ "$fail" -eq 0 ]
