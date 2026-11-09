---
kind: bug
status: fixed
title: buddy's forgot-restore check keys on the retired activate_project tool, so it can never fire
tags:
- buddy
- hooks
- cs-hint
owner: marius
severity: low
opened: 2026-11-04
moved_from: 'codescout:docs/issues/2026-11-04-buddy-forgot-restore-check-keys-on-retired-activate-project.md (catalog id 67ee3305dce3224c), moved 2026-11-09'
unverified: Fixed and tested against recorded-shape events, not a live session. The 0-versus-275 counts are from 2026-11-04 and were not re-run; the mining subagent's zero-delivery scan was not re-checked.
closed: 2026-11-09
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

Applied 2026-11-09: re-keyed, not deleted. The rule (restore home between projects) is still true, and `workspace(action="activate")` is called with foreign paths 275 times in the window the issue measured.

- `buddy/scripts/cs_heuristics.py`: new public `is_workspace_activate(tool_name, tool_input)` is the one definition of "an activation". `_check_forgot_restore` uses it for the current event, and `_log_entry_is_activate` for log records. The log test compares whole `, `-separated parts of the `summarize_args` string, so a path that merely contains `action=activate` cannot match. The hint now reads ``Restore with `workspace(action="activate", path=".")` between projects``.
- `buddy/scripts/hook_helpers.py`: the state tracker that sets `root_cwd` and `cs_active_project` keyed on the same retired name, so it had not run since the rename. The issue did not list it. It now uses `is_workspace_activate`, so both signals update again. Without this, the heuristic fix alone would have fallen back to `event["cwd"]`, which is the CC process directory and often not the project root.

Not changed: `_args_look_like_home` still treats any `path=.` prefix as home, so `path=./sub` counts as a restore. Not measured here.

## Tests added

`buddy/tests/test_cs_heuristics.py`: the five forgot-restore tests now build events and log records from `workspace(action="activate")`; the log records come from the real `summarize_args`, so the test cannot drift from the format the log writes. New: `test_forgot_restore_ignores_workspace_calls_that_are_not_activations` and `test_workspace_status_is_not_an_activation`. The `xfail(strict=True)` mark on the `forgot_restore` case is gone, and its `_TRIGGERS` entry sends a `workspace(activate)` event, so `test_every_tool_a_hint_names_is_a_current_codescout_tool[forgot_restore]` now passes for real.

`buddy/tests/test_hook_helpers.py`: `test_cs_active_project_clears_on_absolute_home_path` moved to `workspace(activate)`. New: `test_first_workspace_activate_sets_root_cwd_from_response` and `test_workspace_status_does_not_touch_cs_active_project`.

Mutation check: making `_log_entry_is_activate` return `True` for every `workspace` record first survived all 40 tests, because the first version of the status test gave the same result with or without the filter. The test was rewritten so a `status` call sits between a restore and a new activation; the mutation then fails exactly that test.

buddy pytest: 550 passed (was 545 passed, 1 xfailed).

## Workarounds

The `workspace` result already carries a note about returning to the home project.

## Resume

Nothing left for this bug. Not verified in a live session: no real `workspace(activate)` event was fed through the installed hook; the tests use recorded-shape events.

## References

- `claude-plugins:044a0d0` `buddy/scripts/cs_heuristics.py` (`_check_forgot_restore`)
- sibling bug `docs/issues/2026-11-04-buddy-native-bash-hint-names-find-symbol-which-no-longer-exists.md` (the native-Bash hint names `find_symbol`)
- `codescout:docs/evals/data/2026-11-04-harness-channel-hints/hint-census/mining-report.md`
