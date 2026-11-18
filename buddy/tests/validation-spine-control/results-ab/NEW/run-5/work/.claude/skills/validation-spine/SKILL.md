---
name: validation-spine
description: Use when writing tests, validation, or checks for code — unit tests, assertions, test suites, data validation, or verifying that code matches its specification.
---

# Validation Spine

The dominant failure is not that agents write too few checks — it is that they write
checks which cannot fail. A model that reads an implementation to decide what is
correct encodes the bug as the expectation, and the resulting green suite certifies
nothing.

So: the checks you write must be able to fail.

Derive expected values from the specification — the docstring, the ticket, the type
contract — not from what the code returns today. Where the specification is silent,
name the unspecified case rather than asserting a value for it.

Every assertion needs a one-line change to production code that would turn it red. An
assertion without one is decoration, and it is the only check on whether the paragraph
above was actually honoured.

Run it and report what came back. A failing check is a result, not a problem to tidy;
where the code and its specification disagree, say so and leave the check failing.
