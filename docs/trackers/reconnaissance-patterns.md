---
id: '8adad3b1ce0b5b85'
kind: tracker
status: draft
title: Reconnaissance patterns
tags:
- reconnaissance
- skill-meta
- scout
topic: reconnaissance
entry_prefix: R
entry_high_water_R: 5
---

# Reconnaissance patterns

Per-project aggregator for observations about the
`codescout-companion:reconnaissance` skill *as used in this project*.
Each entry is an R-N record with a verdict + evidence. Three buckets:

- **Hits** — scout caught drift before dispatch, saved measurable cost.
- **Misses** — scout failed to surface drift; a downstream gate (spec
  review, code review, test run, runtime) caught it instead.
- **Pattern proposals** — vocabulary / phase expansions ready to
  promote into `SKILL.md` once threshold datapoints land.

Entries are monotonic per project; never reuse or skip an ID. Default
promote-when threshold is **3 datapoints**, unless the entry argues
otherwise.

## Why per project, not global

Recon patterns are project-shaped: a Rust workspace's blast-radius
question (struct-field threading, trait-method addition) differs
from a TypeScript monorepo's (barrel re-exports, generated types).
Per-project R-N ledgers keep the lessons close to the substrate that
produced them. Cross-project lessons graduate via the sync flow.

This project's substrate is **Claude Code hook scripts** — small Node
entrypoints driven by event JSON on stdin, each with a colocated bash
suite. The suites deliberately differ in *kind* (config-wiring guards vs.
end-to-end stdin drivers), which is the local hazard R-1 records.

## Index

| ID | Date | Verdict | Pattern | Evidence (session-log) |
|----|------|---------|---------|------------------------|
| R-1 | 2026-07-28 | hit | Spec testing sections assert on the harness; scout the cited exemplar, not just the code under change | `subagent-bootstrap-session-log.md` F-1 + F-2 + F-3 + W-1 |
| R-2 | 2026-07-28 | miss | Scout enumerated one test directory, not all of them — missed the suite that already covered the hook | `subagent-bootstrap-session-log.md` F-4 + F-5 |
| R-3 | 2026-08-26 | hit | A filed drift finding is a claim about current state — scout the claim the number supports and the tracker's live state, not the quoted number | `roster-audit-session-log.md` F-1 + F-2 + W-1 |
| R-4 | 2026-08-26 | promoted | Positive-control law was loaded and still missed — framed for searches, instrument was a report. 6th recurrence; placement fix applied `f53aaea`, effect unmeasured (eval baseline n=0) | `roster-audit-session-log.md` F-4 + F-6 |
| R-5 | 2026-08-26 | proposal | A check that reads where the writer wrote, or is computed from what it judges, cannot fail — four instruments in one session. HELD pending the R-4 eval baseline | `roster-audit-session-log.md` F-6 + F-7 + F-8 + W-2 |

## Status vocabulary

| Verdict | Meaning |
|---------|---------|
| `hit` | Scout caught drift; subagent / implementer avoided rework. Pair with a W-N in the source session log. |
| `miss` | Scout did not catch drift; a downstream gate caught it. Pair with an F-N in the source session log. Refines scout phases. |
| `proposal` | Vocabulary / phase expansion derived from one or more hits/misses. Lands in `SKILL.md` after threshold datapoints. |
| `promoted` | Proposal landed in `SKILL.md`. Pin the commit SHA + skill version. |
| `wontfix` | Considered, declined — costlier than the miss it would prevent. Pin the rationale. |

## How to append

When Phase 3 of a recon scout produces evidence about the *skill itself*
(not just the work stream), capture it here in addition to the
work-stream session log:

```python
# Cite session-log evidence; don't duplicate prose.
edit_markdown(
    path="docs/trackers/reconnaissance-patterns.md",
    action="insert_before",
    heading="## Template for new entries",
    content="## R-N — <title>\n**Verdict:** hit | miss | proposal\n..."
)
# Add a matching row to the Index table.
```

## How to sync

