---
id: c4bff3d602a9465c
kind: tracker
status: archived
title: Passover — advisor-projection eval + parked buddy release — 2026-08-27
tags:
- passover
topic: advisor-projection-eval
time_scope: dated:2026-08-27
branch: main
origin_session_id: f6ae2d77-3ee3-46f9-ab0d-270afd61c592
---

## State

The buddy **specialist graph** shipped to `main` (`ea5f68c`..`77d3a03`, 8 commits,
fast-forward, 605 insertions). Specialists are composable as **primary + advisors**:
`advisors:` and `fragments:` frontmatter keys resolved hook-side in
`summon_bootstrap.py::build_payload`. Suite green — root suites 28/2/55/19/6/16,
buddy pytest 502. Design `docs/superpowers/specs/2026-08-27-buddy-specialist-graph-design.md`,
plan `docs/superpowers/plans/2026-08-27-buddy-specialist-graph.md`, task `active-plan:T-39`.

**The eval is DONE and the premise HELD.** It measured the spec's one untested
premise — that omitting an advisor's `Voice` and output contract is *sufficient* for
the model to behave as though they are absent. Everything shipped asserts on the
payload **string**; this is the only thing that observed a model.

| arm | valid n | RETAIN | behavioural leak | cites advisor by name |
|---|---|---|---|---|
| **A1** primary alone | 5 | 5/5 | 0/5 | 0/5 |
| **A2** + `security-ibex` | 5 | 5/5 | **0/5** | **5/5** |
| **A3** + `planning-crane` (size-matched irrelevant) | 5 | 5/5 | 0/5 | 0/5 |

A1 5/5 cleared the positive control, so the instrument had power. A2 hit the
pre-registered *premise holds* cell — **the header clause is no-shipped**, path 1 of
the one-way door, and the spec now records the premise **verified rather than
insured**. The behavioural read was blinded (deterministic shuffle, key unread until
the last score landed); all 15 responses kept the primary's voice and Test Format and
none presented as a security finding.

**The result actually rests on an unregistered observable.** A behavioural leak of 0
reads identically in the world where projection works and in the world where the
advisor text was never attended to at all — the pre-registered rule cannot separate
those. The advisor-citation count can: A2 5/5 against 0/5 in both other arms, two of
them quoting the `advisor: security-ibex` tag verbatim. It came out positive so the
verdict stands, but the rule as written would not have flagged an uninformative eval.
Written up as `roster-audit-session-log:W-4` addendum 2.

Full results and the limits that bind the claim (N=5, one stimulus, one advisor,
user-turn delivery): `buddy/tests/advisor-projection-eval/RESULTS.md`.
## Next actions

The eval work is closed. What remains is the parked release and the push.

1. **Verify state first.** `git -C /home/marius/work/claude/claude-plugins log --oneline -3`
   and confirm `buddy pytest` still 502.
2. **The parked buddy release.** `./scripts/release.sh buddy minor`, then the two
   steps the script cannot do: refresh the `version-bump-checklist` tracker
   (`cc8cb9e23ab5cc67`, needs the MCP tool) and verify every row ✅, then
   **cold-restart all three instances** — a `resume` is not enough.
3. **Decide on pushing.** 12+ commits are unpushed to `origin/main`; the merge was
   Option 1 (local). This is the user's call, not a cleanup step.
4. **Optional, and genuinely open:** the eval tested **one** advisor. Two or more
   projected together is untested and is where crowding-out would plausibly first
   appear. The spec's § *Resolved* names this as the only condition that re-opens the
   question.
## Working state

- **Branch `main`, clean.** `feat/buddy-specialist-graph` merged and deleted. The SDD
  workspace was deleted after its residue was persisted into `T-39`.
- **9+ commits unpushed to `origin/main`.** Never pushed after the merge — Option 1
  was "merge locally". Pushing is a separate decision.
- **buddy is running UNRELEASED code in all three profiles.** `plugin.json` says
  `0.9.2`, all three install records say `0.9.2`, and every parity check reports clean
  — because they all compare records to records, and none compares any of them to the
  **working tree**, which is what actually serves on a directory-source marketplace.
  Recorded in `cc8cb9e23ab5cc67` § State.
- Eval isolation is load-bearing: runs use `CLAUDE_CONFIG_DIR=~/.claude-test`
  (credentials, **no plugins dir**) and `--strict-mcp-config`, model pinned `sonnet`.
  Running in a real profile loads buddy through the plugin channel and contaminates
  every arm.

