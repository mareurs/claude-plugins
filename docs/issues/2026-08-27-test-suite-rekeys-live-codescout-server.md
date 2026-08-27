---
id: '776d382dec61da41'
kind: bug
status: open
title: tests/run-all.sh rekeys the LIVE codescout server to a test fixture's session id
tags:
- codescout-companion
- tests
- test-isolation
- rendezvous
- guide-ledger
---

---
kind: bug
status: open
closed:
unverified:
---

# `tests/run-all.sh` rekeys the LIVE codescout server to a test fixture's session id

**Found:** 2026-08-27, by direct measurement, while live-verifying the guide-ledger
concurrency fix.
**Affects:** `claude-plugins` — `tests/test-session-start.sh` (Test 13), and every other
test that pipes a synthetic `session_id` into `codescout-companion/hooks/session-start.mjs`.
**Severity:** high. It silently corrupts the developer's own live session state, and it
fires on the *documented* way to run the suite.

## Summary

Running `./tests/run-all.sh` **through codescout's `run_command`** — which this repo's
Iron Law 3 and CLAUDE.md tell you to do — stamps the live codescout server's rendezvous
slot with a test fixture's session id. The server then `rekey`s its guide-hints ledger onto
that id.

Two consequences, both silent:

1. **The live session's guide ledger is abandoned mid-session.** Every subsequent guide
   delivery is recorded under `sid-recon-marker-test.json` instead of
   `<real-session-id>.json`.
2. **`rekey` clears the in-memory ledger**, so every guide topic re-arms and re-injects.
   A guide the model already holds is re-sent, costing context for nothing.

## Measured

Direct evidence, this session (real session id `f6ae2d77-…`):

```
~/.local/state/codescout/servers/3826646.json
  -> {"session": "sid-recon-marker-test", "hook_at": "2026-08-27T10:00:41.221Z"}
```

`3826646` is the codescout server serving this session. `10:00:41Z` = 13:00:41 local — the
exact minute `./tests/run-all.sh` was running.

And the ledgers diverged accordingly:

| file | contents | last written |
|---|---|---|
| `f6ae2d77-….json` (real sid) | the 4 topics delivered before the test run | abandoned |
| `sid-recon-marker-test.json` | all 7 topics, including every one delivered after | live |

**Corroborating symptom, noticed and not chased at the time:** `project-activation-bootstrap`
auto-injected a **second** time mid-session, on a `run_command` call. That is the `rekey`
clear re-arming a topic already delivered.

## Mechanism

Three correct-in-isolation behaviours compose into the defect:

1. `tests/test-session-start.sh:174-175` pipes `{"session_id":"sid-recon-marker-test", …}`
   into the real hook.
2. The suite sets **no** `XDG_STATE_HOME`, so `session-start.mjs:60-62` resolves the
   rendezvous dir to the **real** `~/.local/state/codescout/servers/`.
3. `session-start.mjs` stamps every slot whose `ppid` is in `ownAncestry()`.

Step 3 is the sharp part, and its guard is what causes the hit rather than preventing it.
The comment reads:

> *Matching on ppid-within-our-ancestry is what keeps two concurrent windows on one repo
> from stamping each other's servers.*

That is right for real sessions. But a suite launched via `run_command` is a **genuine
descendant of the codescout server process**, so the ancestry test passes and the fixture
id is written into the live server's own slot. The isolation guard cannot distinguish "my
server" from "my server, but I am a test".

**So the defect fires only when the suite is run the way the repo mandates.** Run from a
plain terminal, codescout is not in the ancestry and nothing is stamped — which is
presumably why this survived: the isolation hole is invisible from the shell where you
would most naturally look for it.

## Fix directions (none implemented)

- **Sandbox `XDG_STATE_HOME` in the suite.** Smallest change, kills the whole class:
  no test can reach the real rendezvous dir. This is the same fix already applied to
  `TMPDIR` in `agent-guide-snapshot.test.sh` on 2026-08-27, for the same reason — and that
  precedent is the argument for doing it suite-wide rather than per-test.
- **Have the hook refuse obviously-synthetic session ids.** Rejected as primary: it
  encodes a fixture-naming convention into production code, and any test using a
  realistic-looking uuid slips straight through.
- **Add a leak assertion** — after the suite, no rendezvous slot may carry a session id
  the suite invented. This is the regression gate regardless of which fix lands, and it is
  the piece that would have caught it.

## Not to be confused with

`docs/issues/archive/2026-08-27-concurrent-subagent-restores-discard-parent-guide-marks.md`
— a different defect in the same subsystem, found the same day. This one is upstream of it
and much broader: it corrupts *which file* the whole mechanism operates on.

## References

- `codescout-companion/hooks/session-start.mjs` — the ancestry-matched rendezvous stamp
- `tests/test-session-start.sh` — Test 13, the fixture id
- `codescout:src/tools/rendezvous.rs`, `codescout:src/tools/guide_ledger.rs` — `rekey`
- CLAUDE.md § Testing — *"Test isolation: always clean up mutated state."*

