---
kind: entry
status: done
title: 'codescout-display: the paint time of an opened card of 100,000 characters is unmeasured'
closed: 2026-11-26
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-26 open -> done codescout:anonymous'
source: conversation with the operator, 2026-11-24
status_since: 2026-11-26
topics:
- codescout-display
---

**What is open:** The mod builds a card in 0.05 to 0.6 ms for a reply of 100,000 characters (measured, with a test that holds a 25 ms budget). The engine's own paint is not measured. An opened card hands up to `FULL_CAP` (100,000 characters) to the `Code` highlighter, and that cost is outside our code.

**Done when:** one real session (`claude --plugin-dir codescout-display`, verbose) opens a card of about 100,000 characters, and the time from the key press to the repaint is written here. If it is noticeable, lower `FULL_CAP` and say so in the entry that closes this one.

**From:** the latency question on the token row, commit `47082a4`; evidence in the `latency:` tests of `codescout-display/tests/cards.test.ts`.

## Closed

Measured 2026-11-27 with Claude Code 2.1.332 in verbose mode and codescout-display loaded through `--plugin-dir`. Replayed a synthetic `read_file` result with exactly 100,000 ASCII source characters on 2,527 lines of Python. Kitty 0.51.0 ran at 128 by 42 cells on Xvfb with software rendering. The timer ran from the XTEST button activation to the first matching sample of the settled open-card pixels. Median sampling gaps per trial were about 6–10 ms. The last source marker and the visibility of the fold control were checked in the terminal text.

Each row is four first openings in fresh sessions. The rows within each series were interleaved. Times are milliseconds, rounded to whole milliseconds.

| Series | Expanded payload cap | Median | Range | Fold visible |
|---|---:|---:|---:|---:|
| 1 | 100,000 | 345 | 333–355 | 0/4 |
| 1 | 60,000 | 352 | 338–358 | 4/4 |
| 1 | 40,000 | 261 | 243–268 | 4/4 |
| 2 | 40,000 | 283 | 259–294 | 4/4 |
| 2 | 20,000 | 196 | 167–331 | 4/4 |
| 2 | 10,000 | 165 | 127–196 | 4/4 |

At 100,000 the terminal reported 100,064 drawable characters for the whole card and clipped the fold control under its 100,000-character limit. Set `FULL_CAP` to 20,000. It leaves room for the control and retains twice the payload of the 10,000-character candidate. The 331 ms sample remains in the result.

Verified the final source in a fresh replay with a 169 ms first opening, a successful fold and an 87 ms reopening. The 155 native mod tests and all six checks in `tests/test-codescout-display.sh` passed. The card-construction budget test still exercises a 100,000-character source fixture.
