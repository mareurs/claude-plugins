---
kind: entry
status: open
title: 'Codex on this machine: a plugin add cancels approvals; the repair and the do-not-edit rule'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-linux
---

- Every `codex plugin add` that changes content cancels that plugin's approvals (`trustStatus: modified`, runs fail with `plugin contents changed; hook approval required`; in the one case measured a failing PostToolUse hook did not stop its tool call, PreToolUse guard hooks were not measured). The repair writes the content half of `currentHash` (`declaration/content`) from `hooks/list` into `trusted_content_hash` of each hook-state record. Record, method and backups: codescout memories `codex-hook-content-trust-20261107` and `research/hint-visibility-channels-20261109`, both stored in the sibling `codescout` repo (`/home/marius/work/claude/codescout/.codescout/memories/`), not in this one. Later Codex measurements (stamp hook failure and positional hook keys on 0.167.1, the wake daemon `userAgent` prefix) are in this repo: `research/codex-hook-measurements-20261111`.
- Nothing writes into `~/.codex/plugins/cache/` from this repo's scripts: do not edit files there by hand.

**Valid:** dated 2026-11-09
