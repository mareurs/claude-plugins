---
kind: entry
status: open
title: 'Identity: the stock Codex adapter is merged but not released or installed in the real profiles'
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- identity
---

**What is open:** Source is merged (plugin `6e3036a`, codescout `f6d96e59f`). Release and activation in the three Codex and three Claude profiles are not done, so the acceptance criterion on install checks has no evidence.

**Done when:** a release of the adapter, `installPath` of every profile under its own root, and one smoke run per profile.

**From:** docs/issues/2026-10-09-harness-neutral-session-identity-and-provenance.md (closed 2026-11-24).
