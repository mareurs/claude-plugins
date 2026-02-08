# Universal SDD Constitutional Foundation

**Version**: 1.0
**Status**: Ratified
**Date**: 2026-01-17

This document defines the immutable principles governing Specification-Driven Development. These principles ensure consistency, quality, and maintainability across all projects using this ecosystem.

---

## Preamble

Specification-Driven Development (SDD) is a methodology where code follows specifications, not the other way around. Every feature starts with a clear definition of *what* before diving into *how*. This constitution establishes the fundamental rules that all development must follow.

**Purpose**: This constitution serves as both governance and education. Each article includes rationale explaining *why* the principle matters, helping developers (both human and AI) understand the methodology's philosophy.

---

## Article I: Specification-First Development

### Principle

No code shall be written without a specification. Specifications define the problem, solution, and acceptance criteria before implementation begins.

### Mandates

1. **Spec Before Code**: Every feature, enhancement, or significant change MUST have a specification document before implementation begins.

2. **Specification Content**: Every spec MUST include:
   - Problem statement (what problem are we solving?)
   - Proposed solution (how will we solve it?)
   - Acceptance criteria (how do we know we're done?)
   - Out of scope (what are we NOT doing?)
   - Open questions (what needs clarification?)

3. **Spec Location**: Specifications live in `memory/specs/{feature-name}.md` and are versioned with the codebase.

4. **Spec Evolution**: Specs may be updated during implementation, but changes MUST be documented and justified.

5. **No Scope Creep**: Implementation MUST NOT exceed what's specified. New ideas go in new specs.

### Rationale

Writing specs first forces clarity of thought. It's cheaper to find problems in a document than in code. Specs also serve as documentation, onboarding materials, and test case generators.

### Enforcement

- `/specify` command generates compliant specifications
- `/review` validates that implementation matches specification
- Human approval required before spec is considered final

---

## Article II: Human-in-the-Loop for Planning

### Principle

Implementation plans require human approval before execution. AI assists with planning but humans make the final decisions.

### Mandates

1. **Plan Generation**: After specification, a detailed implementation plan MUST be generated showing:
   - Implementation phases
   - Files to create/modify
   - Testing approach
   - Risks and mitigations

2. **Human Approval Gate**: Plans MUST receive explicit human approval before implementation begins. This is non-negotiable.

3. **Plan Location**: Plans live in `memory/plans/{spec-name}/plan.md` alongside any supporting diagrams or notes.

4. **Plan Fidelity**: Implementation MUST follow the approved plan. Deviations require re-approval.

5. **Incremental Approval**: For large features, plans may be approved incrementally by phase.

### Rationale

Humans understand context, business requirements, and organizational constraints that AI cannot fully grasp. The approval gate catches misunderstandings before they become wasted effort.

### Enforcement

- `/plan` command generates plans and requests approval
- Implementation cannot proceed without documented approval
- `/review` verifies plan was followed

---

## Article III: Constitutional Review Before Commit

### Principle

All changes must be validated against this constitution before being committed. No exceptions.

### Mandates

1. **Pre-Commit Review**: Before committing changes, run a constitutional review to verify compliance.

2. **Review Scope**: Reviews check:
   - Spec exists and matches implementation
   - Plan was approved
   - Documentation updated
   - No over-engineering
   - Tests exist for new functionality

3. **GO/NO-GO Decision**: Reviews result in a clear GO or NO-GO decision with specific reasons.

4. **NO-GO Resolution**: If review fails, issues MUST be resolved before committing. No "we'll fix it later."

5. **Review Documentation**: Review results may be logged for audit purposes.

### Rationale

Constitutional review is the quality gate that ensures standards are maintained. It catches drift between intention and implementation before changes become permanent.

### Enforcement

- `/review` command performs constitutional review
- Developers MUST run review before committing
- Failed reviews block commits until resolved

---

## Article IV: Documentation as Code

### Principle

Documentation is a first-class citizen, versioned and updated alongside code. Stale docs are bugs.

### Mandates

1. **Doc Updates**: When code changes, relevant documentation MUST be updated in the same commit.

2. **Doc Types**:
   - Specifications (`memory/specs/`) - Feature definitions
   - Plans (`memory/plans/`) - Implementation details
   - ADRs (`docs/adr/`) - Architecture decisions (when applicable)
   - README/CLAUDE.md - Project entry points

3. **Doc-Code Proximity**: Documentation should be as close to the code it describes as possible.

4. **No Orphan Docs**: Documentation without corresponding code, or code without documentation, is a violation.

5. **Changelog**: Significant changes SHOULD be documented in a changelog or release notes.

### Rationale

Documentation that lives separately from code inevitably drifts. Treating docs as code ensures they're reviewed, versioned, and maintained with the same rigor.

### Enforcement

- `/review` checks for documentation updates
- CI/CD may include documentation validation
- Drift detection skills catch doc-code mismatches (Phase 2+)

---

## Article V: Progressive Enhancement

### Principle

Start with the minimum viable solution and add complexity only when pain points emerge. YAGNI (You Aren't Gonna Need It) is law.

### Mandates

1. **Minimal First**: Always start with the simplest solution that could work.

2. **Pain-Driven Complexity**: Only add abstraction, optimization, or infrastructure when:
   - Current approach has demonstrated limitations
   - The pain is recurring, not theoretical
   - The benefit justifies the complexity cost

3. **No Premature Abstraction**: Do not create frameworks, utilities, or abstractions for one-time use.

4. **Delete > Comment**: Remove unused code rather than commenting it out. Version control remembers.

5. **Question Additions**: Every new dependency, pattern, or tool must justify its existence.

### Rationale

Complexity is the enemy of maintainability. Every abstraction is a bet about the future that may not pay off. Starting simple preserves optionality.

### Enforcement

- `/review` flags over-engineering
- Code reviews should challenge unnecessary complexity
- "Do we need this?" is always a valid question

---

## Article VI: Clear Communication

### Principle

All artifacts (code, specs, plans, reviews) must communicate clearly to both human and AI readers.

### Mandates

1. **Self-Documenting Names**: Variables, functions, files, and specs use descriptive names.

2. **Context in Specs**: Specifications provide enough context for someone unfamiliar with the project.

3. **Rationale in Decisions**: Non-obvious decisions include "why" not just "what."

4. **No Tribal Knowledge**: Critical information must be written down, not assumed.

5. **Error Messages**: Error states include actionable guidance, not just failure codes.

### Rationale

AI assistants are more effective with clear context. Humans benefit from the same clarity. Good communication compounds over time.

### Enforcement

- Spec templates enforce structure
- Reviews check for clarity
- Team members may request clarification

---

## Amendment Process

Constitutional amendments require:

1. Written proposal with rationale
2. Impact analysis on existing workflows
3. Review period for feedback
4. Documentation in this file with version increment

Minor clarifications do not require full amendment process.

---

## Glossary

| Term | Definition |
|------|------------|
| **Spec** | Specification document defining a feature or change |
| **Plan** | Implementation plan derived from a spec |
| **HITL** | Human-in-the-Loop, requiring human approval |
| **Constitutional Review** | Validation of changes against this constitution |
| **Drift** | Divergence between documentation and code |
| **YAGNI** | "You Aren't Gonna Need It" - avoid premature complexity |
| **SDD** | Specification-Driven Development |

---

## Constitutional Compliance Checklist

When reviewing changes, verify:

- [ ] **Article I**: Specification exists and matches implementation
- [ ] **Article II**: Plan was approved by human before implementation
- [ ] **Article III**: This review is happening (meta-compliance!)
- [ ] **Article IV**: Documentation updated alongside code
- [ ] **Article V**: No over-engineering or premature abstraction
- [ ] **Article VI**: Communication is clear and self-documenting

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-17 | Initial ratification |
