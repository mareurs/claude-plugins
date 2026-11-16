#!/usr/bin/env bash
# Build a throwaway git repository for the migrating-trackers evaluation.
# Usage: tracker-migration-fixture.sh <dir>
# Writes only inside <dir>. Refuses a <dir> that exists and is not empty.
# Prints nothing on success.
set -euo pipefail

dir="${1:-}"
if [ -z "$dir" ]; then
  echo "usage: $0 <dir>" >&2
  exit 2
fi
if [ -e "$dir" ] && { [ ! -d "$dir" ] || [ -n "$(ls -A "$dir")" ]; }; then
  echo "refusing: $dir exists and is not an empty directory" >&2
  exit 2
fi

mkdir -p "$dir/docs/trackers" "$dir/docs/augmentations" "$dir/scripts"
cd "$dir"
git init -q -b main

cat > docs/trackers/demo-log.md <<'EOF'
---
kind: tracker
title: Demo log
status: active
---

# Demo log

A small log of findings, used to try a tracker migration.

## Index

| ID | Status | Title |
|---|---|---|
| D-1 | open | first finding |
| D-2 | fixed-verified | second finding |
| D-3 | open | third finding, row only |

## D-1 — first finding

**Status:** open
**Date:** 2026-01-05

The first finding is related to D-2, which fixed part of it.

## D-2 — second finding

**Status:** fixed-verified
**Date:** 2026-01-09

The second finding was fixed and verified.

### D-2b — follow-up

A note that may or may not be a record of its own.

## Template for new entries

Copy this block, give it the next free ID, and fill in the status.
EOF

cat > docs/augmentations/docs-trackers-demo-log.yaml <<'EOF'
prompt: Summarise the open findings of the demo log.
EOF

cat > scripts/demo-reader.json <<'EOF'
{
  "tracker": "docs/trackers/demo-log.md",
  "note": "a script that reads the demo log"
}
EOF

cat > docs/trackers/foo-session-log.md <<'EOF'
---
kind: tracker
title: Foo session log
status: active
---

# Foo session log

## F-1 — x

**Status:** open

A friction note kept by the reconnaissance skill.
EOF

git add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture: demo trackers"
