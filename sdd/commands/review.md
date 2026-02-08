# /review

Constitutional compliance check before commit.

## Usage

```
/review
/review <spec-name>
```

## Purpose

Verify adherence to SDD constitution (six articles) before committing changes.

## Checklist

Run through all six articles:

1. **Article I: Spec exists and matches implementation**
   - Spec file present in specs/
   - Implementation aligns with spec (run /drift if Serena available)

2. **Article II: Plan exists and was approved**
   - Plan file present in plans/
   - Plan was approved before implementation

3. **Article III: Review is happening**
   - This checklist is being executed

4. **Article IV: Documentation updated**
   - Relevant docs reflect changes
   - No stale documentation

5. **Article V: Solution is minimal**
   - No over-engineering
   - Simplest approach that works

6. **Article VI: Names are clear, rationale documented**
   - Clear, intentional naming
   - Design decisions documented

## Output Format

```
SDD REVIEW: <spec-name or "current changes">
[✓] Article I: Spec/implementation alignment
[✓] Article II: Plan approved
[✓] Article III: Review conducted
[✓] Article IV: Documentation current
[✓] Article V: Minimal solution
[✓] Article VI: Clear names, rationale

GO: Ready to commit
```

Or if violations found:

```
NO-GO: <Article N> - <brief reason>
```

## On GO

Create review marker file:

```bash
touch /tmp/.sdd-reviewed-$(echo -n "$PWD" | md5sum | cut -c1-8)
```

This marker is checked by the review-guard hook to allow commits.

If spec-name provided, suggest: `/document sync --from-spec <spec-name>`
