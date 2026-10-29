#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/wake-discovery-XXXXXX")
mkdir -p "$fixture/tests" "$fixture/scripts" "$fixture/codescout-companion/background-wake/nested"
trap 'rm -rf "$fixture"' EXIT
cp "$root/tests/run-all.sh" "$fixture/tests/run-all.sh"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$fixture/scripts/check-hooks-installed.sh"
printf '%s\n' '#!/usr/bin/env bash' "touch '$fixture/executed'" > "$fixture/tests/test-must-not-run.sh"
sentinel="$fixture/codescout-companion/background-wake/nested/sentinel.test.mjs"
printf '%s\n' 'throw new Error("WAKE_DISCOVERY_SENTINEL");' > "$sentinel"
listing=$(bash "$fixture/tests/run-all.sh" --list)
if [ -e "$fixture/executed" ]; then echo 'FAIL: --list executed a suite instead of listing' >&2; exit 1; fi
case "$listing" in *"$sentinel"*) ;; *) echo 'FAIL: nested background-wake suite is absent from actual runner discovery' >&2; exit 1;; esac
set +e
node "$sentinel" > "$fixture/result" 2>&1
rc=$?
set -e
if [ "$rc" -eq 0 ] || ! grep -q WAKE_DISCOVERY_SENTINEL "$fixture/result"; then echo 'FAIL: sentinel did not execute its deliberate failure' >&2; exit 1; fi
printf '%s\n' 'PASS: actual suite collection reaches nested background-wake tests without recursive runner execution'
