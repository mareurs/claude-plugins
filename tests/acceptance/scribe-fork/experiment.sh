#!/usr/bin/env bash
# The message experiment: scenario B, three arms of the hook, N rounds. Costs about 0.35 USD a run.
#
# usage: tests/acceptance/scribe-fork/experiment.sh [rounds] [parallel] [first-round]     (defaults 8, 6 and 1)
# env:   CODESCOUT_BIN (the build that serves get_guide('scribe')), SCRIBE_HOOK (default: the hook of
#        this checkout), ACC_DIR as in run.sh.
# Runs are interleaved (a1 b1 c1 a2 b2 c2 ...) so that a slow hour hits every arm alike.
# Then: python3 tests/acceptance/scribe-fork/table.py $(ls $ACC_DIR/out | sed -n 's/^run\(B[abc][0-9]*\)\.jsonl$/\1/p' | sort)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
rounds="${1:-8}"; par="${2:-6}"; first="${3:-1}"
export SCRIBE_HOOK="${SCRIBE_HOOK:-$here/../../../codescout-companion/hooks/scribe-nudge.mjs}"
for i in $(seq "$first" "$rounds"); do for arm in a b c; do echo "$arm $i"; done; done |
  xargs -P "$par" -L1 bash -c 'CS_SCRIBE_VARIANT="$0" "'"$here"'/run.sh" B "$0$1" >/dev/null 2>&1; echo "done B$0$1"'
