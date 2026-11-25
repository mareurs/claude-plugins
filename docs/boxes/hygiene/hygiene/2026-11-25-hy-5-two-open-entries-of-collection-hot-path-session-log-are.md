---
kind: entry
status: open
title: HY-5 — Two open entries of collection-hot-path-session-log are false today, and no detector reads an entry
created: 2026-11-25
entry_kind: meta
log:
- '2026-11-25 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-25
---

**Valid:** dated 2026-11-25

**Verdict:** miss

**Sweep:** 2026-11-25, second sweep of the day (this ledger).

**Observation:** Entry `F-1` of `collection-hot-path-session-log` says the installed codescout 0.15.0 has no `hot-view`, so the hook is dormant. Entry `F-2` says no collection exists. Both read `Status: open`. This session's SessionStart delivered hot views from the installed `codescout 0.15.0` for seven collections, and `codescout box` lists boxes today. Both claims are false now, and both have stayed `open` since 2026-11-15. The sweep of the morning of 2026-11-25 saw the same two entries and listed them under "Outside the detectors". No detector reads an entry, because entry-level verify-open (D6) is v2. The `Valid:` line of `F-1` is `conditional`, and doctor lists `entry_conditional_past_due` as 0 above its exposure floor of 5 citations (9 more sit below it). This sweep did not check whether `F-1` and `F-2` are among those 9.

**Proposal (if any):** Treat this as the second datapoint for D6. A first D6 can be small: for a live tracker, take each entry whose `Valid:` line is `conditional — <event>` and print the event beside the entry, so the human checks it in one read. The detector does not decide whether the event has happened.

**Promote-when:** a third sweep meets an open entry whose condition has already come true.

**Outcome (2026-11-25, later the same day):** The verify-open pass ran on both entries, and `F-1` and `F-2` are now `fixed-verified` (commit `2739260`). The checks were: `hot-view` run on the binary that the server command of all four profiles names (a symlink to a dev build that still reports 0.15.0), the `find` that the entry itself quotes, and `hot-view.test.mjs`, whose fake binary covers every exit path. `F-4` and `F-6` of the same log still read `open`. The hook keeps a view quiet only when the header is its only line, and the test `quiet_view_with_problems_is_shown_verbatim` passes, which bears on `F-6`. This pass did not check whether the contract text that `F-4` asks about has changed.
