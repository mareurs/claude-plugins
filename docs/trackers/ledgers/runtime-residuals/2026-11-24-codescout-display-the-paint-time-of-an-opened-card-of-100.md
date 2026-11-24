---
kind: entry
status: open
title: 'codescout-display: the paint time of an opened card of 100,000 characters is unmeasured'
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
source: conversation with the operator, 2026-11-24
status_since: 2026-11-24
topics:
- codescout-display
---

**What is open:** The mod builds a card in 0.05 to 0.6 ms for a reply of 100,000 characters (measured, with a test that holds a 25 ms budget). The engine's own paint is not measured. An opened card hands up to `FULL_CAP` (100,000 characters) to the `Code` highlighter, and that cost is outside our code.

**Done when:** one real session (`claude --plugin-dir codescout-display`, verbose) opens a card of about 100,000 characters, and the time from the key press to the repaint is written here. If it is noticeable, lower `FULL_CAP` and say so in the entry that closes this one.

**From:** the latency question on the token row, commit `47082a4`; evidence in the `latency:` tests of `codescout-display/tests/cards.test.ts`.
