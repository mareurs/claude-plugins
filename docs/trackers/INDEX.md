# Trackers — Index

This directory holds active project trackers for the buddy-specialist
introspection-and-rewrite initiative. Each tracker is markdown with a
structured live-state block, a done-condition, body sections, and a
dated history. Promote to codescout artifact (`kind=tracker`) once
`claude-plugins` is registered as an artifact repo.

## Active trackers

| Tracker | Purpose | Status | Blocks / Blocked by |
|---------|---------|:------:|---------------------|
| [buddy-introspection.md](buddy-introspection.md) | Hamsa-lens audit of all 10 buddy specialists. Gap inventory: 6 systemic (S-1..S-6) + 14 unique per-specialist issues + 1 positive pattern + cross-promote table. | open | blocks active-plan |
| [active-plan.md](active-plan.md) | 38-task plan in 4 phases for resolving every issue in buddy-introspection.md and establishing eval grounds. Source of truth for what to do next. | open | blocks eval-bringup; depends on buddy-introspection |
| [eval-bringup.md](eval-bringup.md) | Runtime bringup tracker for the eval harness — env setup, first executions, calibration loop. Subset focus of active-plan Phase 0 (T-6..T-11 specifically). | open | depends on active-plan setup work (T-1..T-5) |

## Relationships

```
buddy-introspection.md   names the gaps  →  feeds  →
                                              active-plan.md (resolves them)  →  spawns  →
                                                                    eval-bringup.md (runs the harness)
```

- **buddy-introspection.md** is the audit — it changes only when a hamsa
  sweep finds new gaps or invalidates old ones (see its § Self-Inspection
  Grounds for triggers).
- **active-plan.md** is the work plan — it changes continuously as tasks
  complete; phase-end is the natural compaction point.
- **eval-bringup.md** is the runbook — it tracks one-time bringup of the
  eval harness; closes when the harness is producing baselines on every PR.

## Conventions

- Tracker files open with a structured **live-state YAML block** (fenced).
- Each tracker has a **Done-condition** section stating when it closes.
- Each tracker has a **History** section with dated entries (most-recent
  first, prepended).
- When a tracker reaches done-condition, set `status: closed` in live-state
  and link forward to whatever supersedes or references it.
- Cross-tracker references use relative markdown links.

## How to add a new tracker

1. Decide if it deserves its own file or belongs as a section in an existing
   tracker. Default to extending an existing one — fewer files, less rot.
2. If a new file is justified: create `docs/trackers/<slug>.md` with title,
   live-state YAML, done-condition, body, history.
3. **Add a row to the table above.** Trackers that aren't indexed are
   invisible.
4. Reference from other trackers if there's a dependency edge.

## See also

- `eval/README.md` — eval harness layout and quick-start
- `buddy/skills/*` — the 10 specialists being audited and rewritten