When an R-N proposal reaches its promote-when threshold, route it by the
craft-shaped vs. project-shaped test in `SKILL.md` — *"would this rule
mislead a different project?"*

**Craft-shaped** (no) → sync into the skill:

1. Open a PR (or change) against `codescout-companion/skills/reconnaissance/SKILL.md`.
2. The PR description references the R-N entries + their host
   session-log F-N / W-N evidence by name.
3. After merge, edit the R-N entry here: set `Verdict: promoted` and pin
   the commit SHA + skill version in the entry body.
4. Other projects pick up the change on next skill update.

**Project-shaped** (yes) → promote to this project's codescout
`reconnaissance` memory topic instead, as a single bounded imperative
plus its `(R-N)` pointer. Cap that topic at ~10 rules.

This is a manual flow — no automated cross-project aggregation. The
skill is the canonical destination for craft lessons; per-project
trackers are the substrate that earns its way in.

## R-N entry template

```markdown
## R-N — <one-line title>

**Verdict:** hit | miss | proposal | promoted | wontfix

**Observed:** <date, work-stream name>

**Source session log:** <path or topic>, citing F-N / W-N entries.

**Pattern (or pattern that failed):** <one paragraph — what the scout
did / didn't do, and why the outcome happened>.

**Evidence:** <concrete cost or saved cost — round-trips, tests that
would have failed, files that would have been wrongly edited>.

**Pattern proposal (if any):** <the SKILL.md change that would prevent
this miss / institutionalize this hit>.

**Promote-when:** <criterion — usually N more datapoints of the same
shape; can be 1 if the proposal is cheap and clearly correct>.
```

## R-1 — Spec testing sections assert on the harness, and harness claims go unscouted

**Verdict:** hit

**Observed:** 2026-07-28, subagent bootstrap injection work stream
(`codescout-companion` hooks — adding the `PROJECT BOOTSTRAP` triad to
`SubagentStart`).

**Source session log:** `docs/trackers/subagent-bootstrap-session-log.md`,
citing F-1, F-2, F-3 and W-1.

**Pattern:** The scout fired between committing a design spec and invoking
`writing-plans`. It read both the production code the spec changes
(`subagent-guidance.mjs`, `lib.mjs`, `detect.mjs`, the worktree guard pair) *and*
the test files the spec names as exemplars. The second half is what paid. All
three defects were in the spec's Testing section — a cited exemplar that does not
demonstrate the technique it is cited for (F-1), a fixture that cannot produce
the state it asserts (F-2), and an undecided strategy where two sibling suites
diverge (F-3). The design body — channel choice, payload composition, root
resolution, sibling-hook interaction — survived the scout unchanged.

The asymmetry is the finding: design decisions had been argued through in
brainstorming dialogue, so they were already stress-tested. The test table was
written straight to disk and never questioned. Scout coverage that stops at "the
code under change" misses that half entirely.

**Evidence:** Three defects caught pre-plan, zero subagents dispatched.
Counterfactual costed in W-1: one full plan revision plus ~3 implementer
round-trips. F-2 is the one that would plausibly have shipped — a case worded
"non-codescout cwd → empty output" passes by vacuity on a configured machine, so
it reads green while asserting nothing. Concretely, `detect.mjs` resolves
`HAS_CODESCOUT` from a routing-config override, `<cwd>/.mcp.json`, then
user-level `.claude.json` / `settings.json`; nothing under `<cwd>/.codescout/`
participates, so no per-project fixture can close that gate. F-1 would have
surfaced at the first output-shape assertion the implementer tried to write,
because `pre-task-hint.test.sh` — the cited exemplar — only `jq`s `hooks.json`
and never invokes its hook.

**Pattern proposal:** Add a harness bullet to Phase 1's scout checklist —
*"When a plan or spec names a test file as an exemplar, or claims a fixture can
produce a given state, read that test file's body and the detection/config code
the fixture depends on. A cited exemplar is a checkable claim (R-19 class).
Suites in one directory routinely differ in kind — config-only wiring guards vs.
end-to-end stdin drivers — and a config-only exemplar cannot express
output-shape assertions."*

