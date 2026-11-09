---
kind: bug
status: open
title: companion hooks advertise a Skill tool the cs arm lacks, name tools without their mcp prefix, and teach the acknowledge_risk bypass
tags:
- codescout-companion
- hooks
- cs-hint
owner: marius
opened: 2026-11-09
moved_from: 'codescout:docs/issues/2026-11-09-companion-hooks-advertise-tools-and-skills-the-session-does-not-have.md (catalog id 08eb4c18228dca64), moved 2026-11-09'
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

Not yet located: where the unprefixed tool names and the internal bug ids are composed.

## Evidence

Verified by the codescout controller 2026-11-09: 28 of 28 cs runs have the Skill advert and no Skill tool. The rest is from the audit reports `A.md`, `C.md`, `D.md`, `E.md` under `/home/marius/.claude-kat/jobs/fbe38184/tmp/audit/` (stream event indices there); not re-checked one by one.

## Hypotheses tried

That the unprefixed names cause the Sonnet `No such tool` errors: plausible, not verified.

## Fix

Open. Candidates: compose the skills list and the tool names from the session's actual tool list; do not mention the `acknowledge_risk` bypass in the block text; keep tracker hygiene and internal bug ids out of project sessions that are not the codescout repository. Removing the `acknowledge_risk` route and scoping the hygiene nudge are policy choices.

## Tests added

N/A — not fixed yet.

## Workarounds

None in the harness; the arm could carry the Skill tool, which changes the arm.

## Resume

Start at the lines in Root cause. Check what the SessionStart input or the environment exposes about the session's tools, then decide the policy questions in Fix.

## References

- Codescout memory `research/setup-ab-audit-cs-usage-20261109`.
- `codescout:docs/superpowers/specs/2026-11-09-codescout-changes-from-the-cs-usage-audit.md`, item 5.
