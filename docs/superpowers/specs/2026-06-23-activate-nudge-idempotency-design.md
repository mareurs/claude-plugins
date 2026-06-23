---
title: activate_project nudge idempotency (+ workspace-gate relax)
date: 2026-06-23
status: draft
topic: activate-nudge-idempotency
---

# `activate_project` over-activation — nudge idempotency + workspace-gate relax

## Problem

A single session issues many `workspace(action="activate")` calls for the **same**
project. Two independent drivers, found by tracing the hooks + transcripts:

1. **Bootstrap nudge over-injection** (this repo). `codescout-companion/hooks/session-start.sh`
   injects the `PROJECT BOOTSTRAP: call workspace(activate) FIRST` message whenever
   `IN_WORKTREE=false && SOURCE != "compact"` — i.e. on **both `startup` and `resume`**, with
   no idempotency. Evidence: the current session shows **12 nudge injections → 1 actual
   activate** (the model self-limits, so the cost today is repeated ~250-char injection, not
   12 calls — but eager models would re-call).

2. **Workspace-gate round-tripping** (codescout, not this repo). codescout's server
   instructions / `get_guide("workspace-state")` say: *"After `workspace(activate,
   path=foreign)`, call `workspace(activate, path=home)` before finishing."* In a cross-repo
   session this re-activates home after every foreign excursion. Evidence: a Jun-13 cross-repo
   session shows **24 activates = 10× `claude-plugins` (home) + 14× `codescout` (foreign)** —
   the dominant source of repeat same-project activation. codescout already supports per-call
   `workspace=<abs path>` pinning ("don't activate"), but the gate wording still pushes the
   activate→re-activate pattern.

## Constraint

codescout runs as a **stdio MCP server** (`codescout start … -`) → per-CC-process. A genuine
resume (new process) starts a fresh server, but a same-process re-attach (`source=resume`,
which CLAUDE.md notes "reuses the old in-memory hook") does not. `activate` is an
orientation/optimization (prewarm LSP, register deps, return hints) — codescout tools
otherwise auto-resolve the project from cwd — so skipping the nudge on resume is an
optimization loss, not a functional break.

## Fix #1 — bootstrap nudge → startup-only (this repo)

In `session-start.sh`, change the bootstrap-block guard:

- From: `[ "$IN_WORKTREE" = "false" ] && [ "$SOURCE" != "compact" ] && [ -n "$CWD" ]`
- To:   `[ "$IN_WORKTREE" = "false" ] && [ "$SOURCE" = "startup" ] && [ -n "$CWD" ]`

Result: nudge fires on `startup` only; suppressed on `resume` and `compact` (compact already
had its own `post_compact` flush block). Update the block comment to state the new contract.

**Out of scope (unchanged):** the worktree activate nudge (separate `IN_WORKTREE=true` block,
carries its own activate to `WT_ROOT`); the `post_compact` flush; onboarding/memory/drift
blocks.

### Testing

`session-start.test.sh` already asserts `startup → nudge` and `compact → suppressed`. Add a
third assertion: **`resume → nudge suppressed`** (`ctx resume` must not contain
`PROJECT BOOTSTRAP`). Run `./tests/run-all.sh`.

## Fix #2 — workspace-gate relax (codescout repo; DRAFT only here)

This is the driver that actually reduces activate-*call* count, but the text lives in the
**codescout** repo — `src/prompts/source.md`, the `## Workspace gate` section (an
`include_str!`'d `server_instructions` surface). **Not committed in this repo's PR.**

**Current wording** (`src/prompts/source.md` § Workspace gate):

```
After workspace(activate, path=foreign), call workspace(activate, path=home)
before finishing the turn. Foreign-project state otherwise leaks.

Parallel subagents on DIFFERENT workspaces: pin each call with
workspace=<abs path>, don't activate. Full rules: get_guide("workspace-state").
```

The lead sentence makes `activate(foreign)` the default mental model and pinning the
exception — so single-agent cross-repo reads do `activate(foreign)` + `activate(home)` per
excursion (10× home re-activates in the observed Jun-13 session).

**Drafted relaxed wording** (promote pinning to the default; reserve activate for genuine
switches):

```
For a foreign repo, prefer per-call pinning: pass workspace=<abs path> — it touches
the other project without moving the shared active state, so there is nothing to
restore. Default for single-agent cross-repo reads AND parallel subagents.

Only workspace(activate, path=foreign) when you must switch the active project for
sustained work; then workspace(activate, path=home) before finishing, or foreign
state leaks. Full rules: get_guide("workspace-state").
```

**Caveats for whoever applies it (codescout side):**
- `source.md` backs `include_str!` constants — after editing, run the prompt-surface
  invariants: `prompt_surfaces_reference_only_real_tools` (no backticked snake_case
  non-tool tokens) and the **size-cap** test. The `## Workspace gate` section has
  previously over-run its cap (issue `2026-05-31-prompt-slice-over-cap-concurrent-commit`),
  so keep the new text ≤ the current length; the draft above is ~6 lines vs the current ~5
  — trim further if the cap test fails.
- `get_guide("workspace-state")` (the full rules) should get the same emphasis shift.
- No `ONBOARDING_VERSION` bump needed (server_instructions-surface-only change, per the
  prior pinning work's note).
## Non-goals

- No change to codescout in this repo / this PR (only a draft for #2).
- No marker-file machinery (startup-only achieves the goal without it — YAGNI).
- No change to worktree or post-compact paths.
