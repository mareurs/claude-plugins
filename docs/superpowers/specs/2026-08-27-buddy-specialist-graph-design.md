---
id: '8b513ec102abc6f0'
kind: spec
status: draft
title: Buddy specialist graph — composable primary + advisors over the existing binding layer
tags:
- buddy
- specialists
- composition
- graph
- design
topic: buddy-specialist-graph
---

## Problem

Buddy ships 12 specialists that cannot be combined. A session needing both a
testing lens and a security lens summons one, or summons the other, or summons
both and gets two voices talking over each other with two conflicting output
contracts.

The goal stated at the outset was four-fold: runtime composition, authoring DRY,
routing/discovery, and token economy. **This design serves three and defers the
fourth**, and the reasons are measurements rather than preferences.

## What the surface actually looks like (measured 2026-08-26/27)

Every number below was taken directly; none is estimated.

**Nodes exist, edges essentially do not.** 12 builtin specialists (10–22 KB each),
plus global (`~/.buddy/skills/`) and project (`.buddy/skills/`) scopes, discovered
by **path-scan at lookup time** — there is no registry file. Among the 12 there is
exactly **one** cross-reference (`ml-training-takin` → `data-leakage-snow-pheasant`).

**A schema exists, written as a style guide.** `buddy/data/skill-template.md` (283
lines) defines required / recommended / conditional sections and a canonical order.
Conformance: **12/12** carry `Voice`, `Operating Principles`, `Self-Traps`;
**11/12** carry `Method — Three Phases`, `Heuristics`, `Reactions`. Each owns
exactly one output contract — **11 distinct format names across the 12**
(`Finding Format` shared by two).

**Five composition mechanisms, four notations, one machine-readable.**

| # | Mechanism | Edge type | Notation |
|---|---|---|---|
| 1 | Scope precedence (project > global > builtin) | override | name collision — the only machine-readable one |
| 2 | Lens addenda `_<lens>.md` | typed section-addressed extension | filename convention |
| 3 | Summon bundle (SKILL + memories + memory-protocol + gates) | fixed include | hardcoded in `build_payload` |
| 4 | `REQUIRED SUB-SKILL:` | hard dependency | prose line |
| 5 | `Composes with` | soft affinity | prose line |

**Cross-specialist text duplication is 0.35%** — 3 substantive lines out of 853.
One boilerplate footer in 9 files, two lines shared by two files. The "12
specialists repeat the same spine" premise is false at the copy-paste level.

**Frontmatter already carries declared bindings.** 12/12 have `name` +
`description`; `codescout-pika` declares `inject_memory_topics`, `planning-crane`
declares `inject_trackers`. `summon_bootstrap.py::collect_bindings` resolves them
("Layer D"), tested in `test_summon_bootstrap.py` and `test_reload.py`.

## Decisions

**Primary + advisors, not merged personas or a panel.** One node owns the voice
and the output contract; others contribute subordinate sections. This kills voice
collision and format collision *by construction* rather than by merge rules, and
it generalises the one composition primitive that already works (`_<lens>.md`).

**Guides are reference-only.** They are `include_str!`'d into the codescout
binary and dispatched by a hardcoded match (`src/prompts/mod.rs:503-513`), so a
buddy-side hook cannot slice or serve them. Consequence: **token economy applies
to specialists only.**

**No new resolver.** `summon_bootstrap.py::build_payload` already assembles the
payload hook-side, on `UserPromptSubmit`. New edge kinds are new binding kinds in
that existing, tested assembler.

## The node and edge model

Two edge kinds, both declared in `SKILL.md` frontmatter:

```yaml
advisors:  [security-ibex]
fragments: [memory-protocol, gates]   # default when the key is absent
```

Resolution uses the existing three scopes and precedence for both. A `fragment` is
a plain markdown file with no `SKILL.md` and no Voice, resolved
`buddy/data/` → `~/.buddy/fragments/` → `.buddy/fragments/`.

**The default list is exactly what `build_payload` reads today, in its current
order** — `data/memory-protocol.md` then `data/gates.md`. Nothing else. Note in
particular that `data/cs_rules.md` is **not** part of the summon payload: its only
consumer is `cs_judge.py`, which embeds it in the codescout judge's LLM system
prompt. It is a shared fragment with a different consumer, and adding it to the
default would change the payload rather than preserve it. (Session memories are
also in the payload but are **not** a fragment — they are scope-collected per
specialist by `collect_memories()` and keep their own path.)