By the routing test this is **craft-shaped**: it would not mislead a different
project, since "read the exemplar you cite" holds in any repo. The specific fact
that `HAS_CODESCOUT` is config-based is project-shaped and belongs in the
`reconnaissance` memory topic if it recurs.

**Promote-when:** 2 more datapoints of the same shape — a spec or plan citing an
unread exemplar, or asserting a fixture that cannot produce the asserted state.
This repo is hook-heavy and its per-hook suites deliberately differ in kind, so
the shape should recur here. If it recurs *only* in hook work, keep it
project-scoped in the `reconnaissance` memory topic rather than promoting to
`SKILL.md`.

## R-2 — Scout searched one test directory and concluded "no tests exist"

**Verdict:** miss

**Observed:** 2026-07-28, subagent bootstrap injection work stream — same scout as R-1,
caught one stage later by a downstream gate.

**Source session log:** `docs/trackers/subagent-bootstrap-session-log.md`, F-4 and F-5.

**Pattern that failed:** The scout established "`subagent-guidance.mjs` has no test
file" from a single `ls codescout-companion/hooks/` — the directory where sibling hooks
keep colocated `*.test.sh` files. It never enumerated `tests/`. But `tests/run-all.sh`
globs **both** `tests/test-*.sh` and `codescout-companion/hooks/*.test.sh`, and
`tests/test-subagent-guidance.sh` (4 cases) had been driving this exact hook all along.
The scout even read `tests/run-all.sh` and quoted its hook-test glob while missing the
`tests/test-*.sh` term on the same line.

The same one-directory blind spot hid `tests/lib/fixtures.sh` — a 179-line helper
library with `write_routing_config`, `make_memories`, `make_system_prompt`,
`make_worktree`, and assertion helpers. Its absence from the scout is what made the
plan invent a `CS_SUBAGENT_GUIDANCE_FORCE` env seam: production code added purely for
testability, in a repo that already had a fixture idiom for exactly that job.

**Caught by:** the Task 1 code review (Opus), after the seam had already been
implemented, committed, and recorded in a spec, a plan, a session log, an R-N entry,
and four commit messages.

**Evidence:** One task's work reverted, one plan amended, five documents corrected. The
seam shipped with no discriminating test — reverting the gate change left the suite
8/8 green, so nothing would have caught its removal. Two further facts surfaced only
under controller re-verification, and one contradicted the reviewer: `write_mcp_json`
does **not** open the codescout gate (`HAS_CODESCOUT=false` — `detect.mjs` matches
`/codescout/` against the server `command`/`args`, and the fixture writes
`command: <dir>/fake-ce`; the server key is never consulted), while
`write_routing_config '{"server_name":"codescout"}'` does. So the pre-existing suite's
exclusion cases were themselves vacuous, and its system-prompt case passed only on a
machine with codescout configured.

**Pattern proposal:** Add to Phase 1's scout checklist —
*"Before concluding that no test covers a symbol, enumerate every test root the runner
actually globs, not the one directory where siblings keep theirs. Read the runner's
glob list and search each term. An absence claim is only as wide as the search that
produced it, and 'no tests exist' is the absence claim most likely to be acted on."*

By the routing test this is **craft-shaped** — multi-root test layouts are ubiquitous
(`tests/` + colocated, `__tests__/` + `*.spec.ts`, `src/**/test_*.py` + `tests/`), so
it would not mislead another project. Pairs naturally with R-1's harness bullet: R-1
says *read the exemplar you cite*, R-2 says *bound your absence claims by your actual
search*.

**Promote-when:** 1 more datapoint. Lower than the default 3 because the proposal is
cheap, purely additive, and this miss cost a full task revert plus five corrected
documents — the asymmetry between the fix's cost and the miss's cost argues for a low
bar.

**Cross-reference:** R-1 is the hit half of this same scout. Both concern claims about
the *test harness* rather than the production code, and the design body was correct in
both. Two entries, one lesson: this scout's blind spot was the harness, in both
directions — the exemplar it cited without reading, and the suite it never found.

