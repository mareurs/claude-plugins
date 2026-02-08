# /drift

## Usage

```
/drift <spec-name>
/drift
```

Single spec or all specs in `docs/specs/`.

## Purpose

Compare specification documents against actual code implementation to identify:
- Implemented features
- Missing features
- Divergent implementations

## Process

1. Load spec from `docs/specs/<spec-name>.md`
2. Extract acceptance criteria sections
3. Explore codebase using Serena tools to verify each criterion
4. Classify implementation status
5. Generate drift report

## Status Classification

- **Implemented** (✓): Criterion fully satisfied in code
- **Missing** (✗): Criterion not implemented
- **Divergent** (⚠): Implementation differs from spec

## Report Format

```
╔══════════════════════════════════════╗
║ DRIFT REPORT: <spec-name>           ║
╠══════════════════════════════════════╣
║ Status: <summary>                    ║
║ Implemented: X/Y                     ║
║ Missing: N                           ║
║ Divergent: M                         ║
╠══════════════════════════════════════╣
║ DETAILS                              ║
╠══════════════════════════════════════╣
║ ✓ Criterion 1                        ║
║ ✗ Criterion 2                        ║
║   → Not found in codebase            ║
║ ⚠ Criterion 3                        ║
║   → Implementation differs: <detail> ║
╚══════════════════════════════════════╝
```

## Handling Drift

**Missing features:**
- Implement the missing functionality, or
- Update spec to remove obsolete requirements

**Divergent implementations:**
- Fix code to match spec, or
- Update spec to reflect current implementation

Document rationale in commit messages or spec updates.

## Prerequisites

- Serena MCP server active
- Specs in `docs/specs/` directory
- Project indexed by Serena

## Notes

- Use Serena tools for semantic code search
- Focus on acceptance criteria sections in specs
- Generate actionable findings with file paths and line references
