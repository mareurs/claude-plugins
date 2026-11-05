# Kotlin constitution: articles VII and VIII

Added to the base rules when the stack is `kotlin` (ids C-7 and C-8). Both carry `paths`, so
they apply to Kotlin files only.

```json
[
  {"id": "C-7", "paths": ["**/*.kt", "**/*.kts"], "title": "Kotlin architecture", "rule": "Dependencies point inward: api to service to domain. Services depend on repository interfaces. Use suspend and Flow for async, sealed types for closed state, data classes for DTOs, and avoid !!.", "status": "active"},
  {"id": "C-8", "paths": ["**/*.kt", "**/*.kts"], "title": "Kotlin testing", "rule": "Every feature has tests at the right level of the pyramid: MockK unit tests, Testcontainers integration tests. Use runTest, never runBlocking, for suspend code. No @Disabled tests and no skipped assertions.", "status": "active"}
]
```

## C-7 — Kotlin architecture

Why: layer direction keeps code testable. How: organise by feature, then layer; use
`coEvery` and `coVerify` for suspend collaborators. Evidence: imports in the diff.

## C-8 — Kotlin testing

Why: tests are the spec's executable form. How: name tests `should <result> when
<condition>`; build test data with factories. Evidence: the tests in the diff.
