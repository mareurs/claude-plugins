# SDD-Superpowers Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite sdd-flow SKILL.md so that superpowers skills are actually invoked via the Skill tool instead of being bypassed by inline detail.

**Architecture:** Make sdd-flow a lean dispatcher — each phase that invokes a superpowers skill provides only (1) the Skill invocation instruction, (2) interception/override instructions, and (3) post-skill bookkeeping. All format/template detail is removed so Claude must load the actual skill. Add a new SPECIFY phase that transforms brainstorming's design doc into SDD's PRD format.

**Tech Stack:** Markdown (SKILL.md), shell (test scripts)

**Spec:** `docs/superpowers/specs/2026-03-15-sdd-superpowers-integration-design.md`

---

## Chunk 1: Core SKILL.md Rewrite

### Task 1: Rewrite State Machine and Overview

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md:1-80`

The current state machine already has `IDEATE+SPECIFY` as one node. We need to split it into
three nodes: `IDEATE` (brainstorming), `SPECIFY` (transformation), and keep them flowing into
Gate 1. Also update the announcement text and overview.

- [ ] **Step 1: Update the state machine**

Replace the state machine `dot` graph. Key changes:
- Split `IDEATE+SPECIFY` into `IDEATE` and `SPECIFY` as separate nodes
- `IDEATE` label: `"IDEATE\n(Skill: brainstorming)"`
- `SPECIFY` label: `"SPECIFY\n(transform design → PRD)"`
- Flow: `IDEATE -> SPECIFY -> GATE1`
- Resume dialog: `resume at spec` goes to `SPECIFY`, not `IDEATE`
- All other nodes unchanged

- [ ] **Step 2: Update the announcement text**

Change the orchestration line to:
```
IDEATE → SPECIFY → [Gate 1] → WORKTREE → PLAN → [Gate 2] → IMPLEMENT → DRIFT → REVIEW → [Gate 3] → DOCUMENT → FINALIZE
```

- [ ] **Step 3: Verify state machine is valid dot syntax**

Read the file, verify the graph has correct edges and no orphan nodes.

- [ ] **Step 4: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "refactor(sdd-flow): split IDEATE+SPECIFY in state machine"
```

---

### Task 2: Rewrite Phase 2 (IDEATE) as Lean Dispatcher

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` — Phase 2 section (currently lines 122-157)

The current Phase 2 provides detailed format templates, save locations, and overrides that
let Claude skip the brainstorming skill. Replace with a lean dispatcher.

- [ ] **Step 1: Replace Phase 2 content**

Replace the entire "Phase 2: Ideate + Specify (Brainstorming)" section with:

```markdown
## Phase 2: Ideate (Brainstorming)

**Goal:** Explore the feature idea through superpowers' structured design process.

### MANDATORY Skill Invocation

**STOP. You MUST call `Skill("superpowers:brainstorming")` now.**

Do NOT ask clarifying questions yourself. Do NOT write a design doc yourself. Do NOT write
a spec/PRD yourself. Do NOT skip this step. The brainstorming skill has its own structured
process (Q&A, approaches, design sections, review loop) that MUST run. It produces a
**design doc** (not the SDD spec — that comes in the SPECIFY phase).

### Interception Override

When brainstorming reaches its terminal state ("invoke writing-plans"), do NOT invoke
writing-plans. Instead, return to sdd-flow — the SPECIFY phase comes next, then Gate 1,
then worktree setup, and ONLY THEN does planning happen.

### After Brainstorming Completes

Brainstorming will have written a design doc (typically to `docs/superpowers/specs/`).
Note the path — you will need it in the SPECIFY phase.

Proceed to SPECIFY.
```

- [ ] **Step 2: Verify no format templates or PRD structure remain in Phase 2**

Read Phase 2, confirm there are no `## Changelog`, `## Problem Statement`, `## Acceptance Criteria`
templates. The phase should be ~20 lines, not ~35.

- [ ] **Step 3: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "refactor(sdd-flow): make IDEATE a lean brainstorming dispatcher"
```

---

### Task 3: Add New Phase 3 (SPECIFY) — Transformation Step

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` — insert new section after Phase 2

