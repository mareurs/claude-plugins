# SDD-Superpowers Integration: Real Skill Invocation

## Problem

The SDD plugin's `/sdd-flow` skill references superpowers skills and even says "invoke via
the Skill tool" — but Claude never actually calls the Skill tool. The root cause is
**over-specification**: sdd-flow provides detailed format templates, save locations, and
override instructions right next to the invoke instruction. Claude sees a complete recipe
and follows sdd-flow's inline instructions directly, bypassing superpowers' structured
design process, review loops, and — critically — the plan execution header that triggers
downstream skills like `subagent-driven-development`.

The fix requires making sdd-flow a **lean dispatcher** — it should describe *what to do after*
each skill completes, not *what the skill should produce*. When sdd-flow doesn't provide
enough detail to skip the skill, Claude is forced to actually invoke it.

## Chosen Approach

**Superpowers owns the process and creates canonical artifacts. SDD owns governance (gates,
constitutional checks) and maintains copies in `memory/` for its tracking system.**

Each superpowers skill is invoked via a real `Skill()` tool call. After superpowers writes
its artifacts, sdd-flow copies/transforms them into `memory/` so that SDD commands (`/drift`,
`/review`) continue to work unchanged.

## Architecture

### Artifact Inventory

| Artifact | Created by | Location | Purpose |
|----------|-----------|----------|---------|
| Design doc | `superpowers:brainstorming` | `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md` | Rich design (architecture, components, data flow, error handling, testing) |
| SDD spec (PRD) | sdd-flow SPECIFY phase | `memory/specs/<feature>.md` | Governance artifact (status, changelog, acceptance criteria, links to design doc) |
| Implementation plan | `superpowers:writing-plans` | `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` | Bite-sized TDD tasks with code, execution header, review loop |
| SDD plan copy | sdd-flow PLAN phase | `memory/plans/<feature>/plan.md` | Copy for `/drift` and `/review` to read |

### Interception Pattern

Superpowers skills have auto-transition terminal states. sdd-flow must intercept these to
maintain its gate sequence:

| Phase | Skill invoked | Intercept | Reason |
|-------|--------------|-----------|--------|
| IDEATE | `brainstorming` | Block auto-transition to `writing-plans` | Need SPECIFY + Gate 1 first |
| PLAN | `writing-plans` | Block auto-transition to execution | Need Gate 2 first |
| IMPLEMENT | `subagent-driven-dev` or `executing-plans` | Block auto-transition to `finishing-a-development-branch` | Need DRIFT → REVIEW → Gate 3 → DOCUMENT first |
| FINALIZE | `finishing-a-development-branch` | None | Runs to completion |

Interception is achieved through explicit instructions in each phase: "After [skill]
completes, do NOT invoke [next skill]. Return control to sdd-flow."

## Phase-by-Phase Changes

### Phase 2: IDEATE — Real Brainstorming

**Before:** "Invoke `superpowers:brainstorming` skill mindset" + inline Q&A.

**After:**
1. Invoke `Skill("superpowers:brainstorming")` — real Skill tool call
2. Brainstorming runs its full process:
   - Explore project context
   - Clarifying questions (one at a time)
   - Propose 2-3 approaches with trade-offs
   - Present design in sections, get approval per section
   - Write design doc to `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`
   - Spec review loop (subagent reviewer, up to 5 iterations)
   - User reviews written spec
3. **Interception:** "After brainstorming completes, do NOT transition to writing-plans.
   Return to sdd-flow for the SPECIFY phase."

### Phase 3: SPECIFY — Transformation Step

**Before:** Ask 2-5 clarifying questions, write PRD from scratch.

**After:** No new questions. Read the design doc and transform into SDD's PRD format:
1. Read design doc from `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`
2. Create `memory/specs/<feature>.md` with SDD template:
   - **Problem Statement** ← from brainstorming's exploration/context
   - **Proposed Solution** ← from the chosen approach
   - **Acceptance Criteria** ← derived from design's components/requirements (checklist)
   - **Technical Approach** ← from design's architecture section
   - **Out of Scope** ← from brainstorming's scope decisions
   - **Open Questions** ← any unresolved items
   - **Status:** Review
   - **Changelog:** `v1 | [date] | Initial spec | Derived from design doc`
   - **Design Doc:** link back to the superpowers design doc
3. Create/update `memory/FEATURES.md` entry with status `drafting`
4. Present PRD summary to user, proceed to Gate 1

### Gate 1: Spec Approval — No Change

Same as today. Reads from `memory/specs/<feature>.md`. Approval updates status to "Approved."

