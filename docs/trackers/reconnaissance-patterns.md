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

## Template for new entries

<!-- Insert new R-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## R-N — title\n**Verdict:** ...\n...")
     Also update the Index table row at the top. -->
