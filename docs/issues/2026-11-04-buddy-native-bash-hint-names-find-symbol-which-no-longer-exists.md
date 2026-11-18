---
kind: bug
status: fixed
title: buddy's native-Bash [cs-hint] tells the agent to use find_symbol, a tool that no longer exists
tags:
- buddy
- hooks
- cs-hint
owner: marius
severity: medium
opened: 2026-11-04
moved_from: 'codescout:docs/issues/2026-11-04-buddy-native-bash-hint-names-find-symbol-which-no-longer-exists.md (catalog id 9419db55285a2f81), moved 2026-11-09'
unverified: "The tool name is fixed with a test. Not re-checked: the delivery count (2,428) and the 491-of-1,350 false-positive figure come from a mining subagent's transcript scan; the false-positive pipelines still fire."
closed: 2026-11-09
---

# BUG: buddy's native-Bash [cs-hint] tells the agent to use find_symbol, a tool that no longer exists

## Summary

The `buddy` plugin's hook `cs_heuristics.py` emits a `[cs-hint]` after a native Bash `cat`/`head`/`tail`/`sed` on a source file. Its text says "Use `read_file` or `find_symbol`". codescout has no `find_symbol` tool; the symbol tool is `symbols`. The hint therefore names a tool the agent cannot call.

## Class fit

In the codescout issue-cluster roster this is `doc-contradicted-by-code`: the hint text is documentation of how to proceed, and the tool list (the code) contradicts it. It differs from the class's usual members because the contradicting text is not a markdown file but a string a hook sends to the model at run time, so no doc-drift check reads it.

## Symptom (Effect)

After a native Bash read of a source file the agent receives: "Use `read_file` or `find_symbol` — Bash on source files bypasses codescout's LSP index." `find_symbol` is not among the codescout tools of the current server (`symbols`, `symbol_at`, `references`, `call_graph`, `grep`, `read_file`, and others). A hint that names an unavailable tool costs the agent a failed lookup or a wrong guess. Under the user-endorsement declaration studied in the hint channel eval (`codescout:docs/evals/harness-channel-hint-authority-preregistration.md`, codescout catalog id `cffe594cbf26fd72`, AM-11) such a hint would be obeyed, not ignored.

## Reproduction

1. Read `claude-plugins:044a0d0` `buddy/scripts/cs_heuristics.py`, function `_check_native_bash_on_source`: it returns the string above when a Bash command matches `\b(cat|head|tail|sed)\b.*?(\S+\.\w+)` and the matched token ends in a source extension.
2. List the tools of a current codescout session: no tool named `find_symbol`.

## Environment

claude-plugins `buddy` at `044a0d0`; codescout on `experiments` at `4d659fe57`; 2026-11-04. Re-checked 2026-11-09 at `c5113d4`: the string is still at `buddy/scripts/cs_heuristics.py:208`.

## Root cause

The hint text was written when the symbol tool had another name and was not updated when the tools were folded into `symbols`. Inferred from the text and the current tool list; the history of the rename was not traced.

## Evidence

- The function body, read 2026-11-04 (`symbols(name="check", include_body=true)` on the file lists the check order; `_check_native_bash_on_source` returns the `find_symbol` string).
- Delivery counts (a mining subagent's scan of 213 top-level transcripts, 2026-11-04, unique attachment uuids): 2,428 deliveries of this hint. Its regex found 604 of 1,350 mappable deliveries starting with `cat`/`sed`/`head`/`tail` on a file and 491 that are pipelines which only end in `head`/`tail`/`sed` (false positives). Not re-checked. Report: `codescout:docs/evals/data/2026-11-04-harness-channel-hints/hint-census/mining-report.md`.

## Hypotheses tried

N/A — the text and the tool list settle it.

## Fix

Applied 2026-11-09: the hint in `_check_native_bash_on_source` (`buddy/scripts/cs_heuristics.py:208`) now reads "Use `read_file` or `symbols` — Bash on source files bypasses codescout's LSP index."

Not changed: the check still fires on pipelines that merely end in `head`/`tail`/`sed` (the subagent's 491 false positives). Narrowing it to a command whose first word reads a file is a separate change, not made here.

## Tests added

`buddy/tests/test_cs_heuristics.py`:

- `test_every_tool_a_hint_names_is_a_current_codescout_tool`, parametrized over one triggering event per check (all six). It takes the identifier after each backtick in the hint and requires it to be in `CODESCOUT_TOOLS`, the codescout server's 21 tools as served on 2026-11-09. Before the fix it failed for `native_bash_on_source` with `['find_symbol']`.
- `test_each_trigger_fires_a_hint` guards it: a trigger that returned None would check nothing.
- `test_native_bash_cat_detected` asserted `"read_file" in result or "find_symbol" in result`, so it passed through `read_file` and never saw the dead name. It now requires both `` `read_file` `` and `` `symbols` ``.
- The `forgot_restore` case is `xfail(strict=True)`: its hint names `activate_project`, and its fix waits on a decision (sibling bug below).

buddy pytest: 545 passed, 1 xfailed.

## Workarounds

None needed on the agent side: `symbols` is in the tool list and `pre-tool-guard` already redirects native reads of source.

## Resume

Nothing left for the tool name. Optional follow-up: narrow the trigger regex (see Fix), then re-count deliveries from transcripts.

## References

- `claude-plugins:044a0d0` `buddy/scripts/cs_heuristics.py` (`_check_native_bash_on_source`)
- `codescout:docs/evals/data/2026-11-04-harness-channel-hints/hint-census/mining-report.md`
- sibling bug `docs/issues/2026-11-04-buddy-forgot-restore-check-keys-on-retired-activate-project.md` (the forgot-restore check keys on the retired `activate_project`)
