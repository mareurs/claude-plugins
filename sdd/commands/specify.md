# /specify

## Usage

```
/specify <feature-name>
```

## Purpose

Generate a product requirements document (PRD) through guided conversation.

## Process

1. Ask 2-5 clarifying questions about:
   - User needs and pain points
   - Success criteria
   - Technical constraints
   - Edge cases and scope boundaries

2. Generate PRD using template below

3. Save to `memory/specs/<feature-name>.md`

## PRD Template

```markdown
# [Feature Name]

## Changelog
| Version | Date | Change | Reason |
|---------|------|--------|--------|
| v1 | YYYY-MM-DD | Initial spec | Created via /specify |

**Status:** Draft | Review | Approved
**Created:** YYYY-MM-DD
**Last Updated:** YYYY-MM-DD

## Problem Statement

[What problem does this solve? Who experiences it?]

## Proposed Solution

[High-level approach to solving the problem]

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Technical Approach

[Key technical decisions, architecture, implementation notes]

## Out of Scope

[What this feature explicitly does NOT include]

## Open Questions

- [ ] Question 1
- [ ] Question 2
```

## Status Flow

- **Draft** - Initial version, subject to change
- **Review** - Ready for feedback
- **Approved** - Finalized (requires explicit user approval)
