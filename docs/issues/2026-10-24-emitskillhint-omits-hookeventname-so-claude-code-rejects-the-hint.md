---
kind: bug
status: fixed
title: emitSkillHint emits hookSpecificOutput without hookEventName, so Claude Code rejects the reconnaissance and pre-dispatch hints
tags:
- codescout-companion
- hooks
closed: 2026-10-24
opened: 2026-10-24
owner: marius
severity: medium
unverified: 'CLEARED 2026-10-27. Was: the symptom was not re-measured in a live session and no transcript after the fix existed. Searched the transcripts of all three profiles for records after the fix commit: no rejection after it, and both hooks delivered their hint (see § Re-measured). Hits were not separated by profile.'
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

## Re-measured

Re-measured 2026-10-27 over the session transcripts (`*.jsonl`, depth 2) of `~/.claude`, `~/.claude-sdd` and `~/.claude-kat`, using only records stamped after the fix commit `f830803` (2026-10-24 08:07:23 +0300 = 05:07:23Z).

- **Rejections:** the newest `hookSpecificOutput is missing required field "hookEventName"` record is `2026-10-24T04:47:32Z` (session `fe70049e`), before the fix. No such record exists after it.
- **pre-task-hint delivered:** the text `First Agent dispatch this session` arrives as a `hook_success` then a `hook_additional_context` attachment on `PreToolUse` in 5 sessions: `b4955e84`, `16d73c1d`, `3bd8aa82`, `c6de4ba9`, `a2a15b69` (2026-10-24T11:18Z to 2026-10-26T08:05Z).
- **pre-edit-hint delivered:** the text `Before this shape-changing edit` arrives the same way in 5 sessions: `ae62b36c`, `94570bc3`, `c78f48d5`, `8aa89dc1`, `659df92d` (2026-10-24T05:25Z to 2026-10-26T18:58Z). `659df92d` is 18 minutes after the commit.
- **Test:** `bash codescout-companion/hooks/skill-hints.test.sh` passes 8 of 8 today.

Limits: I did not separate the hits by profile, so this does not show the fix in each of the three profiles individually. The hits are counts of sessions, not a rate against the number of hook firings.

## References

- `codescout:docs/usage-reports/2026-10-24-usage-analysis.md` § 2