### The projection rule

A node loaded in the **advisor** role contributes only:

- `## Operating Principles`
- `## Heuristics`
- `## Self-Traps (Failure Modes to Avoid)`

and never `## Voice`, `## Method — Three Phases`, or its `## {{Domain}} Format`.

This requires **no rewriting of the 12 files**: the measured conformance (12/12 on
all three projected sections, one output contract each) is what makes the corpus
uniform enough to project along. Lens addenda become a special case — an advisor
shipping inside the primary's own directory, addressed by filename.

## Implementation surface

**Fast path** — `buddy/scripts/summon_bootstrap.py`:

- `collect_bindings()` gains `advisors` and `fragments`.
- `build_payload()` replaces its two hardcoded reads
  (`PLUGIN_ROOT/data/memory-protocol.md`, `gates.md`) with the resolved fragment
  list. **The default list reproduces today's payload byte for byte.**
- Advisor sections are appended after the primary's body and before the fragments,
  projected per the rule above, each under a heading naming its origin —
  `## Heuristics — advisor: security-ibex` — so the primary's own `## Heuristics`
  is never shadowed and the reader can attribute every line. Multiple advisors
  append in declaration order.

**Fallback path** — `buddy/commands/summon.md` Steps 1–2.6: loads primary +
advisor files and lets the model compose, exactly as it handles lenses today.

**The fallback stays deliberately dumber.** The projection rule lives only in the
assembler. Two implementations of one contract is the divergence risk in this
design, and the mitigation is to not have two: the fallback only runs when the
hook did not fire, and a fallback attempting to reproduce projection is where the
drift bug would come from.

## Error handling

Edges are names, so an advisor can name something not installed — and it fails
**silently**, as content that simply does not arrive.

1. **A pytest** walks every discovered specialist across all three scopes and
   asserts each declared `advisors:` / `fragments:` name resolves. CI-enforced.
2. **A runtime line** in the payload when a name does not resolve
   (`advisor 'X' declared but not installed`), because a project-scope specialist
   can name something the test environment never sees.

This is the defect class that made `T-N` citations inert, pre-empted.

## Testing

Four tests gate v1.

1. **Fragment default reproduces today's payload byte for byte.** The golden file
   **must be captured from HEAD before the change lands**, as a separate commit. A
   golden generated from the new code asserts that the new code equals itself and
   is green in every world, including one where fragments silently drop
   `gates.md`.
2. **Advisor projection — the exclusions are the test.** Asserting the payload
   *contains* the advisor's heuristics passes equally if the whole file was
   appended. The load-bearing assertions are the negatives: no advisor `Voice`, no
   advisor output format, primary's format present exactly once. Annotate them;
   they look redundant and are not.
3. **Dangling-edge lint fires** on a fixture declaring `advisors: [does-not-exist]`.
4. **Fragment scope precedence** — a project fragment shadows the builtin, asserted
   on the project text rather than on *some* text.

### Behavioural eval — specified, not gating

Unit tests prove the payload has the right sections; they cannot prove the model
adopts one voice and one output contract, which is the design's premise.

**The F-13 activation confound does not apply here.** A summonable skill loads only
when the model invokes it, so in the reconnaissance eval the activating clause was
also the treatment. `summon_bootstrap.py` is a `UserPromptSubmit` hook that injects
deterministically — activation is guaranteed by the substrate, not chosen by the
model. Lever and treatment are separable for the first time.

Three arms:

| arm | isolates |
|---|---|
| `summon testing` | baseline |
| `summon testing +security` | treatment |
| `summon testing +<size-matched irrelevant advisor>` | separates "advisor content helped" from "more text helped" |

Without the third arm the measurement has no resolving power between those two
hypotheses (`claude-plugins:W-4`).

**Falsifier, stated in advance:** if the model, given projected advisor heuristics
with no Voice, still adopts the advisor's voice or emits its output format, then
projection-by-omission is insufficient and the payload needs an explicit
instruction in its header.

#### The window closes, and one of the two remedies closes it permanently

Added 2026-08-27, from the whole-branch review. This section previously said
"specified, not gating" and stopped there — a caveat with no owner, no trigger and
no tracked obligation, which is `claude-plugins:W-5` committed on the same page
that cites W-5 under *Rests on*. This is that obligation, made explicit.

