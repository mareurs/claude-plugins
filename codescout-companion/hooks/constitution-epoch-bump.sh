#!/bin/bash
# PreCompact hook — bumps the per-session constitution epoch so path-scoped
# (constitution-guard.sh) and global (constitution-brief.sh) rules are
# re-surfaced after compaction, since the model's effective context may no
# longer reliably contain a rule it "already saw" pre-compaction.
#
# NOTE: this plan does not depend on PreCompact supporting additionalContext
# or on its output surviving into the post-compaction context — verify
# during implementation whether it does, but the design only needs PreCompact
# to fire reliably before compaction, which is a much weaker assumption.
# See docs/superpowers/specs/2026-07-06-constitution-tracker-design.md
# (codescout repo), "Open items to verify during implementation".

command -v jq &>/dev/null || exit 0

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

[ -z "$SESSION_ID" ] && exit 0
[ -z "$CWD" ] && CWD="$(pwd)"

STATE_DIR="$CWD/.codescout/constitution-seen"
STATE_FILE="$STATE_DIR/$SESSION_ID.json"

# No state file means no constitution rule has fired this session yet —
# nothing to bump.
[ -f "$STATE_FILE" ] || exit 0

STATE=$(cat "$STATE_FILE")
NEW_STATE=$(echo "$STATE" | jq '{epoch: (.epoch + 1), seen_path_rules: [], global_surfaced_epoch: .global_surfaced_epoch}')
echo "$NEW_STATE" > "$STATE_FILE"
exit 0
