Effort steering: a hook-side decision core that picks a thinking depth (shallow, default, deep) per prompt.
It is not yet an installable plugin; there is no manifest, hook wiring or version here.
Design spec: `docs/superpowers/specs/2026-10-04-effort-steering-design.md` in the codescout repo.

The Claude Code adapter waits synchronously for the local policy CLI, with a default
3000 ms process deadline including startup. Successful calls return immediately; this
is a ceiling, not a fixed delay. On timeout the child is killed and the hook continues
without steering (`adapter_timeout`). Positive integer `timeoutMs` overrides are
supported by the programmatic adapter; invalid values, including zero, use the default.
The runtime ceiling is independent of the registered S4 p95 latency target (500 ms).
Semantic S4 integration tests use a separate 10000 ms preflight budget.