### Phase 4: Worktree Setup — No Change

Same as today. Offers worktree vs current branch. Invokes
`Skill("superpowers:using-git-worktrees")` if worktree selected (already a real Skill call
in current sdd-flow).

### Phase 5: PLAN — Real Writing-Plans

**Before:** "Invoke `superpowers:writing-plans` mindset for structure" + inline plan writing.

**After:**
1. Invoke `Skill("superpowers:writing-plans")`
2. Writing-plans reads both:
   - The design doc from `docs/superpowers/specs/`
   - The SDD spec from `memory/specs/<feature>.md` (for acceptance criteria)
3. Full process: file structure → bite-sized TDD tasks with code → plan review loop
4. Writes plan to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` with execution header:
   "REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or
   superpowers:executing-plans"
5. **Interception:** "After writing-plans completes, do NOT transition to execution.
   Return to sdd-flow for Gate 2."
6. Copy plan to `memory/plans/<feature>/plan.md`
7. Update `memory/FEATURES.md` entry to status `planned`
8. Proceed to Gate 2

### Gate 2: Plan Approval — No Change

Same as today. Reads from `memory/plans/<feature>/plan.md`.

### Phase 6: IMPLEMENT — Real Execution Skills

**Before:** Offers choice, says "invoke skill" but uses "mindset" language.

**After:**
1. sdd-flow offers strategy choice (subagent-driven vs sequential TDD) — SDD governance
2. **Option A:** Invoke `Skill("superpowers:subagent-driven-development")` — dispatches
   fresh subagent per task, two-stage review (spec compliance + code quality)
3. **Option B:** First invoke `Skill("superpowers:test-driven-development")` to establish
   the test-first discipline, then invoke `Skill("superpowers:executing-plans")` which
   walks through the plan's task list sequentially, applying TDD to each task
4. Invoke `Skill("superpowers:verification-before-completion")` before marking tasks done
5. **Interception:** "After implementation completes, do NOT invoke
   finishing-a-development-branch. Return to sdd-flow for DRIFT phase."
6. Update `memory/FEATURES.md` entry to status `in-progress`

### Phases 7-8: DRIFT + REVIEW — Minimal Changes

- **DRIFT:** No change. Reads from `memory/specs/<feature>.md` — exists from Phase 3.
- **REVIEW:** No change to constitutional review. Optional code quality review becomes a
  real Skill call: `Skill("superpowers:requesting-code-review")`.

### Gate 3 — No Change

Same as today.

### Phase 9: DOCUMENT — No Change

Same as today. Versions spec, updates FEATURES.md, commits ADRs.

### Phase 10: FINALIZE — Real Finishing Skill

Invoke `Skill("superpowers:finishing-a-development-branch")` — real Skill call. No
interception needed — this is the terminal phase.

## What Does NOT Change

- SDD's constitutional articles and governance model
- Gate sequence and approval protocols
- `memory/` directory structure
- `/drift`, `/review`, `/document` commands (they read from `memory/`)
- Hooks (`spec-guard.sh`, `review-guard.sh`, `subagent-inject.sh`)
- FEATURES.md tracking

## Testing Strategy

1. **Dry run with a small feature:** Run `/sdd-flow test-feature` and verify:
   - Brainstorming skill actually loads (check for "Brainstorming Ideas Into Designs" output)
   - Design doc appears in `docs/superpowers/specs/`
   - PRD appears in `memory/specs/` with correct fields and link to design doc
   - Brainstorming does NOT auto-transition to writing-plans
   - After Gate 1, writing-plans skill actually loads
   - Plan appears in `docs/superpowers/plans/` with execution header
   - Plan copy appears in `memory/plans/`
   - Writing-plans does NOT auto-transition to execution
   - After Gate 2, implementation skill actually loads
   - Implementation does NOT auto-transition to finishing-a-development-branch
   - After Gate 3 + DOCUMENT, finishing skill loads and runs to completion

2. **Verify downstream commands:** After flow completes, run `/drift` and `/review` to
   confirm they find artifacts in `memory/` as expected.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Interception instructions ignored by Claude | Superpowers auto-transitions past SDD gates | Use strong, unambiguous language: "CRITICAL: Do NOT invoke..." |
| Brainstorming's design doc format changes | SPECIFY transformation breaks | Keep transformation logic flexible — extract by section heading, not rigid parsing |
| Token cost of loading multiple skills per session | Context window pressure | Each skill loads only when its phase begins — not all at once |
| Plan copy in `memory/plans/` drifts from original | `/drift` checks against stale plan | Copy happens once, right after writing-plans — no ongoing sync needed |
