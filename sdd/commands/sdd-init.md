# /sdd-init

## Usage

```
/sdd-init [stack]

Stacks:
  base       Language-agnostic (default)
  kotlin     Adds Kotlin-specific constitution articles (VII-VIII)
  python     Adds Python-specific constitution articles (VII-VIII)
```

## Purpose

Create the minimum project-local files needed for SDD governance. The plugin provides commands, skills, agents, and hooks -- this command creates the project-specific governance files they depend on.

## What It Creates

```
memory/
  constitution.md      <- Governance principles (hooks gate on this)
  sdd-config.md        <- Enforcement config (warn/strict)
  FEATURES.md          <- Feature registry (empty, sdd-flow populates)
  specs/               <- Feature specifications (sdd-flow, /specify)
  plans/               <- Implementation plans (sdd-flow, /plan)
  adrs/                <- Architecture decision records (sdd-flow)
```

Optionally appends an SDD section to CLAUDE.md.

## Guardrails

1. **Never modify source code** -- only create infrastructure files
2. **Never auto-commit** -- user reviews and commits
3. **Check for existing SDD** -- if `memory/constitution.md` exists, warn and ask before overwriting

## Process

### Step 1: Detection

Check if `memory/constitution.md` exists.

- **Exists**: "This project already has SDD initialized. Overwrite? (yes/no)"
  - If no: exit
  - If yes: continue (backup existing constitution first)
- **Does not exist**: proceed

### Step 2: Stack Selection

If stack not provided as argument, ask:

```
What is the primary language/stack for this project?

1. Base (language-agnostic) -- universal SDD articles I-VI only
2. Kotlin -- adds Articles VII-VIII for Kotlin/JVM conventions
3. Python -- adds Articles VII-VIII for Python conventions
```

### Step 3: Preview

Show what will be created:

```
SDD INIT PREVIEW

Stack: [base/kotlin/python]
Enforcement: warn (default, change in memory/sdd-config.md)

Files to create:
  memory/constitution.md     <- Articles I-VI [+ VII-VIII for stack]
  memory/sdd-config.md       <- enforcement: warn
  memory/FEATURES.md         <- empty feature registry
  memory/specs/              <- directory
  memory/plans/              <- directory
  memory/adrs/               <- directory

Proceed? (yes/no)
```

### Step 4: Create Files

**4.1: Create directories**

```bash
mkdir -p memory/specs memory/plans memory/adrs
```

**4.2: Generate constitution**

Read base template from `${CLAUDE_PLUGIN_ROOT}/ecosystem/templates/base/constitution.md.template` (if it exists) or generate inline with these universal articles:

- **Article I**: Specification-First Development
- **Article II**: Human-in-the-Loop Planning
- **Article III**: Constitutional Review Before Commit
- **Article IV**: Living Documentation
- **Article V**: Progressive Enhancement (YAGNI)
- **Article VI**: Clear Communication

If stack is `kotlin`, append from `${CLAUDE_PLUGIN_ROOT}/ecosystem/templates/kotlin/constitution-kotlin.md`:
- **Article VII**: Kotlin/JVM conventions
- **Article VIII**: Stack-specific testing

If stack is `python`, append from `${CLAUDE_PLUGIN_ROOT}/ecosystem/templates/python/constitution-python.md`:
- **Article VII**: Python conventions
- **Article VIII**: Stack-specific testing

Save to `memory/constitution.md`.

**4.3: Generate sdd-config.md**

```markdown
---
enforcement: warn
stack: [base/kotlin/python]
---

## Enforcement Modes

- **warn** (default): Hooks show warnings but allow actions to proceed
- **strict**: Hooks block actions that violate SDD governance

Edit the enforcement value above to change behavior. Takes effect immediately.
```

Save to `memory/sdd-config.md`.

**4.4: Create empty FEATURES.md**

```markdown
# Feature Registry

| Feature | Status | Spec | Plan | PR | Date |
|---------|--------|------|------|----|------|
```

Save to `memory/FEATURES.md`.

**4.5: Update CLAUDE.md (optional)**

Ask: "Append SDD section to CLAUDE.md? (yes/no)"

If yes, append:

```markdown

## SDD Workflow

This project uses Specification-Driven Development.

- `/specify <feature>` -- create feature specification
- `/plan <feature>` -- create implementation plan
- `/review` -- constitutional compliance check before commit
- `/drift <feature>` -- check spec-to-code alignment
- `/bootstrap-docs` -- document existing code retroactively

Key files: `memory/constitution.md` (governance), `memory/sdd-config.md` (enforcement).
```

### Step 5: Summary

```
SDD initialized.

Created:
  memory/constitution.md   (Articles I-VI [+ VII-VIII])
  memory/sdd-config.md     (enforcement: warn)
  memory/FEATURES.md       (empty registry)
  memory/specs/            (ready for /specify)
  memory/plans/            (ready for /plan)
  memory/adrs/             (ready for ADRs)

Next steps:
  1. Review memory/constitution.md and customize if needed
  2. Run /specify <feature> to start your first feature
  3. Commit the memory/ directory

Note: Changes are NOT committed. Review and commit when ready.
```
