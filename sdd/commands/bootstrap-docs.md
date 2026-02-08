# /bootstrap-docs

## Usage

```
/bootstrap-docs --all              # Document entire codebase
/bootstrap-docs <module-name>      # Document single module
/bootstrap-docs --resume           # Resume last incomplete session
/bootstrap-docs --status           # Show documentation state
```

## Purpose

Retroactively document existing codebases by analyzing source code and generating specs. Standalone command (not part of sdd-flow), but output is compatible with the flow -- bootstrapped specs can serve as starting points for future features.

## Prerequisites

- **Serena MCP server** -- provides `get_symbols_overview`, `find_symbol`, `find_referencing_symbols`
- **IntelliJ Index MCP server** -- provides `ide_find_symbol`, `ide_file_structure`, `ide_find_references`

Both must be available and configured before running.

## Process

### Step 1: Scope Analysis

Always show magnitude before starting work. Use Serena and IntelliJ Index to map the target scope.

**Tools used:**
- `get_symbols_overview` -- enumerate symbols per file
- `find_symbol` -- resolve specific types and their structure
- `ide_find_symbol` -- cross-reference with IntelliJ index
- `ide_file_structure` -- get file-level structure overview

**Present a magnitude report:**

```
Analyzing codebase scope...

Using: Serena (symbol analysis) + IntelliJ Index (cross-references)

Scope: <module-name>
Found:
  - 12 source files (3 controllers, 4 services, 2 repositories, 3 DTOs)
  - ~1,800 lines of code
  - 8 public API endpoints
  - 3 external dependencies (JWT, OAuth2, BCrypt)

Estimated effort: ~15 minutes, will generate:
  - 1 module spec (memory/specs/<module-name>.md)
  - 1 FEATURES.md entry
  - Architecture notes if significant patterns found

Proceed? (yes / adjust scope / cancel)
```

**For `--all`:** Map all modules/packages first. Present a full inventory table. Let user confirm or exclude specific modules before proceeding.

Wait for user confirmation before moving to Step 2.

### Step 2: Exploration (per module)

Analyze each module using both tool servers:

1. `get_symbols_overview` on each file in the module
2. `find_referencing_symbols` for cross-module dependencies
3. `ide_find_references` for broader usage patterns across the codebase

Identify and categorize:
- **Public API** -- controllers, endpoints, exported functions
- **Service layer** -- business logic, orchestration
- **Data flow** -- repositories, external calls, data transformations
- **External dependencies** -- third-party libraries, other modules

### Step 3: Spec Generation

Generate a reverse-engineered spec per module using this template:

```markdown
# Feature: <module-name> (bootstrapped)

## Changelog
| Version | Date | Change | Reason |
|---------|------|--------|--------|
| v1 | YYYY-MM-DD | Bootstrapped from existing code | /bootstrap-docs |

**Status:** Documented
**Source:** Reverse-engineered
**Created:** YYYY-MM-DD

## What It Does
[Generated from code analysis]

## Key Components
[File list with roles]

## API Surface
[Endpoints / public methods]

## Dependencies
[External libs, other modules]
```

Save to `memory/specs/<module-name>.md`.

Specs are marked `Source: Reverse-engineered` to distinguish them from spec-first specs created via `/specify`.

### Step 4: Checkpoint

After each module, save progress to `memory/.bootstrap-state.json`:

```json
{
  "session": "2026-02-08T14:30:00",
  "scope": "all",
  "modules": {
    "authentication": {"status": "complete", "hash": "a3f2c1", "files_hash": "b7d4e9"},
    "payments": {"status": "complete", "hash": "c5e8f2", "files_hash": "d1a3b6"},
    "scheduling": {"status": "pending", "hash": null, "files_hash": null}
  },
  "features_md_updated": true
}
```

- `hash` -- content hash of the generated spec
- `files_hash` -- combined hash of all analyzed source files (detects code changes since bootstrap)

Checkpoint after every module. This makes the process resilient to interruption.

### Step 5: Registry Update

Add each documented module to `memory/FEATURES.md` with status `documented`.

Create `memory/FEATURES.md` if it does not exist, using this format:

```markdown
# Feature Registry

| Feature | Status | Spec | Plan | PR | Date |
|---------|--------|------|------|----|------|
| authentication | documented | specs/authentication.md | - | - | 2026-02-08 |
```

## Resume Logic (`--resume`)

1. Read `memory/.bootstrap-state.json`
2. Skip modules with status `complete`
3. Pick up at first module with status `pending`
4. If re-running a completed module explicitly: compare current `files_hash` against stored value. If source files changed, offer re-analysis. If unchanged, report no changes detected.

## Status Display (`--status`)

1. Read `memory/.bootstrap-state.json`
2. Display summary table:

```
Bootstrap Documentation Status
Session: 2026-02-08T14:30:00
Scope: all

Module              Status      Spec Hash   Source Changed?
authentication      complete    a3f2c1      no
payments            complete    c5e8f2      no
scheduling          pending     -           -

Completed: 2/3 modules
```

## Important Notes

- Always show magnitude before starting work -- never begin analysis without user confirmation
- Checkpoint after every module -- resilient to interruption
- All specs marked `Source: Reverse-engineered` to distinguish from spec-first specs
- Compatible with sdd-flow: bootstrapped specs can be promoted and used as starting points for future features developed through the full flow
