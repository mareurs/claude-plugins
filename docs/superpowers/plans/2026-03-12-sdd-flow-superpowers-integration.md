# SDD-Flow Superpowers Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `sdd/skills/sdd-flow/SKILL.md` so `superpowers:brainstorming` and `superpowers:writing-plans` are explicitly invoked via Skill tool instead of referenced as "mindsets".

**Architecture:** Six surgical edits to a single markdown file. Phase 2 (IDEATE) absorbs Phase 3 (SPECIFY) and becomes an explicit Skill invocation with SDD preferences. Phase 5 (PLAN) becomes an explicit Skill invocation with `memory/plans/` preference. State machine, announcement text, and reference tables updated to match.

**Tech Stack:** Markdown editing only. No code, no tests, no dependencies.

**Spec:** `docs/superpowers/specs/2026-03-12-sdd-flow-superpowers-integration-design.md`

---

## Chunk 1: Core phase changes

### Task 1: Fix announcement text

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md:23`

- [ ] **Step 1: Verify old text is present**

Run: `grep -n "IDEATE → SPECIFY" sdd/skills/sdd-flow/SKILL.md`
Expected: line 23 matches

- [ ] **Step 2: Edit announcement line**

In `sdd/skills/sdd-flow/SKILL.md`, replace:
```
This orchestrates: IDEATE → SPECIFY → [Gate 1] → WORKTREE_SETUP → PLAN → [Gate 2] → IMPLEMENT → DRIFT → REVIEW → [Gate 3] → DOCUMENT → FINALIZE
```
With:
```
This orchestrates: IDEATE+SPECIFY → [Gate 1] → WORKTREE_SETUP → PLAN → [Gate 2] → IMPLEMENT → DRIFT → REVIEW → [Gate 3] → DOCUMENT → FINALIZE
```

- [ ] **Step 3: Verify**

Run: `grep -n "IDEATE+SPECIFY" sdd/skills/sdd-flow/SKILL.md`
Expected: line 23 matches

- [ ] **Step 4: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "fix(sdd-flow): remove SPECIFY from announcement phase list"
```

---

### Task 2: Fix state machine digraph

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md:38-65`

- [ ] **Step 1: Verify old SPECIFY node is present**

Run: `grep -n "SPECIFY" sdd/skills/sdd-flow/SKILL.md | head -20`
Expected: multiple hits in the digraph block (lines ~39, 42, 58, 61, 62, 64)

- [ ] **Step 2: Edit the digraph block**

Replace the entire digraph node definitions and edges block:
```dot
    IDEATE [label="IDEATE\n(brainstorming)"];
    SPECIFY [label="SPECIFY\n(/specify + changelog)"];
    GATE1 [shape=diamond, label="Gate 1\nSpec Approval"];
    WORKTREE_SETUP [label="WORKTREE_SETUP\n(worktree or branch)"];
    PLAN [label="PLAN\n(/plan)"];
```
With:
```dot
    IDEATE [label="IDEATE+SPECIFY\n(Skill: brainstorming)"];
    GATE1 [shape=diamond, label="Gate 1\nSpec Approval"];
    WORKTREE_SETUP [label="WORKTREE_SETUP\n(worktree or branch)"];
    PLAN [label="PLAN\n(Skill: writing-plans)"];
```

Then replace the edges:
```dot
    RESUME_DIALOG -> SPECIFY [label="resume at spec"];
    IDEATE -> SPECIFY;
    SPECIFY -> GATE1;
    GATE1 -> WORKTREE_SETUP [label="approved"];
    GATE1 -> SPECIFY [label="rejected\n(bump changelog)"];
```
With:
```dot
    RESUME_DIALOG -> IDEATE [label="resume at spec"];
    IDEATE -> GATE1;
    GATE1 -> WORKTREE_SETUP [label="approved"];
    GATE1 -> IDEATE [label="rejected\n(bump changelog)"];
```

- [ ] **Step 3: Verify SPECIFY is gone from digraph**

Run: `grep -n "SPECIFY" sdd/skills/sdd-flow/SKILL.md`
Expected: zero results

- [ ] **Step 4: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "fix(sdd-flow): remove SPECIFY node from state machine, merge into IDEATE"
```

---

### Task 3: Rewrite Phase 2 (IDEATE) — replace "mindset" with explicit Skill invocation

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md:124-138`

- [ ] **Step 1: Verify old Phase 2 text**

Run: `grep -n "skill mindset" sdd/skills/sdd-flow/SKILL.md`
Expected: line ~129 matches "Invoke \`superpowers:brainstorming\` skill mindset"

- [ ] **Step 2: Replace Phase 2 section content**

Replace:
```markdown
## Phase 2: Ideate (Brainstorming)

