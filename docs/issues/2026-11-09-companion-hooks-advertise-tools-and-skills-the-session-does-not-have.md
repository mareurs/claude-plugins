---
kind: bug
status: mitigated
title: companion hooks advertise a Skill tool the cs arm lacks, name tools without their mcp prefix, and teach the acknowledge_risk bypass
tags:
- codescout-companion
- hooks
- cs-hint
owner: marius
opened: 2026-11-09
moved_from: 'codescout:docs/issues/2026-11-09-companion-hooks-advertise-tools-and-skills-the-session-does-not-have.md (catalog id 08eb4c18228dca64), moved 2026-11-09'
closed: 2026-11-09
---

## Summary

The codescout-companion hooks advertise capabilities the cs arm of the Setup A/B study does not have, and name tools in a form the model cannot call. Verified on all 28 cs runs in `study/runs`: the session-start hook prints `SKILLS AVAILABLE: - Reconnaissance — Skill('codescout-companion:reconnaissance')` (stream line 1 of `astral-sh__ruff-15309.claude-opus-5-5.cs.0`), while the `init` tool list of every cs run has no `Skill` tool (`arms.NATIVE_TOOLS` plus the MCP tools; `Skill` and `Agent` are added only for the full arm, `arms.FULL_ONLY_TOOLS`; `arms` is `codescout:tools/setup-ab-eval/arms.py`). Also reported by the audit, each with an event index in its report: hook block text writes tool names without the `mcp__codescout__` prefix, and 18 `No such tool available` errors followed (14 in full-arm Sonnet runs, 3 in cs-arm Sonnet runs, 1 in a full-arm Opus run); the block text tells the agent that `run_command` "reaches the same file with `acknowledge_risk: true`"; the SessionStart hook prints "TRACKER HYGIENE: sweep overdue" in all 24 cs-p cs/full runs; `[cs-hint]` messages cite internal bug ids (BUG-021, BUG-027); a guard footer says "ask the user to run /mcp" in headless runs.

## Class fit

The hook builds its next-step advice from its own tables (which skills exist, which tools are called what) and never from the tool list of the session it speaks to. In the codescout issue-cluster roster this is class `IC-22`, a hint composed from the response shape and not from the request. This member differs from the class's tool-reply members: the hint is composed at session start, in this repository, before any request exists, so the missing input is the session's capability set.

## Symptom (Effect)

Wasted turns: each `No such tool available` call costs one model turn on a 30 to 43 thousand token prefix. An instruction the agent cannot follow (`Skill(...)` with no Skill tool) is noise in the first turn of every cs run. The `acknowledge_risk` advice teaches the bypass of the guard it comes from (nushell opus full, stream line 30: `cat column.rs` with `acknowledge_risk: true`).

## Reproduction

Read `init.tools` and the first hook event of any cs run in `/home/marius/work/claude/setup-ab-data/study/runs/*.cs.*/stream.jsonl`.

## Environment

codescout-companion plugin as installed for the study (`manifest["plugins_cs"]`), Claude Code 2.1.309, arm `cs` (`--tools Bash,Read,Write,Edit,Glob,Grep`).

## Root cause

Located 2026-11-09 at `c5113d4` (read, not yet changed):

- `codescout-companion/hooks/session-start.mjs:207` appends the `SKILLS AVAILABLE:` block unconditionally. Nothing above it reads the session's tool list.
- `codescout-companion/hooks/session-start.mjs:213-222` prints `TRACKER HYGIENE: sweep overdue` whenever `<cwd>/docs/trackers/tracker-hygiene-log.md` exists and its `next-sweep-due:` date has passed. It does not check which repository the session is in.
- `codescout-companion/hooks/pre-tool-guard.mjs:90` and `:197` put the `acknowledge_risk: true` route into the block text.

Located later the same day: the internal bug ids are composed in `buddy/scripts/cs_heuristics.py` (the `[cs-hint]` texts), not in the companion. Not located as one place: the unprefixed tool names, which appear in many hook texts.

## Evidence

