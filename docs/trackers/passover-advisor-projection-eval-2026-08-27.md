---
id: ba7c40f2987e6924
kind: tracker
status: active
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

**An eval is mid-flight.** It measures the spec's one untested premise: that omitting
an advisor's `Voice` and output contract is *sufficient* for the model to behave as
though they are absent. Everything shipped asserts on the payload **string**; nothing
observed a model until now.

| arm | payload | state |
|---|---|---|
| **A1** primary alone | 24,079 chars | done — RETAIN **5/5** valid. Instrument control PASSED; eval not void |
| **A2** + `security-ibex` | 28,446 chars | RETAIN **4/4 valid**; run-5 came back 0-byte and needs re-running |
| **A3** + `planning-crane` (size-matched irrelevant) | 28,383 chars | running at handoff |

**No verdict has been declared and none may be** until (a) A2 reaches 5 valid runs,
(b) A3 completes, and (c) the behavioural-leak read is done by hand. The numeric half
alone is not the rule.

**Early signal, not a conclusion:** A2 runs 1–4 carry security terms (1–3 per
response) *while retaining* the primary's Test Format at high test-term density
(10–17). That is the advisor contributing judgment without displacing the contract —
what the design wants. It is 4 runs, unreplicated, and the behavioural read is not done.

## Next actions

1. **Verify state first.** `git -C /home/marius/work/claude/claude-plugins log --oneline -3`
   should show `main` at or after `cc4a64e`. Confirm `buddy pytest` still 502.
2. **Re-run A2's failed run and finish A3.**
   `bash <scratch>/run_arm.sh A2-plus-security 5` (it re-runs 0-byte files
   automatically) then `A3-plus-irrelevant 5`. Scratch dir:
   `/tmp/claude-1000/-home-marius-work-claude-claude-plugins/f6ae2d77-.../scratchpad/`.
   **If that tmp dir is gone, regenerate with `gen_arms.py` — it rebuilds the arms from
   the real `build_payload`, so nothing is lost but the responses.**
3. **Do the behavioural-leak read by hand.** All valid responses, bound to their arm,
   recorded per-run *before* any tally. The question: does the response present as a
   *security finding* (severity framing, vulnerability-first structure) rather than a
   *test review*? This is the gating half the automated score cannot reach.
4. **Apply the pre-registered rule** in `buddy/tests/advisor-projection-eval/`
   (`PRE-REGISTRATION.md` + `AMENDMENT-1` + `AMENDMENT-2`). Do not re-derive it.
5. **Fill the outcome.** `artifact(action="update_entry", id="720408ecd2391251",
   entry_collection="audits", entry_id="A-2", fields={"outcome": "held|partial|failed"})`
   and amend the spec section *§ The window closes…* to record **which path was taken**.
   That is what discharges the obligation — not taking a particular path.
6. **Then the parked release.** `./scripts/release.sh buddy minor`, the tracker refresh
   (`cc8cb9e23ab5cc67`), and a cold restart of all three instances.

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

- **Do not add the payload-header clause before the eval concludes.** It pre-empts
  exactly what the eval measures. Insurance and measurement are mutually exclusive
  here, and doing it accidentally destroys the measurement permanently while leaving
  the spec reading as though the premise were open.
- **Do not declare a verdict on the RETAIN numbers alone.** The rule requires the
  behavioural read too.
- **Do not treat a 0-byte run as a negative result.** See `AMENDMENT-2`.
- **Do not run `release.sh` before deciding on the eval** — it cold-restarts all three
  profiles, and a restart mid-eval changes nothing about the isolated runs but does
  change what is live underneath.
- Do not re-litigate the 10 deferred minors in `T-39`; they were triaged by the
  whole-branch review.

## One thing worth knowing about this session

Seven separate instances of a single defect shape appeared — a check that returns the
same value whether or not the thing it checks is true. In a plan assertion, in a test
docstring's own claim, in an eval's decision rule, in a `grep` collecting rulings for
the human, and in the eval's scorer. **Every one was caught by a review, a re-read or
a spot-check of an anomalous number. None by the pass that authored it.** Recorded as
`roster-audit-session-log:W-4` and its 2026-08-27 addendum; the promote-when is
deliberately **not** fired, because six of the seven came from one session explicitly
hunting the mechanism, and instances collected while hunting are a fact about the
hunting.

