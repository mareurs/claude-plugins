---
kind: bug
status: fixed
title: 'pre-push-guard test drifts a different plugin than the guard checks, so its positive control silently went green-to-red'
tags:
  - tests
  - release
  - guards
  - fixture-unreachable
  - positive-control
last_observed: 2026-09-01
closed: 2026-09-01
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

## Fix provenance

- **SHA:** `049535752c9fea41a7cf7aacc6b58e7200b6a589` (`main`)
- **patch-id:** `d2d3c39398b2cca7c731cbf2bf2934f29e053721` (`git show <sha> | git patch-id --stable`)

The patch-id is recorded alongside the SHA because the SHA orphans on a rebase and
keyword recovery from a subject line measured 2–153 ambiguous candidates. Resolve it with
redirects rather than pipes:

```
git log --all -p > /tmp/all.patch
git patch-id --stable < /tmp/all.patch > /tmp/patch-ids.txt
grep d2d3c39398b2 /tmp/patch-ids.txt
```

## Fixed 2026-09-01

`make_profiles` now takes a mode (`stale` | `canonical`) and writes a record for **every**
plugin in `BUMP_PLUGINS`, derived with the same expression `bumped_plugins` uses, at each
plugin's own canonical version. The fixture can no longer name a different plugin than the
guard checks.

Two assertions were added, deliberately separate:

- **fixture write-through** — a record exists for every plugin in `BUMP_PLUGINS`. Both
  sides derive from `BUMP_PLUGINS`, so this checks the fixture *writer* and nothing more.
  It is labelled that way in the file: the first version of this fix presented it as *the*
  tie, which would have been a check computed from the thing it judges — the very class
  this file now guards.
- **the real tie** — the plugin named in the guard's own stderr must equal the set the
  fixture drifted. Left side from executing the hook, right side from the test's own
  derivation, so a future divergence fails and names both.

**Verified by mutation, not by the green alone.** Forcing `BUMP_PLUGINS=codescout-companion`
after derivation reintroduces the exact original defect; the control and the real tie both
go red (`guard=[] fixture=[codescout-companion]`) while the write-through check stays
green, confirming the labelling is accurate.

`bash tests/test-pre-push-guard.sh` → **19 passed, 0 failed**. `./tests/run-all.sh` →
**exit 0**, `✓ All suites passed.`, zero `FAIL` lines — checked by exit code, which is the
only unambiguous signal here (see *Related*).

**Not addressed, deliberately:** `release.sh` still runs the suite at step 0, before its
own bump commit, so a release still cannot observe the state it creates. That ordering is
correct for its own reasons — gating after the bump would abort a release on the drift the
release repairs. The fixture no longer depends on it, so the hazard is closed at the fixture
rather than at the ordering.
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