Verified by the codescout controller 2026-11-09: 28 of 28 cs runs have the Skill advert and no Skill tool. The rest is from the audit reports `A.md`, `C.md`, `D.md`, `E.md` under `/home/marius/.claude-kat/jobs/fbe38184/tmp/audit/` (stream event indices there); not re-checked one by one.

## Hypotheses tried

That the unprefixed names cause the Sonnet `No such tool` errors: plausible, not verified.

## Fix

Applied 2026-11-09, in three parts. Status `mitigated`, not `fixed`: two items are left on purpose (below).

1. **Skills block** (`codescout-companion/hooks/session-start.mjs`, `lib.mjs`). The hook now omits `SKILLS AVAILABLE` when the Claude process's own argv proves there is no `Skill` tool: `--tools` given and its list neither names `Skill` nor is `default`. `skillToolAbsentFromArgv` (pure, in `lib.mjs`) parses the argv; `sessionMayHaveSkillTool` reads `/proc/<claude pid>/cmdline` on Linux. Anything else (no flag, no Claude process found, unreadable argv, another OS) keeps the block, as before. `--disallowedTools` is not read, because whether it removes the tool from the model's list, rather than only denying the call, was not checked. The `--tools` semantics (comma or space list, `""` for none, `default`) come from `claude --help` on this machine; the flag format of the study's cs arm is taken from this issue's text, not from a real run.
2. **Internal bug ids** are not in the companion. They were in two `[cs-hint]` texts in `buddy/scripts/cs_heuristics.py` (`BUG-027` on the structural-edit hint, `BUG-021` on the parallel-write hint). Removed; the two tests that asserted the ids now assert their absence.
3. **The `acknowledge_risk` route** (`pre-tool-guard.mjs`, `ESCAPE_FOOTER`). Kept, because it is the documented rescue for a session that exposes only a subset of codescout's tools (codescout `docs/issues/2026-09-07-the-source-redirect-names-tools-a-partial-tool-set-does-not-have.md`, pinned by `escape-footer-names-a-partial-set-route`). The footer now says it is for a tool that is missing, and sends a session whose named tool IS present back to that tool. The stand-down message after three strikes is unchanged.

**Not changed, on purpose:**

- The `TRACKER HYGIENE` nudge. It is a designed feature with six tests (`session-start.test.sh`), and it fires only when `<cwd>/docs/trackers/tracker-hygiene-log.md` exists and is overdue. In the study it fired because the runs started in a checkout that has that ledger. Scoping it to one repository would change the feature for every project that uses it.
- Tool names without the `mcp__codescout__` prefix. That they cause the 18 `No such tool available` errors is still only plausible (see Hypotheses), and the names appear in many hook texts. No change without a measurement that links the two.
- The `/mcp` advice in the footer for headless runs.

## Tests added

`codescout-companion/hooks/session-start.test.sh` (34 tests before, 46 after): nine cases on `skillToolAbsentFromArgv` (no flag, a list without `Skill`, a list with it, `--tools=`, space-separated values ending at the next flag, `""`, `default`, a flag with no value, `--disallowedTools` not read), and three integration cases that run the hook under a process whose comm is `claude` with `--tools` set. A fourth check fails the fixture if the hook emitted nothing, so the omission cannot pass on a hook that never ran. Mutations: removing the `default` branch fails its case; making `sessionMayHaveSkillTool` always answer `true` fails the integration case.

`codescout-companion/hooks/pre-tool-guard.test.sh` (85 before, 86 after): `escape-footer-route-is-for-a-missing-tool-only`. Failed before the text change.

`buddy/tests/test_cs_heuristics.py`: the two bug-id assertions inverted; both failed before the change.

## Workarounds

None in the harness; the arm could carry the Skill tool, which changes the arm.

## Resume

Open items, if wanted: (a) a measurement of whether bare tool names cause `No such tool available`; (b) a decision on scoping the hygiene nudge. Not verified in a real cs-arm run: the new omission was tested with fabricated argv and a fake `claude` process.

## References

- Codescout memory `research/setup-ab-audit-cs-usage-20261109`.
- `codescout:docs/superpowers/specs/2026-11-09-codescout-changes-from-the-cs-usage-audit.md`, item 5.