This is a new phase that transforms brainstorming's design doc into SDD's PRD format.

- [ ] **Step 1: Insert Phase 3 after Phase 2**

Add this section after Phase 2 and before Gate 1:

```markdown
## Phase 3: Specify (Transform Design → PRD)

**Goal:** Transform the brainstorming design doc into SDD's governance-ready PRD format.

**Process:**
1. Read the design doc written by brainstorming
2. Create `memory/specs/<feature-name>.md` by extracting and reformatting:
   - **Problem Statement** ← from the design doc's context/exploration
   - **Proposed Solution** ← from the chosen approach
   - **Acceptance Criteria** ← derived from the design's requirements (as checkboxes)
   - **Technical Approach** ← from the design's architecture section
   - **Out of Scope** ← from scope decisions made during brainstorming
   - **Open Questions** ← any unresolved items
   - **Status:** Review
   - **Changelog:** `v1 | [date] | Initial spec | Derived from design doc`
   - **Design Doc:** `[path to design doc]` (link back)
3. Create/update `memory/FEATURES.md` entry with status `drafting`:
   ```
   | [feature-name] | drafting | specs/[feature-name].md | - | - | [date] |
   ```
   If `memory/FEATURES.md` does not exist, create it with:
   ```
   # Feature Registry
   | Feature | Status | Spec | Plan | PR | Date |
   |---------|--------|------|------|----|------|
   ```
4. Present PRD summary to user
5. Proceed to Gate 1

**This phase does NOT ask new questions.** All the hard thinking happened in brainstorming.
This is a transformation step — reshaping the design into SDD's governance format.

**Output:** `memory/specs/<feature-name>.md` (SDD PRD format, Status: Review) + FEATURES.md entry
```

- [ ] **Step 2: Verify SPECIFY is between IDEATE and Gate 1**

Read the file, confirm Phase 2 → Phase 3 → Gate 1 ordering.

- [ ] **Step 3: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "feat(sdd-flow): add SPECIFY transformation phase"
```

---

### Task 4: Renumber Phases and Update Gate 1 References

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` — Gate 1 and subsequent phases

Current: Phase 2 (Ideate+Specify) → Gate 1 → Phase 3 (Worktree) → Phase 4 (Plan) → ...
New: Phase 2 (Ideate) → Phase 3 (Specify) → Gate 1 → Phase 4 (Worktree) → Phase 5 (Plan) → ...

- [ ] **Step 1: Update Gate 1**

Change ALL references from "IDEATE+SPECIFY" in Gate 1:
- Response Handling table: `loop back to IDEATE+SPECIFY` → `loop back to IDEATE`
- On Rejection block: "Returning to IDEATE+SPECIFY phase..." → "Returning to IDEATE phase..."
  (Rejection means re-brainstorm, not just re-transform)

- [ ] **Step 2: Renumber remaining phases**

- Phase 3: Worktree Setup → Phase 4: Worktree Setup
- Phase 4: Plan → Phase 5: Plan
- Phase 5: Implement → Phase 6: Implement
- Phase 6: Drift Check → Phase 7: Drift Check
- Phase 7: Review → Phase 8: Review
- Phase 8: Document → Phase 9: Document
- Phase 9: Finalize → Phase 10: Finalize

- [ ] **Step 3: Update Resume Check validation**

Change "cannot resume past IDEATE+SPECIFY" to "cannot resume past SPECIFY".

Add new validation case for the two-artifact model:
- If design doc exists but no PRD in `memory/specs/`, resume at SPECIFY
- Add "Resume from design doc (re-brainstorm)" option to resume dialog

Update resume dialog text to include design doc:
```
I found existing artifacts for [feature-name]:

Design doc: docs/superpowers/specs/[date]-[feature-name]-design.md (if exists)
Spec: memory/specs/[feature-name].md (Status: [status])
Plan: memory/plans/[feature-name]/plan.md (Status: [status])

How would you like to proceed?
1. Start fresh (archive existing artifacts)
2. Resume from design doc (re-brainstorm and revise)
3. Resume from spec (re-transform design → PRD)
4. Resume from plan (edit and re-approve)
5. Resume implementation (continue from plan)
```

