---
kind: bug
status: open
title: buddy's forgot-restore check keys on the retired activate_project tool, so it can never fire
tags:
- buddy
- hooks
- cs-hint
owner: marius
severity: low
opened: 2026-11-04
moved_from: 'codescout:docs/issues/2026-11-04-buddy-forgot-restore-check-keys-on-retired-activate-project.md (catalog id 67ee3305dce3224c), moved 2026-11-09'
unverified: The zero deliveries come from a subagent's transcript scan, not re-checked; the rename history was not traced; no fix applied, no test.
---

# BUG: buddy's forgot-restore check keys on the retired activate_project tool, so it can never fire

## Summary

The `buddy` plugin's `cs_heuristics.py` has a check, `_check_forgot_restore`, that warns when an agent activates a foreign project twice without restoring home. It matches the tool name `mcp__codescout__activate_project`. That tool was folded into `workspace(action="activate")`, so the check never matches a call, and its message still tells the agent to run `activate_project('.')`.

## Class fit

In the codescout issue-cluster roster this is `declared-not-wired`: the check is declared in the heuristics list and has tests that feed it an `activate_project` event, but nothing in a current session produces such an event, so the declared guard is never connected to a real call. It differs from the class's other members because the dead link is a tool rename, not a missing registration.

## Symptom (Effect)

- No warning is ever sent for the pattern it was written for (foreign activation without restoring home), although the pattern still exists: `workspace(action="activate")` is called with foreign paths.
- If it did fire, it would tell the agent to call `activate_project('.')`, a tool that does not exist.

## Reproduction

1. Read `claude-plugins:044a0d0` `buddy/scripts/cs_heuristics.py`: `_check_forgot_restore` returns early unless `event["tool_name"] == "mcp__codescout__activate_project"`.
2. Count calls in the codescout checkout's `.codescout/usage.db` (`tool_calls`, 2026-10-05 to 2026-11-04): tool names like `activate_project`: 0. Calls to `workspace` whose input contains `activate`: 275.

## Environment

claude-plugins `buddy` at `044a0d0`; codescout on `experiments` at `4d659fe57`; 2026-11-04. Re-checked 2026-11-09 at `c5113d4`: the tool-name test is still at `buddy/scripts/cs_heuristics.py:125` and the message at `:145`.

## Root cause

The tool was renamed into `workspace` and the heuristic was not updated. Inferred from the two counts and the source; the rename commit was not traced.

## Evidence

- Source read 2026-11-04: the tool-name test and the message text.
- usage.db counts above, run 2026-11-04: 0 and 275.
- A mining subagent's transcript scan found 0 deliveries of this hint and 0 of the ignored-buffer hint (not re-checked here). The same scan could not say why the ignored-buffer check never fires; that is not claimed to be this bug. Report: `codescout:docs/evals/data/2026-11-04-harness-channel-hints/hint-census/mining-report.md`.

## Hypotheses tried

N/A — the counts settle it.

## Fix

Not applied. Either key the check on `mcp__codescout__workspace` with `tool_input.action == "activate"` and update the text, or delete the check. Deleting needs a decision: the hint's rule (restore home between projects) is still true.

## Tests added

N/A — no fix applied. A fix should add a test that feeds the check a recorded `workspace(activate)` event.

The tool-name test from the sibling bug exists since 2026-11-09: `buddy/tests/test_cs_heuristics.py::test_every_tool_a_hint_names_is_a_current_codescout_tool`. Its `forgot_restore` case is marked `xfail(strict=True)`, because this hint names `activate_project`. Either fix first turns `test_each_trigger_fires_a_hint[forgot_restore]` red, because the trigger in `_TRIGGERS` sends `activate_project` and stops firing. A re-key then needs a `workspace(activate)` trigger there; once its hint names only real tools, the strict mark fails the suite until it is removed. A delete removes the `_TRIGGERS` entry, and the marked case goes with it.

## Workarounds

The `workspace` result already carries a note about returning to the home project.

## Resume

1. Decide: re-key to `workspace(action="activate")` or delete.
2. Add the recorded-event test.

## References

- `claude-plugins:044a0d0` `buddy/scripts/cs_heuristics.py` (`_check_forgot_restore`)
- sibling bug `docs/issues/2026-11-04-buddy-native-bash-hint-names-find-symbol-which-no-longer-exists.md` (the native-Bash hint names `find_symbol`)
- `codescout:docs/evals/data/2026-11-04-harness-channel-hints/hint-census/mining-report.md`
