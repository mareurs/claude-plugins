---
kind: entry
status: promoted
title: 'Identity: effect inventory, exclusive formatter authorization and host dispatch overlap are unestablished'
closed: 2026-11-24
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-24 open -> promoted codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- identity
---

**What is open:** Stock Codex hooks: a timeout or exit 1 permits the write, an interrupted MCP call leaves its start marker without a post hook, and an App Server client call writes with no model hooks. Two `Promise.all` calls showed non-overlapping hook intervals, so concurrent execution is unestablished. Missing coverage stays UNKNOWN, so formatting writes need established ownership or an explicit exclusive-checkout contract.

**Done when:** each case is measured on a real host, or the UNKNOWN path is pinned by a test.

**From:** the same issue; evidence in docs/evidence/2026-11-08-stock-codex-hooks-spike.json.

## Closed

**Promoted to:** [[2026-11-24-stock-codex-hooks-effect-inventory-formatter-exclusivity-and]]