- [ ] **Step 4: Verify all cross-references are consistent**

Search for "IDEATE+SPECIFY" — should not appear anywhere. Search for old phase numbers —
should all be updated.

- [ ] **Step 5: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "refactor(sdd-flow): renumber phases for new SPECIFY phase"
```

---

### Task 5: Rewrite Phase 5 (PLAN) as Lean Dispatcher

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` — Phase 5 (Plan) section

Same pattern as Phase 2: strip inline detail, force Skill invocation.

- [ ] **Step 1: Replace Phase 5 content**

Replace the current Plan phase with:

```markdown
## Phase 5: Plan

**Goal:** Create a detailed implementation plan from the approved spec.

### MANDATORY Skill Invocation

**STOP. You MUST call `Skill("superpowers:writing-plans")` now.**

Do NOT write a plan yourself. Do NOT create task lists yourself. Do NOT skip this step.
The writing-plans skill has its own structured process (file structure mapping, bite-sized
TDD tasks with code, plan review loop) that MUST run.

Point writing-plans to both inputs:
- The SDD spec at `memory/specs/<feature-name>.md` (for acceptance criteria)
- The design doc at `docs/superpowers/specs/YYYY-MM-DD-<feature-name>-design.md` (for architecture)

### Interception Override

When writing-plans reaches its terminal state ("Ready to execute?"), do NOT invoke
subagent-driven-development or executing-plans. Instead, return to sdd-flow — Gate 2
comes next.

### After Writing-Plans Completes

1. Copy the plan to `memory/plans/<feature-name>/plan.md` so `/drift` and `/review` can
   find it
2. Update `memory/FEATURES.md` entry to status `planned`
3. Proceed to Gate 2

**Output:** `memory/plans/<feature-name>/plan.md` (superpowers format with execution header)
```

- [ ] **Step 2: Verify no plan templates or task structures remain**

Read Phase 5, confirm there are no `## Implementation Phases`, `## Testing Approach`,
or detailed plan templates. The phase should be ~25 lines.

- [ ] **Step 3: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "refactor(sdd-flow): make PLAN a lean writing-plans dispatcher"
```

---

### Task 6: Update Phase 6 (IMPLEMENT) — Explicit Skill Invocations

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` — Phase 6 (Implement) section

The implement phase already names the right skills. Changes needed:
1. Add "MANDATORY" language matching the pattern from Phase 2/5
2. Fix Option B: "mindset" → explicit Skill invocation with sequencing
3. Add interception override for finishing-a-development-branch
4. Preserve existing sections: Strategy Selection, Update FEATURES.md, Iron Law, ADR Detection, TDD Violations

**What to keep unchanged:** The Strategy Selection dialog, the Iron Law block, the ADR Detection
section, and the TDD Violations table should all be preserved as-is. Only the Option A, Option B,
and post-options sections change.

- [ ] **Step 1: Update Option A**

Replace the existing Option A section (currently "1. Invoke `superpowers:subagent-driven-development` skill")
with:

```markdown
### Option A: Subagent-Driven Implementation

**STOP. You MUST call `Skill("superpowers:subagent-driven-development")` now.**

Do NOT dispatch subagents yourself. Do NOT create task lists yourself. The skill handles
subagent dispatch, two-stage review (spec compliance + code quality), and task tracking.

Each subagent task follows TDD (RED → GREEN → REFACTOR).
Invoke `superpowers:verification-before-completion` before marking each task done.
```

- [ ] **Step 2: Update Option B**

Replace the current Option B section with:

```markdown
### Option B: Sequential TDD

**STOP. You MUST call `Skill("superpowers:test-driven-development")` first** to establish
the test-first discipline. **Then call `Skill("superpowers:executing-plans")`** which walks
through the plan's task list sequentially, applying TDD to each task.

Do NOT execute plan tasks yourself. Do NOT write code before tests. The skills enforce
the RED-GREEN-REFACTOR cycle.

Invoke `superpowers:verification-before-completion` before marking each task done.
```

