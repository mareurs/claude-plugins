# Kotlin constitution: articles VII and VIII

Added to the base rules when the stack is `kotlin` (two rules). Both carry `paths`, so
they apply to Kotlin files only.

```json
[
  {"title": "Kotlin architecture", "paths": ["**/*.kt", "**/*.kts"], "rule": "Dependencies point inward: api to service to domain. Services depend on repository interfaces. Use suspend and Flow for async, sealed types for closed state, data classes for DTOs, and avoid !!."},
  {"title": "Kotlin testing", "paths": ["**/*.kt", "**/*.kts"], "rule": "Every feature has tests at the right level of the pyramid: MockK unit tests, Testcontainers integration tests. Use runTest, never runBlocking, for suspend code. No @Disabled tests and no skipped assertions."}
]
```

## Kotlin architecture

Why: layer direction keeps code testable. How: organise by feature, then layer; use
`coEvery` and `coVerify` for suspend collaborators. Evidence: imports in the diff.

## Kotlin testing

Why: tests are the spec's executable form. How: name tests `should <result> when
<condition>`; build test data with factories. Evidence: the tests in the diff.
