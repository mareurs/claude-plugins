---
kind: bug
status: fixed
title: emitSkillHint emits hookSpecificOutput without hookEventName, so Claude Code rejects the reconnaissance and pre-dispatch hints
tags:
- codescout-companion
- hooks
opened: 2026-10-24
closed: 2026-10-24
owner: marius
severity: medium
unverified: 'The symptom is not re-measured in a live session. Claude Code is the validator, and no transcript after the fix exists yet. Hooks load from the repo working tree, so the fix is live only in a checkout of a branch that holds it.'
---

## Summary

`emitSkillHint` in `codescout-companion/hooks/lib.mjs` (line 161) ends with `emit({ hookSpecificOutput: { additionalContext: hint } })`. It omits `hookEventName`. The three other helpers in the same file (`denyPreToolUse`, `contextPreToolUse`, `contextPostToolUse`) set it. Claude Code validates the field and rejects the output, so the hint never reaches the model.

Found by the codescout 2026-10-24 usage sweep (`codescout:docs/usage-reports/2026-10-24-usage-analysis.md`): across 2026-10-03..10-24 transcripts, Claude Code logged **211 hook-output rejections** ("missing required field hookEventName"): 150 before `edit_code` (`pre-edit-hint.mjs`) and 61 before `Agent` (`pre-task-hint.mjs`).

## Verified

- `grep -n hookEventName codescout-companion/hooks/lib.mjs` → lines 34, 45, 57 only (the three other helpers).
- `emitSkillHint` is called only from `pre-edit-hint.mjs` and `pre-task-hint.mjs`. Both are registered under `PreToolUse` in `codescout-companion/hooks/hooks.json` (re-checked 2026-10-24).
- The 211 count and the split by tool come from the transcript sweep; the installed-cache claim (1.20.19) is from the same sweep and was not re-checked here.

## Effect

The reconnaissance hint before a shape-changing edit and the pre-dispatch hint before a subagent are dead. The `.buddy/<session>/hint-emitted-<topic>` marker file is still written before the emit, so the once-per-session budget is spent on a hint that was never delivered.

## Fix

Fixed 2026-10-24. The last line of `emitSkillHint` now calls `contextPreToolUse(hint)`, which sets `hookEventName: 'PreToolUse'`. The comment above the function records that the helper is PreToolUse-only.

Not done: writing the marker only after the emit succeeds. `emit` writes to stdout and has no success signal, so the marker order stays as it was.

## Tests added

`codescout-companion/hooks/skill-hints.test.sh`: two cases, "pre-task hint names its hook event" and "pre-edit hint names its hook event". Each runs the real hook with a fresh session id and asserts `.hookSpecificOutput.hookEventName == "PreToolUse"`. Before the fix both failed with `got: none`; after it both pass (8 of 8).

The existing substring checks could not see this bug, because the hint text is present with or without the event name.

## References

- `codescout:docs/usage-reports/2026-10-24-usage-analysis.md` § 2
