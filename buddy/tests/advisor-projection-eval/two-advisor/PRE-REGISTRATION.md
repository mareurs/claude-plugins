# Advisor projection, two advisors — pre-registration

**Registered 2026-10-27, before any arm was run.** Committed first on purpose, as
`PRE-REGISTRATION.md` in the parent directory was: a decision rule written after
seeing results is not a decision rule. Closes `RM-24` in
`docs/trackers/repo-remediation-backlog.md`, which carries the item forward from the
archived advisor-projection passover.

## The claim under test

The one-advisor eval (`../RESULTS.md`) found that omitting an advisor's `Voice`,
`Method` and output contract is enough: the primary kept its own contract (RETAIN
5/5) and nothing leaked (behavioural leak 0/5). It tested **one** advisor. The design
spec's § *Resolved* names **two or more advisors projected together** as the only
condition that re-opens the premise, and the passover calls it "where crowding-out
would plausibly first appear."

This eval asks the same question with two advisors in the payload.

## What is carried over, unchanged

- Each arm is the real `build_payload` output from the shipped assembler, never a
  hand-written approximation. `make_arms.py` calls it.
- One stimulus, the `get_invoice` coverage review in `../stimulus.md`, identical in
  every arm. It tempts both advisors: the code has an authorization branch and an
  IDOR-shaped lookup (security) and puts that check inline in the handler
  (architecture).
- Instrument positive control, checked FIRST. **If B1 RETAIN < 4/5 the eval is VOID.**
- Invalid-run handling from `../AMENDMENT-2.md`: a 0-byte or errored response is
  INVALID, excluded from the denominator and re-run. **The registered n is n *valid*
  runs.**
- The behavioural read is blind (deterministic content-hash shuffle, key unread until
  the last score is recorded).

## Arms

| arm | advisors | projected advisor chars |
|---|---|---|
| **B1** primary alone | none | 0 |
| **B2** two relevant advisors | `security-ibex`, `architecture-snow-lion` | 4,365 + 4,701 = 9,066 |
| **B3** two size-matched irrelevant advisors | `planning-crane`, `refactoring-yak` | 4,302 + 5,150 = 9,452 |

The primary is `testing-snow-leopard`. B3 was chosen by measurement: of the pairs that
have nothing to say about a test-coverage review, it is the closest to B2 in projected
size (+386 chars, 4.3%). Projected sizes are `project_advisor` output measured on
2026-10-27. B3 exists so that a difference between B1 and B2 can be attributed to the
advisors' content and not to roughly 9 KB of extra text.

## Observables

All mechanical except the behavioural read.

- **RETAIN (load-bearing).** The response contains any of `**Contract:**`,
  `**Mutation-survival:**`, `**Boundaries covered:**`. These are in the payload of
  every arm, so the observable can move in either direction.
- **DISPLACEMENT** = B1 RETAIN − B2 RETAIN. The falsification signal.
- **LANDING (the treatment-side positive control, registered up front).** The number of
  B2 runs whose response contains the exact name `security-ibex`, and the number
  containing `architecture-snow-lion`. Also counted in B1 and B3 for the same two
  names (expected 0), and in B3 for `planning-crane` and `refactoring-yak`.
  A behavioural leak of 0 reads the same whether projection works or the advisor text
  was never attended to. LANDING is the observable that separates those two worlds. It
  was found by an unregistered read in the one-advisor eval (`../RESULTS.md`,
  "The unregistered observable that carries the result"); this time it is registered
  first.
- **BEHAVIOURAL LEAK, two kinds, read blind.** For each response: (a) does it present as
  a *security finding* (severity ratings, exploit framing, vulnerability-first
  structure); (b) does it present as an *architecture decision record* (a Decision /
  Alternatives / Consequences structure) instead of a *test review*? Recorded per run
  before any tally. Vocabulary alone is not leakage: the stimulus is an authorization
  function, so security words appear in every arm. The scored question is presentation.
- **VERBATIM LEAK, non-gating.** Any of `**Severity:**`, `**Exploit sketch:**`,
  `**Category:**` (security) or `**Decision:**`, `**Alternatives considered:**`,
  `**Change scenarios absorbed:**` (architecture). Projection removes these strings from
  the payload, so a 0 is what both hypotheses predict. Reported for completeness only.

## Decision rule — pre-registered

N = 5 valid runs per arm, single stimulus. Rules apply to B2.

| condition | verdict |
|---|---|
| B1 RETAIN < 4/5 | **VOID.** No conclusion may be drawn. |
| LANDING < 4/5 for either advisor in B2 | **NOT INFORMATIVE about crowding-out.** The advisors were not attended to, so a clean result proves nothing. Report it as that, not as "holds". |
| RETAIN ≥ 4/5 **and** behavioural leak ≤ 1/5 of either kind | **Premise holds for two advisors.** |
| RETAIN = 3/5, **or** behavioural leak = 2/5 of either kind | **Inconclusive.** Raise N to 15 valid runs per arm before deciding, if the budget allows; otherwise report as inconclusive. |
| RETAIN ≤ 2/5 **or** behavioural leak ≥ 3/5 of either kind | **Premise falsified for two advisors.** Re-open the header-clause question; do not ship it on this eval alone. |

The conditions are checked in the order written. B3's role is attribution: if B2
differs from B1, B3 says whether the cause is the advisors' content or the extra text.

## Instrument

- Model: `--model sonnet` (the alias; the resolved model id is recorded from each run's
  JSON output).
- Isolation: `CLAUDE_CONFIG_DIR=~/.claude-test` (no plugins directory), `--strict-mcp-config`,
  `--disable-slash-commands`, `--tools ""`, `--no-session-persistence`, a fresh empty
  working directory per run. Running in a real profile would load buddy through the
  plugin channel and contaminate every arm.
- Billing: the `~/.claude-test` login hit its weekly limit on 2026-10-27, so runs use
  the `ANTHROPIC_API_KEY` in `prompt-engineering/.env`, passed to the subprocess only.
  Each call carries `--max-budget-usd`, and its `total_cost_usd` is summed.
- Budget: this eval shares a **$15** cap with the `VG-9` control runs. This eval's
  share is at most **$4**, including re-runs and the N = 15 extension. Spend is read
  from each run's own output, not estimated.

## Stated limits of this design

- **N = 5 detects a large leak, not a small one.** "Premise holds" means no leak at a
  rate this design could see.
- **One stimulus and one relevant pair.** A different task, or advisors whose
  heuristics pull harder against the primary's, could behave differently.
- **Two advisors, not three or more.** Crowding-out may need more.
- **The payload is delivered in the user turn**, not as `UserPromptSubmit`
  `additionalContext`. Close, not identical.
- **This measures leakage and crowding-out, not benefit.** Whether the advisors
  improved the answer is a separate question.
- **The reader of the blind responses is the same model family that built the eval.**
  The blinding protects against knowing the arm, not against shared blind spots.