- [ ] **Step 3: Add interception override after the ADR Detection section**

Add after ADR Detection and TDD Violations (before Drift Check):

```markdown
### Interception Override

When implementation completes (all tasks done), do NOT invoke
`finishing-a-development-branch`. Instead, return to sdd-flow — DRIFT phase comes next,
then REVIEW, Gate 3, DOCUMENT, and only then FINALIZE.
```

- [ ] **Step 4: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "refactor(sdd-flow): add MANDATORY skill invocation to IMPLEMENT"
```

---

### Task 7: Update Integration Table, Quick Reference, and Constitution Compliance

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` — bottom sections

- [ ] **Step 1: Update Integration Points table**

Split the IDEATE+SPECIFY row into two rows:
- `IDEATE` | `superpowers:brainstorming` | Full design process — Q&A, approaches, design doc, review loop |
- `SPECIFY` | (none — internal transformation) | Transform design doc → SDD PRD in `memory/specs/` |

- [ ] **Step 2: Update Quick Reference table**

Split first row into two. Note: Gate 1 is listed with SPECIFY since it immediately follows:
- `IDEATE` | - | Design doc in `docs/superpowers/specs/` | SPECIFY |
- `SPECIFY` | Gate 1 | `memory/specs/<feature>.md` (PRD) + FEATURES.md entry | WORKTREE_SETUP |

Update subsequent phases to match new numbering (Phase 4 Worktree through Phase 10 Finalize).

- [ ] **Step 3: Update Constitution Compliance table**

Change `IDEATE+SPECIFY phase + Gate 1` to `IDEATE + SPECIFY phases + Gate 1`.

- [ ] **Step 4: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "docs(sdd-flow): update tables for new phase structure"
```

---

### Task 8: Update Error Handling and Resume Check

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` — error handling and resume sections

- [ ] **Step 1: Update Resume Check**

The resume check should also look for design docs in `docs/superpowers/specs/`:

```
5. Check if docs/superpowers/specs/*-<feature-name>-design.md exists
```

Add validation logic for the two-artifact model:
- If design doc exists but no PRD in `memory/specs/`: resume at SPECIFY
- If design doc AND PRD exist but no plan: resume at PLAN (after Gate 1)
- If all three exist: resume at IMPLEMENT

The resume dialog was already updated in Task 4 Step 3. Verify consistency here.

- [ ] **Step 2: Update error references**

Change "Returning to IDEATE+SPECIFY phase..." to "Returning to IDEATE phase..." in all
error handling sections.

- [ ] **Step 3: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "fix(sdd-flow): update resume check and error references"
```

---

### Task 9: Final Review and Verification

- [ ] **Step 1: Read the complete SKILL.md and verify**

Check:
- No remaining "IDEATE+SPECIFY" references
- No remaining "mindset" language
- Phase numbering is sequential (2-10)
- All phases that invoke skills use "MANDATORY" / "STOP. You MUST call" pattern
- Interception overrides present for IDEATE, PLAN, and IMPLEMENT
- FINALIZE phase also uses explicit `Skill("superpowers:finishing-a-development-branch")`
  (no interception needed, but invocation language should be consistent)
- State machine dot graph matches phase structure
- Integration table matches phase structure
- Quick reference table matches phase structure

- [ ] **Step 2: Verify file is valid markdown**

Run: `npx markdownlint sdd/skills/sdd-flow/SKILL.md` (or visual inspection if linter unavailable)

- [ ] **Step 3: Test locally — dry run**

Start a new Claude Code session with SDD plugin loaded. Run `/sdd-flow test-feature` and
observe:
- Does brainstorming skill actually load? (Look for "Brainstorming Ideas Into Designs")
- Does it complete its full process (Q&A, approaches, design doc)?
- Does it NOT auto-transition to writing-plans?
- Does SPECIFY create the PRD from the design doc?
- Does Gate 1 present correctly?

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "fix(sdd-flow): final review fixes"
```
