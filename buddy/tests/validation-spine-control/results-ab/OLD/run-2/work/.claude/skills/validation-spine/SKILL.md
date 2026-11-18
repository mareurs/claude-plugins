---
name: validation-spine
description: Use when writing tests, validation, or checks for code — unit tests, assertions, test suites, data validation, or verifying that code matches its specification.
---

# Validation Spine

The dominant failure is not that agents write too few checks — it is that they write
checks which cannot fail.

1. **Pin the contract before any check exists.** One sentence — inputs, outputs, side
   effects, constraints — and stop if the spec does not determine it.
2. **Forbid the implementation as oracle.** Expected values come from spec, docstring,
   or ticket — never from what the code currently returns.
3. **Give the whole unit, not the signature.** Read the full module under test before
   writing anything.
4. **Retrieve human-written examples as the few-shot.** Open the two most similar
   existing tests in this repo and match their idiom.
5. **Gate every assertion on mutation.** Name the one-line edit to production code that
   turns each assertion red; delete assertions with no such edit.
6. **Demand evidence, not a report of evidence.** Run it, paste real output.
7. **Enforce it in the harness, not the prompt.**

Follow this procedure exactly.

Before writing any check:

1. State the contract of the unit under test in one sentence — inputs, outputs, side
   effects, constraints. If the spec does not determine it, list the ambiguity and stop.
   Do not guess.
2. Derive every expected value from the spec, docstring, or ticket. Do NOT read the
   implementation to decide what is correct. If the implementation is the only source,
   say so and treat it as unspecified.
3. Open the two most similar existing tests in this repo. Match their idiom, fixtures,
   and naming.

After writing:

4. For each assertion, name the one-line change to production code that would turn it
   red. Delete any assertion with no such change.
5. Run the suite. Paste the real output. If it fails, report the failure. Never modify
   the check to match the code.
