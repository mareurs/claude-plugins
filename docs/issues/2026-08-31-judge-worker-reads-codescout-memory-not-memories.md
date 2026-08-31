---
kind: bug
status: open
title: judge_worker reads .codescout/memory but the directory is .codescout/memories, so the judge's project constraints are empty on every machine
opened: 2026-08-31
owner: marius
severity: med
---

## Summary

`buddy/scripts/judge_worker.py:92` builds the constraints path as

```python
memory_dir = project_root / ".codescout" / "memory"
```

The directory codescout actually writes is `.codescout/memories` — **plural**. So the
"Load project constraints from codescout memories" block reads `conventions`, `gotchas` and
`architecture` from a path that does not exist, finds nothing, and the judge evaluates every
narrative with an empty constraints list.

This is independent of cwd. It fails on a correctly-resolved project root too, so it is
**not** fixed by
`docs/issues/2026-08-31-buddy-session-dir-treats-cwd-as-project-root.md`.

## Symptom (Effect)

Nothing. That is the whole problem — the loop is

```python
for name in ("conventions", "gotchas", "architecture"):
    mem_file = memory_dir / f"{name}.md"
    if mem_file.exists():
        ...
```

so a missing directory is indistinguishable from a project that simply has no memories. The
judge's prompt is assembled, sent, and returns verdicts that read entirely plausible; they
are just made without the three documents most likely to change them.

## Evidence

Measured on disk, four checkouts, all plural:

```text
/home/marius/work/claude/codescout/.codescout/memories
/home/marius/work/claude/claude-plugins/.codescout/memories
/home/marius/work/claude/prompt-engineering/.codescout/memories
/home/marius/work/claude/changelog-reader/.codescout/memories
```

And the sibling plugin agrees — `codescout-companion/scripts/detect.py:145`:

```python
memories_dir = project_dir / "memories"
```

So `detect.py` and `judge_worker.py` disagree about the name of the same directory, and only
one of them is checked against reality by anything that runs.

Both repos also carry all three files the block wants. codescout's `.codescout/memories/`
holds `conventions`, `gotchas` and `architecture` among 23 topics; this repo's holds them
among 11. The population the fix acts on is non-empty — checked, because a path fix that
turns out to point at an empty directory is a no-op that reports success.

## Root cause

A singular/plural name mismatch, kept invisible by an `exists()` guard on the read side and
by there being no assertion anywhere that the constraints block returns anything.

## Fix

`"memory"` → `"memories"` at `judge_worker.py:92`.

**The test matters more than the fix**, because the one-character change is not what failed —
the absence of any signal that it had failed is. A test asserting the block *doesn't crash*
passes today. The assertion has to be that constraints are **non-empty** for a fixture that
has them, which is the shape that fails in the current world and cannot be satisfied by a
guard that skips.

Worth a second look while in there: `assemble_context` silently degrades on two independent
inputs (this, and the plan at `:82`). If either matters to verdict quality, the judge should
record which context it actually had — a verdict made without constraints is not the same
verdict, and today nothing distinguishes them after the fact.

## Workarounds

None available from outside; symlinking `memory` → `memories` in every project would work
and should not be done.

## References

- `docs/issues/2026-08-31-buddy-session-dir-treats-cwd-as-project-root.md` — the other half
  of the same silent-degradation surface, found in the same scout. That one gives the judge a
  wrong root; this one means the constraints were never loading regardless.
- `codescout-companion/scripts/detect.py:145` — the correct name, in the sibling plugin.