**Goal:** Explore the feature idea before formalizing.

**Process:**
1. Invoke `superpowers:brainstorming` skill mindset
2. Ask discovery questions:
   - What problem does this solve?
   - Who is the user?
   - What's the minimal viable version?
   - What's explicitly out of scope?
3. Synthesize understanding before proceeding to SPECIFY

**Output:** Clear understanding, ready to write spec
```
With:
```markdown
## Phase 2: Ideate + Specify (Brainstorming)

**Goal:** Explore the feature idea and produce the SDD spec through the full brainstorming process.

**Process:**
1. Invoke `superpowers:brainstorming` via the Skill tool with these user preferences:
   - **Spec save location:** `memory/specs/<feature-name>.md`
   - **Format:** SDD PRD template — must include these sections:
     ```
     ## Changelog
     | Version | Date | Change | Reason |
     **Status:** Draft | Review | Approved
     ## Problem Statement
     ## Proposed Solution
     ## Acceptance Criteria (checkboxes)
     ## Technical Approach
     ## Out of Scope
     ## Open Questions
     ```
   - **Handoff override:** After the spec review loop passes, do NOT invoke `writing-plans` directly — present Gate 1 instead (worktree setup comes before planning)
2. Brainstorming runs its full process: clarifying Q&A, 2-3 approaches, design sections, spec review loop
3. After brainstorming completes and spec is saved to `memory/specs/<feature-name>.md`:
   - Add an entry to `memory/FEATURES.md` with status `drafting`:
     ```
     | [feature-name] | drafting | specs/[feature-name].md | - | - | [date] |
     ```
   - If `memory/FEATURES.md` does not exist, create it with the header:
     ```
     # Feature Registry
     | Feature | Status | Spec | Plan | PR | Date |
     |---------|--------|------|------|----|------|
     ```
4. Present Gate 1

**Output:** `memory/specs/<feature-name>.md` (SDD PRD format, Status: Review) + FEATURES.md entry
```

- [ ] **Step 3: Verify new text is present**

Run: `grep -n "Skill tool with these user preferences" sdd/skills/sdd-flow/SKILL.md`
Expected: one match in Phase 2 section

Run: `grep -n "skill mindset" sdd/skills/sdd-flow/SKILL.md`
Expected: zero results

- [ ] **Step 4: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "fix(sdd-flow): replace brainstorming mindset with explicit Skill invocation + SDD preferences"
```

---

### Task 4: Remove Phase 3 (SPECIFY) section

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md:141-178`

- [ ] **Step 1: Verify Phase 3 section exists**

Run: `grep -n "## Phase 3: Specify" sdd/skills/sdd-flow/SKILL.md`
Expected: one match

- [ ] **Step 2: Delete Phase 3 section**

Remove the entire block from `## Phase 3: Specify` through the closing `---` (inclusive), up to but not including `## Gate 1: Spec Approval`.

The block to remove:
```markdown
## Phase 3: Specify

**Goal:** Create a formal specification with changelog tracking.

**Process:**
1. Execute `/specify <feature-name>` logic inline:
   - Ask 2-5 clarifying questions
   - Generate PRD at `memory/specs/<feature-name>.md`
   - Include: Problem, Solution, Acceptance Criteria, Out of Scope
   - Include a **changelog table** at the top of the spec:

```markdown
## Changelog
| Version | Date | Change | Reason |
|---------|------|--------|--------|
| v1 | [date] | Initial spec | Created via /sdd-flow |
```

2. Add an entry to `memory/FEATURES.md` with status `drafting`:

```markdown
| [feature-name] | drafting | specs/[feature-name].md | - | - | [date] |
```

If `memory/FEATURES.md` does not exist, create it with the header:

```markdown
# Feature Registry

| Feature | Status | Spec | Plan | PR | Date |
|---------|--------|------|------|----|------|
```

3. Present spec summary to user

**Output:** `memory/specs/<feature-name>.md` with Status: Review, changelog table, and FEATURES.md entry

---
```

- [ ] **Step 3: Verify Phase 3 is gone**

Run: `grep -n "## Phase 3" sdd/skills/sdd-flow/SKILL.md`
Expected: zero results

Run: `grep -n "Execute \`/specify" sdd/skills/sdd-flow/SKILL.md`
Expected: zero results

- [ ] **Step 4: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "fix(sdd-flow): remove inline SPECIFY phase, absorbed by brainstorming"
```

---

### Task 5: Rewrite Phase 5 (PLAN) — replace "mindset" with explicit Skill invocation

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` (Phase 5 section, ~line 264 after prior edits)

