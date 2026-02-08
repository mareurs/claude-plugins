# /plan Command

Generate an implementation plan from an approved specification.

## Usage

```
/plan <spec-name>
```

## Prerequisites

- A specification must exist at `memory/specs/<spec-name>.md`
- The spec should be in "Approved" or "Review" status

## Process

1. Read and analyze `memory/specs/<spec-name>.md`
2. Explore the codebase to understand relevant patterns, files, and dependencies
3. Generate a plan document at `memory/plans/<spec-name>/plan.md`

## Plan Template

```markdown
# <Feature Name> Implementation Plan

**Spec**: [link to spec]
**Status**: Draft | Approved
**Created**: <date>

## Overview

[1-2 sentence summary of what will be implemented]

## Implementation Phases

### Phase 1: <Phase Name>

**Files to Create**: `path/to/file.ext` - [purpose]
**Files to Modify**: `path/to/file.ext` - [what changes]
**Tasks**: 1. [ ] Task description

### Phase 2: <Phase Name>

[Same structure]

## Testing Approach

- Unit tests: [what will be added]
- Integration tests: [what will be added]
- Manual testing: [verification steps]

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | [High/Medium/Low] | [How to address] |
```

## Approval Required

**CRITICAL**: Plans MUST be approved by a human before implementation.

Present the plan and explicitly ask for approval:
- Does this approach make sense?
- Are there any concerns or changes needed?
- Do you approve this plan?
