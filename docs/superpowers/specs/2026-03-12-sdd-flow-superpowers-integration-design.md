# SDD-Flow Superpowers Integration Design

**Date:** 2026-03-12
**Status:** Approved
**Feature:** Fix `superpowers:brainstorming` and `superpowers:writing-plans` not triggering in `/sdd-flow`

---

## Problem Statement

`/sdd-flow` references superpowers skills using weak "mindset" language (e.g., "invoke `superpowers:brainstorming` skill mindset") rather than explicit `Skill` tool invocations. As a result:

1. Claude interprets "mindset" as "think like brainstorming" rather than actually loading the skill via the `Skill` tool
2. Phase 2 (IDEATE) runs an ad-hoc exploration instead of the full brainstorming process (Q&A, review loop, design doc)
3. Phase 3 (SPECIFY) runs inline `/specify` logic — no subagent reviewer, no spec review loop
4. Phase 5 (PLAN) produces a plan without the superpowers execution header (`REQUIRED: Use superpowers:subagent-driven-development`), so downstream execution skills never trigger
5. The standalone `/specify` and `/plan` commands have zero superpowers references, but these are rarely used outside sdd-flow

---

## Proposed Solution

Approach 3: **Merge phases — brainstorming produces the SDD spec directly.**

- Replace Phase 2 (IDEATE) + Phase 3 (SPECIFY) with a single phase that invokes `superpowers:brainstorming` via `Skill` tool, passing SDD-specific user preferences (spec location, PRD format template)
- Replace Phase 5 (PLAN) with an explicit `superpowers:writing-plans` `Skill` tool invocation, passing `memory/plans/` as the save location
- SDD continues to own all artifacts (`memory/specs/`, `memory/plans/`) — superpowers owns the process

---

## Design

### Phase Structure

**Before (13 phases):**
```
RESUME → IDEATE ("mindset") → SPECIFY (inline) → Gate1 → WORKTREE → PLAN ("mindset") → Gate2 → IMPLEMENT → DRIFT → REVIEW → Gate3 → DOCUMENT → FINALIZE
```

**After (12 phases — SPECIFY absorbed into IDEATE):**
```
RESUME → IDEATE+SPECIFY (Skill: brainstorming) → Gate1 → WORKTREE → PLAN (Skill: writing-plans) → Gate2 → IMPLEMENT → DRIFT → REVIEW → Gate3 → DOCUMENT → FINALIZE
```

### Preferences Passed to brainstorming

When invoking `superpowers:brainstorming`, sdd-flow passes:

- **Spec save location:** `memory/specs/<feature-name>.md`
- **Format:** SDD PRD template (Changelog, Status, Problem Statement, Proposed Solution, Acceptance Criteria, Technical Approach, Out of Scope, Open Questions)
- **Handoff override:** After Gate 1 approval (not directly to writing-plans — worktree setup comes first)

### Preferences Passed to writing-plans

When invoking `superpowers:writing-plans`, sdd-flow passes:

- **Plan save location:** `memory/plans/<feature-name>/plan.md`
- **Keep execution header:** `REQUIRED: Use superpowers:subagent-driven-development` — this must not be stripped
- **Keep format:** checkbox syntax, bite-sized TDD tasks with code snippets

### Resume Logic

Unchanged. Resume check still looks for `memory/specs/<feature>.md`. If it exists, Phase 2 is skipped. The artifact location is the same as before.

### Gate 1 Position

Unchanged. brainstorming has its own internal spec review loop (subagent reviewer). Gate 1 follows after that loop passes — it is the human approval gate, not the review loop.

---

## Acceptance Criteria

- [ ] `/sdd-flow <feature>` invokes `superpowers:brainstorming` via `Skill` tool in Phase 2
- [ ] brainstorming writes spec to `memory/specs/<feature>.md` (SDD PRD format)
- [ ] Gate 1 appears after brainstorming completes, before worktree setup
- [ ] `/sdd-flow <feature>` invokes `superpowers:writing-plans` via `Skill` tool in Phase 5
- [ ] writing-plans writes plan to `memory/plans/<feature>/plan.md` with execution header intact
- [ ] Resume check still works (detects existing `memory/specs/<feature>.md`)
- [ ] No duplicate Q&A — brainstorming's clarifying questions replace `/specify`'s questions
- [ ] Downstream `subagent-driven-development` triggers correctly from plan execution header

---

## Out of Scope

- Fixing standalone `/specify` and `/plan` commands (rarely used outside sdd-flow)
- Changing any other sdd-flow phases (worktree, implement, drift, review, document, finalize)
- Changing artifact locations (`memory/specs/`, `memory/plans/` stay as-is)
- Changing the superpowers skills themselves

---

## Open Questions

- [ ] Should the design doc that brainstorming produces (at `docs/superpowers/specs/`) also be written, or is the SDD PRD at `memory/specs/` sufficient? (Current decision: SDD PRD only, no duplicate design doc)