**The eval will never be cheaper than it is at this commit.** 0 of the 12 shipped
specialists declare `advisors:` or `fragments:`. That is not merely a coverage gap
— it is the eval's *baseline arm*, clean and free right now. The moment any shipped
specialist declares either key, the baseline stops being clean and the measurement
gets monotonically more expensive.

**And the cheap insurance is mutually exclusive with the measurement.** The
falsifier's own stated remedy is "an explicit instruction in the payload header" —
one clause added to the string at `summon_bootstrap.py:290-295`. But that clause
**pre-empts exactly what the eval measures**: whether projection-by-omission *alone*
suffices. Adding it does not defer the question; it destroys the ability to ask it.

So there are two defensible paths, and **doing neither is not one of them**:

1. **Run the eval first**, while the baseline arm is still clean, then decide
   whether the clause is needed. Three arms as specified above, including the
   size-matched irrelevant advisor.
2. **Add the clause now**, and amend this section to record that the premise was
   **insured, not verified**, retiring the falsifier explicitly.

**The hazard to guard against is path 2 happening by accident.** Someone adds the
header clause "to be safe", touches nothing else, and the result is permanent: the
eval can never be run, while this spec still reads as though the premise were open.
A future reader would have no way to tell the difference between "unverified and
still measurable" and "unverified and no longer measurable."

**Trigger — fires on either of these, whichever comes first:**

- **Before any shipped specialist declares `advisors:` or `fragments:`.** That
  declaration is what spends the clean baseline.
- **Before any edit to the payload header string** (`summon_bootstrap.py:290-295`).
  If the edit adds advisor-handling guidance, it is path 2 — amend this section in
  the same commit, or do not make the edit.

**Owner:** whoever takes `T-39`. The obligation is discharged by *recording which
path was taken*, not by taking a particular one.
## Cut from v1, and what brings each back

**`guides:`** — cannot deliver. Three routes, all closed: emitting
`get_guide("...")` for the model to call is the citation path, measured at **0 of
91 sessions**; a hook cannot call an MCP tool and codescout ships no guide CLI
subcommand; metadata-only delivers nothing. And auto-inject already delivers what
matters, keyed on the tool call rather than the persona — `tracker-conventions`
reaches 45% of sessions regardless of which specialist is summoned.

*Brings it back:* the guide ledger (`~/.local/state/codescout/guide_hints/`) is
keyed by session id and buddy tracks summons per session, so the two can be
joined. If sessions summoning a given specialist systematically **miss** a guide it
depends on, that is a real gap — and the fix is a codescout-side trigger, not a
buddy-side declaration. See `codescout` issue
`2026-08-27-guide-topics-are-atomic-nodes-in-an-unmodelled-graph.md`.

**`affinity:`** — a pointer whose only traversal is "someone notices and acts
later", unmeasured, whose only consumer (routing) is deferred. Same shape as
`guides:`; cut for the same reason.

## Deferred

**Routing / task-inferred advisor selection.** It needs the graph to exist before
it can traverse anything, and it is the least specified of the four goals.
Declared advisors ship in v1; ad-hoc selection (`summon testing +security`) is one
argument-parsing change to Step 1; inference is a later layer.

## Out of scope

- Extracting shared content from the 12 specialists. Measured duplication is
  0.35%; there is nothing to extract. The fragment layer makes the
  **already-shared** files declarable and scope-aware. It is not a de-duplication
  tool, and if it is later used as one, that indicates duplication this design did
  not measure — worth knowing on its own.
- Semantic (paraphrased) duplication across the 88 self-trap bullets. Not measured;
  two weak instruments, neither discriminating. **The design is invariant to the
  answer**, because an `include` mechanism only helps duplication that is already
  identical — for paraphrased duplication you must first unify the wording, which
  is the hard part, after which the include is bookkeeping.
- Moving guide bodies out of the codescout binary.

## Rests on

`claude-plugins:W-4` (a check returning the same value for every candidate reads
exactly like a check that passed), `claude-plugins:W-5` (writing the caveat
discharges the obligation to close it), `claude-plugins:R-5` (a check computed from
the thing it judges cannot fail), `roster-audit-session-log:F-13` (the activation
confound), `codescout:R-89` (freshness on build, process and distribution axes).

**Valid:** dated 2026-08-27