## R-3 — Re-measuring a drift finding's quoted number is not auditing it

**Verdict:** hit

**Observed:** 2026-08-26, buddy-roster-audit work stream — reviewing a cross-repo research handoff (a new `validation-domain-coverage.md` with eight `VG-N` entries) before accepting any of it.

**Source session log:** `roster-audit-session-log.md`, citing `roster-audit-session-log:F-1`, `roster-audit-session-log:F-2`, `roster-audit-session-log:W-1`.

**Pattern (or pattern that failed):** A **doc-vs-code drift finding is itself a claim about current state**, and the number it quotes is the least of it. `VG-8` cited one datum from its target — `buddy-introspection` `#20`'s heading, `security-ibex — Length 167 lines` — against 181 lines on disk. Re-measuring that integer confirms the drift and closes the entry. Opening `#20`'s four-line body instead showed *"others 47–60 lines"* and *"roughly 3× per specialist baseline"* to be false (the audited ten measure 118–136; `codescout-pika` at 316 outweighs `security-ibex` outright), which falsifies the `Fix: Accept` disposition the number was there to support. Reading the same tracker's § Live state — two screens above the entry, not cited at all — showed `specialists_scanned: 10/10` against a roster of twelve. The scout that catches these is not a better re-measurement; it is reading **the claim the datum serves, and the live state of the tracker holding it.**

**Evidence:** Two findings (`roster-audit-session-log:F-1`, `roster-audit-session-log:F-2`), both invisible to a re-measurement of the quoted number, both changing a disposition rather than a value. Cost of the cheap check: one integer edited, `#20` re-blessed by the audit meant to test it, and `active-plan.md` `T-35` (overdue since 2026-08-15) left re-auditing 10 of 12 specialists with no signal its scope had grown. Cost of the pattern: two commands — `wc -l buddy/skills/*/SKILL.md` and reading four lines of body.

**Pattern proposal (if any):** Extend the Phase 1 bullet *"A proposed fix — and equally a prohibition — is a claim about CURRENT STATE. Verify it before designing around it"* from **proposals** to **filed findings**: when the seam is an existing tracker entry, scout the entry's *supporting claims and its tracker's live-state block*, not just the datum it quotes. This is the same law one step downstream — the existing bullet guards *"just pin X"*; this guards *"X was 167, now it's 181, filed."* Both fail because a recorded number reads as settled rather than as an assertion.

**Promote-when:** one more datapoint of this shape from a different tracker family — ideally in another repo, so the routing test (*"would this mislead a different project?"*) is answered by evidence rather than by argument. At two independent datapoints it is craft-shaped and belongs in `SKILL.md` Phase 1, not in a project memory.

**Valid:** dated 2026-08-26

**Rests on:** `roster-audit-session-log:F-1` and `roster-audit-session-log:F-2`, both measured against `buddy/skills/` source at plugin version 0.9.1.

## R-4 — The positive-control law was in context and still did not fire — it is framed for searches, and the instrument was a report

**Verdict:** promoted — applied 2026-08-26, `main` `f53aaea`, patch-id `5576ef7bc111539ce56ac0b7170cfbe631e25e9c`. (Originally filed `miss`; the miss stands as the record, the verdict tracks the disposition.)

Both placement changes landed in the Phase 1 bullet: the positive-control sentence now reads *"one per state you believe the instrument can report"* and states that a single confirmatory probe cannot reveal a **missing** state, and it explicitly fires on *"anything you are about to generalise from — a report, a scan, a linter, a diagnostic — not only on a query that came back empty."* The recurrence chain in the bullet's own parenthetical now names this entry as the sixth.

**Effect UNMEASURED, and it should not be recorded as validated on argument alone.** `buddy/tests/reconnaissance-eval/` has cases pinned but **no baseline run (n=0)**, which is precisely the surface that would score a behavioural change to scout conduct. The skill's own Skill-maintenance section says re-score before any change targeting behaviour; there is nothing to score against yet. Establishing that baseline is the work this entry actually generates.

