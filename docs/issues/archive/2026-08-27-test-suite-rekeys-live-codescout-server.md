---
id: 1012db2a6c0e4d7b
kind: bug
status: fixed
title: tests/run-all.sh rekeys the LIVE codescout server to a test fixture's session id
tags:
- codescout-companion
- tests
- test-isolation
- rendezvous
- guide-ledger
closed: 2026-08-27
unverified: The leak-outcome assertions (Tests 3 and 4) only discriminate when the suite runs with a live codescout server in its process ancestry — i.e. under run_command. In CI or a plain terminal they pass green either way; Tests 1 and 2 are what hold the line there. Measured by mutation, not assumed.
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

- **Sandbox `XDG_STATE_HOME` in the suite.** ✅ **Done** — see *Fixed* below.
- **Have the hook refuse obviously-synthetic session ids.** Rejected: it encodes a
  fixture-naming convention into production code, and any test using a realistic-looking
  uuid slips straight through.
- **Add a leak assertion.** ✅ **Done** — `tests/test-rendezvous-isolation.sh`.

## Fixed — 2026-08-27

**Fix:** `d7fb976c` on `main` (patch-id `b36a1d76e0af80625aca73d5d97e85d610533bc3`).

One sandbox in two places, because neither alone is sufficient:

- `tests/lib/fixtures.sh` — sourced by 20 of 26 suites, so it also covers a **standalone**
  `bash tests/test-session-start.sh`, which must be exactly as safe as running via the suite.
- `tests/run-all.sh` — covers suites that do *not* source `fixtures.sh`, and owns cleanup
  via `trap`. `fixtures.sh` cannot trap: every test script installs its own `trap … EXIT`
  for its tempdir, which replaces anything set at source time. Standalone leftovers are
  swept on the next run at `-mmin +60` instead.

`tests/test-rendezvous-isolation.sh` is the gate — 4 assertions, listed in *Fix directions*
above.

**Scope correction found while fixing:** the exposure was wider than filed. Four suites
invoke `session-start.mjs` and **zero** sandboxed `XDG_STATE_HOME`, so the fix had to be
suite-level rather than a patch to Test 13. `test-sdd-hooks.sh` turned out **not** to be an
offender — it passes only `cwd`, never a `session_id`, so the hook's `if (sessionId)` guard
means it never reaches the rendezvous block at all.

**End-to-end evidence.** Before: a suite run left the live server's slot
(`servers/3826646.json`) reading `sid-recon-marker-test`. After: the slot still reads the
real session id across a full run. 41 suites green, 0 sandbox dirs left behind.

**Reproduced live while fixing**, which is the strongest evidence in this file: running the
new gate *before* the sandbox landed stamped the live server's slot with the probe's own
fixture id and planted a stray slot in the real dir — and `project-activation-bootstrap`
re-injected on the very next tool call, the re-arm symptom this file predicted. Both
artifacts were cleaned and the live slot repointed to the real session id.

### Two W-4 results, recorded rather than smoothed over

- **Test 2's first draft was non-discriminating.** It read the *ambient* `XDG_STATE_HOME`,
  fell back to the real dir when unset, and so passed green against the unfixed suite. It
  now sets the variable explicitly, which discriminates whether or not the sandbox exists.
  Caught only by running the gate red first.
- **Tests 3 and 4 stay GREEN against the broken suite** in an environment with no codescout
  ancestor. Mutation-tested by deleting the sandbox and running under a throwaway `HOME`:
  Test 1 failed, 3 and 4 passed. That is not a flaw to fix — it is the honest scope of an
  outcome check for a bug that only fires under `run_command` — but it means **Tests 1 and
  2 are the gate and 3 and 4 are corroboration**, and the file says so.
## Not to be confused with

`docs/issues/archive/2026-08-27-concurrent-subagent-restores-discard-parent-guide-marks.md`
— a different defect in the same subsystem, found the same day. This one is upstream of it
and much broader: it corrupts *which file* the whole mechanism operates on.

## References

- `codescout-companion/hooks/session-start.mjs` — the ancestry-matched rendezvous stamp
- `tests/test-session-start.sh` — Test 13, the fixture id
- `codescout:src/tools/rendezvous.rs`, `codescout:src/tools/guide_ledger.rs` — `rekey`
- CLAUDE.md § Testing — *"Test isolation: always clean up mutated state."*