## Anti-goals

- ~~**Do not add the payload-header clause before the eval concludes.**~~
  **Resolved 2026-08-27.** The eval concluded and the clause is **no-shipped**. The
  standing form of this anti-goal now: do not add it *at all* without new evidence —
  the premise is measured, and adding the clause anyway would be insurance against a
  failure that did not occur, i.e. exactly the dead rule `prompt-hamsa` H12 exists to
  prevent.
- **Do not re-run the eval to "confirm" it.** N=5 with one stimulus is what it is;
  a second identical run adds nothing the stated limits do not already concede. If
  more power is wanted, change the design — more arms, a second stimulus, two
  advisors — not the sample size alone.
- **Do not treat a 0-byte run as a negative result.** See `AMENDMENT-2`.
- Do not re-litigate the 10 deferred minors in `T-39`; they were triaged by the
  whole-branch review.
## One thing worth knowing about this session

Seven separate instances of a single defect shape appeared — a check that returns the
same value whether or not the thing it checks is true. In a plan assertion, in a test
docstring's own claim, in an eval's decision rule, in a `grep` collecting rulings for
the human, in the eval's scorer, and finally in the eval's **verdict rule itself**.

The first six were each caught by a review, a re-read, or a spot-check of an anomalous
number — none by the pass that authored them. **The seventh is worse, and it is the
one worth carrying forward.** `PRE-REGISTRATION.md` was written and then *twice
deliberately re-reviewed for exactly this defect class* — `AMENDMENT-1` and
`AMENDMENT-2` are both fixes of this shape to that document — and the hole in its
verdict rule survived both. It was caught only by contact with data, by noticing a
signal the design never asked for.

So "add a checking step at authoring time" is the weaker reading. Two dedicated review
passes over a two-page document, by a reader holding the law and looking for it, did
not surface it. The sharper hypothesis, recorded for later test: for any eval whose
failure signal is an **absence**, pre-register a **treatment-side positive control** —
a second signal that goes to zero when the intervention is inert — and check it first.
`prompt-hamsa` H12 asks this of the base arm only.

Recorded as `roster-audit-session-log:W-4` with two addenda. The promote-when is still
deliberately **not** fired: all seven came from one session, and instances collected
while hunting are a fact about the hunting. Instance 7 is the first that was not
produced by the hunt — which is the direction the criterion cares about, but "different
task, same conversation" is not an independent work stream.


## Consumed

Consumed 2026-09-01. Each Next action checked, not recalled:

1. **Verify state** — done.
2. **The parked buddy release** — **done.** `./scripts/release.sh buddy minor` → **0.11.0**
   (`30fd8dd`), and both steps the script cannot do: the `version-bump-checklist` tracker
   (`cc8cb9e23ab5cc67`) was refreshed with `commit_refresh=true` and verified row-by-row
   — `grep '^|.*[⚠❌]'` returns empty, the first all-green refresh (`139a3ed`).
   This closes the state this file flagged as *"buddy is running UNRELEASED code in all
   three profiles"*: `plugin.json` said `0.9.2` against a working tree nothing compared
   it to. Probed directly rather than inferred from the release output — all three profile
   caches now hold the released bytes.
3. **Decide on pushing** — done; `origin/main...HEAD` is `0 0`.
4. **Two-or-more advisors projected together** — **still open, and carried forward** to
   `docs/trackers/repo-remediation-backlog.md` `RM-24` with both of this file's binding
   constraints (do not re-run for power; eval isolation via `~/.claude-test`) and the
   treatment-side-positive-control lesson the thread ended on.

**One nuance on the cold restart**, which this file and the sibling roster-audit passover
both list: `/reload-plugins` was run in **this** instance (reported `3 plugins · 46 skills
· 6 agents · 24 hooks`). The other two instances are unverified from here — a session can
only observe its own process. That item is inherently per-instance and cannot be discharged
by any single session, which is why the sibling passover tags it
`[the one queue item a session cannot do for itself]`.

The `roster-audit-session-log:W-4` promote-when remains deliberately unfired — all seven
instances came from one session, and instances collected while hunting are a fact about the
hunting. That judgement is untouched here.

Archived via `artifact(action="move")`, not `git mv`.