**Not shipped.** Committed on `main`, no version bump — all three profile caches still serve the pre-fix copy.

**Observed:** 2026-08-26, buddy-roster-audit work stream. The reconnaissance skill was **invoked in this same session**, so the law below was in context when the error was made.

**Source session log:** `roster-audit-session-log.md`, citing `roster-audit-session-log:F-4` (the wrong finding, corrected same day) and `roster-audit-session-log:F-6` (the tooling gap it exposed).

**Pattern (or pattern that failed):** Phase 1 already carries the remedy:

> **Run a positive control before trusting either shape:** make the instrument find or rank one case whose answer you already know, before believing the case you don't.

It did not fire. I asserted that ~60 `T-N` citations dangle, from the premise that no `T-N` heading exists. The premise was true; the inference was a claim about `link_scan`'s **state space**, and I took it from a mental model of the resolver rather than from its output — which was open in a buffer at the time, with the `raw` token of every reported citation in it. A peer session made the mirror-image error on the same namespace, inferring *resolution* from absence in an array capped at 50 against a population of 70. There turned out to be a third state, **inert**, that neither of us knew existed: a prefix with zero definers is never a citation candidate, so it is neither resolved nor reported.

Why the law did not reach the moment of need: **it is framed around searches.** Its examples are grep, a path, a sort key, a field name — *"a search that finds nothing is evidence about the search."* `link_scan` does not read as a search. It reads as a report, and a report feels like testimony rather than an instrument answering a predicate you supplied. The two-word tell — *"either shape"* — covers this case exactly, and I did not connect it.

**Evidence:** Two filed findings, one of which reached a `docs/issues/` bug file before correction. Cost of the positive control that would have prevented both: **one call**. Resolve `U-28` (known undefined → expect dangling) and `D-6` (known defined → expect resolved) alongside `T-35`. Three tokens, three expected states; the token that matches neither expectation names the missing state on the spot. Cost of not doing it: a wrong mechanism filed as an issue, a wrong prescription inside it (the fix ordering inverted), and a second session's conclusion left standing on an unsound premise.

**Pattern proposal (if any):** This is the skill's own **"Unreachable"** staleness class — *"general enough, and still not reached at the moment of need. Remedy is placement, not rewording."* The bullet already names five self-labelled recurrences of this law in codescout's ledger (`R-3 → R-113 → R-77 → R-79 → R-104`). **This is the sixth, and the first where the skill was demonstrably loaded and the law still missed** — which is evidence about placement rather than about the reader.

Two changes, both placement:

1. **Widen the trigger from searches to instruments.** The law should fire on *any* tool output you are about to make a categorical claim from — a report, a scan, a linter, a diagnostic — not only on a query that returned zero. The operative condition is "I am about to say *all X are Y*", not "my grep came back empty".
2. **Name the recipe in terms of known-state cases, plural.** "One case whose answer you already know" invites a single confirmatory probe, which cannot reveal a *missing* state. What works is one case per state you believe exists — and a case that matches none of them is the discovery. State it that way.

Per the skill's own rule that a recurrence is a defect in the promoted text, this should re-promote the evolved form rather than sit as a sixth instance.

**Routing note, stated rather than assumed:** this law keeps recurring in sessions that never invoke the skill, which by the skill's routing test points at codescout's `project-activation-bootstrap` surface instead. That route requires a **base arm** — a measurement that an unaided agent does not already do this. I have one datapoint, not a measured arm, so I am not proposing the session-opening slot. Recording the gap so the next instance can supply the arm rather than re-derive the argument.

**Promote-when:** immediately for change 1 and 2 above, since the threshold was met five recurrences ago and the proposal is a rewording of placement rather than a new rule. Do not wait for a seventh.

**Valid:** dated 2026-08-26

**Rests on:** `roster-audit-session-log:F-4` and `roster-audit-session-log:F-6`, both measured from `link_scan` output rather than from the resolver's documented rule; and the five-recurrence chain the Phase 1 bullet cites for itself.