- [ ] **Step 1: Verify old Phase 5 text**

Run: `grep -n "writing-plans.*mindset" sdd/skills/sdd-flow/SKILL.md`
Expected: one match

- [ ] **Step 2: Replace Phase 5 section content**

Replace:
```markdown
## Phase 5: Plan

**Goal:** Create implementation plan from approved spec.

**Process:**
1. Invoke `superpowers:writing-plans` mindset for structure
2. Execute `/plan <feature-name>` logic inline:
   - Read approved spec
   - Analyze codebase for relevant files/patterns
   - Generate plan at `memory/plans/<feature-name>/plan.md`
   - Include: Phases, Files, Tasks, Testing Approach, Risks
3. Update `memory/FEATURES.md` entry to status `planned`
4. Present plan overview to user

**Output:** `memory/plans/<feature-name>/plan.md` with Status: Draft
```
With:
```markdown
## Phase 5: Plan

**Goal:** Create implementation plan from approved spec.

**Process:**
1. Invoke `superpowers:writing-plans` via the Skill tool with these user preferences:
   - **Plan save location:** `memory/plans/<feature-name>/plan.md`
   - **Keep execution header intact:** The plan MUST include:
     ```
     > **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan.
     ```
   - **Keep format:** checkbox syntax (`- [ ]`), bite-sized TDD tasks with exact code snippets and commands
2. Writing-plans runs its full process: file structure mapping, task decomposition, review loop
3. After plan is saved to `memory/plans/<feature-name>/plan.md`:
   - Update `memory/FEATURES.md` entry to status `planned`
4. Present Gate 2

**Output:** `memory/plans/<feature-name>/plan.md` with superpowers execution header and TDD task format
```

- [ ] **Step 3: Verify new text is present**

Run: `grep -n "writing-plans.*Skill tool" sdd/skills/sdd-flow/SKILL.md`
Expected: one match in Phase 5 section

Run: `grep -n "writing-plans.*mindset" sdd/skills/sdd-flow/SKILL.md`
Expected: zero results

- [ ] **Step 4: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "fix(sdd-flow): replace writing-plans mindset with explicit Skill invocation + memory/plans preference"
```

---

## Chunk 2: Reference table updates

### Task 6: Update Integration Points and Quick Reference tables

**Files:**
- Modify: `sdd/skills/sdd-flow/SKILL.md` (Integration Points + Quick Reference sections)

- [ ] **Step 1: Verify old table rows**

Run: `grep -n "IDEATE\|SPECIFY\|PLAN.*Structure" sdd/skills/sdd-flow/SKILL.md | tail -20`
Expected: rows for IDEATE, SPECIFY, PLAN in both tables

- [ ] **Step 2: Update Integration Points table**

Replace:
```markdown
| IDEATE | `superpowers:brainstorming` | Explore requirements |
| WORKTREE_SETUP | `superpowers:using-git-worktrees` | Isolate feature work |
| PLAN | `superpowers:writing-plans` | Structure plan |
```
With:
```markdown
| IDEATE+SPECIFY | `superpowers:brainstorming` | Full spec creation — Q&A, design, review loop, writes to `memory/specs/` |
| WORKTREE_SETUP | `superpowers:using-git-worktrees` | Isolate feature work |
| PLAN | `superpowers:writing-plans` | Full plan creation — TDD tasks, review loop, writes to `memory/plans/` |
```

- [ ] **Step 3: Update Quick Reference table**

Replace:
```markdown
| IDEATE | - | Understanding | SPECIFY |
| SPECIFY | Gate 1 | Spec (Review) + changelog + FEATURES.md entry | WORKTREE_SETUP |
| WORKTREE_SETUP | - | Isolated branch | PLAN |
```
With:
```markdown
| IDEATE+SPECIFY | Gate 1 | `memory/specs/<feature>.md` (PRD format) + FEATURES.md entry | WORKTREE_SETUP |
| WORKTREE_SETUP | - | Isolated branch | PLAN |
```

- [ ] **Step 4: Verify tables are updated**

Run: `grep -n "IDEATE+SPECIFY" sdd/skills/sdd-flow/SKILL.md`
Expected: 3 matches (announcement, Integration Points, Quick Reference)

Run: `grep -n "| SPECIFY |" sdd/skills/sdd-flow/SKILL.md`
Expected: zero results

- [ ] **Step 5: Commit**

```bash
git add sdd/skills/sdd-flow/SKILL.md
git commit -m "fix(sdd-flow): update Integration Points and Quick Reference tables"
```
