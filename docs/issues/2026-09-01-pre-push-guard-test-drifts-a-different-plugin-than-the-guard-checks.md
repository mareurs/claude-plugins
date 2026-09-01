---
kind: bug
status: open
title: 'pre-push-guard test drifts a different plugin than the guard checks, so its positive control silently went green-to-red'
tags:
  - tests
  - release
  - guards
  - fixture-unreachable
  - positive-control
last_observed: 2026-09-01
---

# `test-pre-push-guard.sh`'s parity fixture drifts one plugin while the guard checks another

## Summary

`./tests/run-all.sh` **exits 1**. Two of `tests/test-pre-push-guard.sh`'s 17 assertions
fail, and they are the two that matter most:

```
FAIL: parity: drifted profiles + version bump → deny: expected=deny got=allow ec=0
FAIL: parity: deny message names the repair
```

The test itself labels the first one:

> `# POSITIVE CONTROL FIRST. If a drifted profile set does not produce a deny, then`
> `# every "allow" below is uninformative — it would read the same in a world where`
> `# the parity check never runs at all.`

So the control the author wrote to make the other five parity assertions meaningful is
red, and those five are now uninformative by the test's own stated criterion.

## Root cause

The fixture and the guard are talking about **different plugins**, and nothing asserts
they match.

- `tests/test-pre-push-guard.sh:33` discovers the bump commit:
  `BUMP_SHA=$(git log -1 --format=%H -- '*/.claude-plugin/plugin.json')` — deliberately
  discovered rather than pinned, with the comment *"a pinned sha rots and the test would
  then pass for the wrong reason."* That reasoning is sound and the rot it prevents is
  real.
- `make_profiles` (same file, 46-62) fabricates the drifted install records for exactly
  one hardcoded key: `codescout-companion@sdd-misc-plugins`.
- `scripts/pre-push-guard.sh`'s `bumped_plugins` derives the plugin list **from the
  discovered range**, then runs `check-profile-parity.sh` for each.

When the most recent `plugin.json` commit bumps `buddy`, the guard checks `buddy` — for
which the fake `$HOME` holds no record at all. `check-profile-parity.sh` then takes its
deliberate not-a-failure branch (line 119, *"not installed anywhere is not a failure — sdd
is stable and uninstalled by design"*), prints `OK`, and exits 0. The guard allows. The
assertion cannot fire.

Measured 2026-09-01, both directions, against the same fabricated `$HOME`:

```
$ git log -1 --format='%h %s' -- '*/.claude-plugin/plugin.json'
30fd8dd chore: bump buddy to 0.11.0
$ git diff --name-only 30fd8dd^ 30fd8dd | grep -E '^[^/]+/\.claude-plugin/plugin\.json$' | cut -d/ -f1
buddy

$ env HOME="$FAKE" bash scripts/check-profile-parity.sh buddy               # what the guard runs
OK: buddy 0.11.0 — not installed in any profile (nothing to keep in parity)
exit=0                                                                      # → allow

$ env HOME="$FAKE" bash scripts/check-profile-parity.sh codescout-companion # what the fixture drifted
exit=1                                                                      # → would deny
```

**The guard is not at fault.** Given `buddy` and a `$HOME` with no buddy record, exit 0 is
the correct answer and the not-installed branch is a deliberate, documented design choice
(it is what lets the Windows box and any fresh clone pass). The defect is in the test: its
fixture is **unreachable-by-construction** for any discovered commit that bumps a plugin
other than `codescout-companion`.

## Why it went unnoticed

`scripts/release.sh` runs `tests/run-all.sh` at **step 0** — before it writes its own
`chore: bump …` commit at step 4. So a release executes the suite against the repo state
that *precedes* the commit which flips `BUMP_SHA`'s plugin identity. **A release can never
observe the state it creates.**

This session ran two releases in order: `6b700e7` (codescout-companion 1.20.0), then
`30fd8dd` (buddy 0.11.0). Each passed step 0 legitimately. The second one moved the most
recent `plugin.json` commit to a buddy bump, and nothing has run the suite since — the
only two commits after it are docs-only.

Note the shape: the failure is not a flake and not load-sensitive. It is a **deterministic
function of which plugin was bumped last**, so it will flip back to green the next time a
codescout-companion bump lands, hiding itself again without anyone fixing it.

## Fix

Derive the fixture's plugin from the same place the guard does, instead of hardcoding it.
`make_profiles` should take the plugin key as a parameter, and the test should compute it
from the discovered range — the same `grep -E '^[^/]+/\.claude-plugin/plugin\.json$' | cut
-d/ -f1` that `bumped_plugins` uses. Writing records for *every* plugin in the repo would
also work and is simpler, at the cost of a fixture that no longer names what it is testing.

**Whichever is chosen, add an assertion that the fixture's plugin set and
`bumped_plugins`' output are equal.** The bug is not that the plugin was wrong; it is that
nothing noticed they had diverged. A test whose fixture is derived from one source and
whose subject is derived from another needs the two tied together explicitly, or the next
divergence is silent in exactly this way.

Consider also whether `run-all.sh`'s final line should be harder to misread — see
*Related* below.

## Related

- **`roster-audit-session-log:F-14`** — same session, same reporting hazard: I first read
  this run as green because `run-all.sh` prints the *last sub-suite's* internal tally
  (`Total: 16. Pass: 16. Fail: 0.`) immediately above the overall
  `✗ Failed suites: test-pre-push-guard.sh` line. A summary that sits below a per-suite
  total gets read as the summary. The exit code is the only unambiguous signal.
- **`docs/trackers/repo-remediation-backlog.md`** `RM-21`.
- The R-5 self-validating-gate class: a control that reads the wrong world reports healthy
  by construction. Here the control read the right *world* but the wrong *subject*.

## Re-open trigger

If a codescout-companion bump lands and this suite goes green **without** the fixture
being parameterised, that green is the bug hiding, not the bug fixed. Check
`git log -1 -- '*/.claude-plugin/plugin.json'` before believing it.