## R-5 — An instrument that validates its own write is not a check — four found in one session

**Verdict:** proposal

**Observed:** 2026-08-26, buddy-roster-audit and release-integrity work streams, one session.

**Source session log:** `roster-audit-session-log.md`, citing `roster-audit-session-log:F-4`, `roster-audit-session-log:F-6`, `roster-audit-session-log:F-7`, `roster-audit-session-log:F-8`, `roster-audit-session-log:W-2`.

**Pattern (or pattern that failed):** `R-4` is about the *reader* — run a positive control before generalising from output. This is its structural twin, about the *instrument*: **a check that reads the same place the writer wrote, or that is derived from the quantity it is meant to judge, cannot fail.** It reports healthy in the broken world by construction, so its green carries no information. Four instances turned up in a single session, in four different systems, none of which raised anything:

1. **`release.sh` steps 5 + 6.** Step 5 repoints install-record element `[0]`; step 6 validates element `[0]`. The record is an array. A sibling at `[1]` pinned to a superseded version was invisible, and the release printed `✅ … (pushed)` with ✓✓✓. (`F-7`)
2. **The `version-bump-checklist` tracker.** Documented in CLAUDE.md as "the richer cross-check of the same two failure classes" — and its gather prompt also read `[0]`. Not richer on this axis; it shared the defect. (`F-7`)
3. **`link_scan` / `doctor`.** A citation can be resolved, dangling, or **inert** — prefix has no definer anywhere, so the token is never a candidate. Neither surfaces the third state; `doctor`'s two relevant checks iterate *entries*, and an artifact declaring no `entry_prefix` owns none. ~60 citations produced no edge and no warning. (`F-6`)
4. **`VG-7`'s split-quality ratio.** `(base + lens) / monolith`, prescribing that general material move from addendum into base. Relocation leaves both terms unchanged, so the metric is invariant under the exact fix it asks for. (`F-8`)

The family resemblance to a codescout issue filed the same day by another thread — `index(action="status")` reporting `indexed: true, queryable: true` off a single chunk because it never checks coverage — makes five, across two repos.

**Evidence:** Two of the four produced findings that were filed *wrong* before being caught (`F-4` claimed dangling where the truth was inert; the release was reported green over a stale record). Two produced mis-scoped work (`headroom` backlog 2b credited with a context lever worth 6 lines; three further specialists queued on that costing). The catch in every case was the same move, not four different insights: build the known-bad case and see whether the instrument says so (`W-2`).

**Pattern proposal (if any):** a Phase 1 bullet, adjacent to the positive-control law rather than inside it, because the target differs — that law disciplines the reader, this one disciplines what you accept *as* a check:

> **A check that reads where the writer wrote, or is computed from the thing it judges, cannot fail — treat its green as unmeasured.** Before trusting any gate, ask what it reads and whether that is the same place the change landed. Three tells: it validates the field it just set; it iterates a collection the defect removes from; it is a ratio whose numerator and denominator both contain the quantity being moved. The remedy is a second, independently-sourced signal — read the *consumer's* copy, enumerate the *whole* namespace, measure the absolute quantity rather than its share.

**Promote-when:** the four instances above are already measured, so the threshold is met on evidence. Holding it as `proposal` rather than promoting immediately for one reason: `R-4` shipped in `codescout-companion` 1.16.17 and its effect is **unmeasured** (`buddy/tests/reconnaissance-eval` has cases pinned, baseline n=0). Adding a second Phase 1 law before the first is scored would put two unmeasured additions into a bullet whose own audit section warns that the bias on a promoted set should be subtraction. **Sequence: establish the eval baseline, score `R-4`, then promote this.**

**Valid:** dated 2026-08-26

**Rests on:** `roster-audit-session-log:F-6`, `F-7`, `F-8` as the three instrument measurements, `F-4` as the wrong finding one of them produced, and `W-2` as the countermeasure that caught all of them.

## Template for new entries

<!-- Insert new R-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## R-N — title\n**Verdict:** ...\n...")
     Also update the Index table row at the top. -->
