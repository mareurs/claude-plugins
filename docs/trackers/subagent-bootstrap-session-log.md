---
id: '9ea452e9cf4d9fbe'
kind: tracker
status: draft
title: Subagent bootstrap injection — session log
tags:
- session-log
- reconnaissance
- codescout-companion
- hooks
topic: subagent-bootstrap
---

# Subagent bootstrap injection — session log

Work stream: adding the `PROJECT BOOTSTRAP` triad to `SubagentStart`
(`codescout-companion/hooks/subagent-guidance.mjs`).

Design spec: `docs/superpowers/specs/2026-07-28-subagent-bootstrap-injection-design.md` (commit `12abb55`).

## Index

| ID | Title | Severity | Status |
|---|---|---|---|
| F-1 | Spec cited a config-only test as the stdin-driving exemplar | med | fixed-verified |
| F-2 | Test case 1 unachievable as worded — `HAS_CODESCOUT` is config-based | med | fixed-verified (conclusion partly overstated — see correction) |
| F-3 | Machine-dependence strategy undecided; hook has no test seam | med | mitigated (real gap, wrong prescription — superseded by F-4) |
| F-4 | Scout concluded "no test file exists" from a one-directory search | high | fixed-verified |
| F-5 | `write_mcp_json` does not open the codescout gate; existing suite partly vacuous | med | fixed-verified |

## Wins Index

| ID | Title | Impact | Status |
|---|---|---|---|
| W-1 | Pre-planning scout caught three spec defects before any plan was written | med | validated (see correction — a fourth defect escaped it) |
## F-1 — Spec cited a config-only test as the stdin-driving exemplar

**Observed:** 2026-07-28, pre-planning reconnaissance for the subagent bootstrap
injection design, immediately after committing the spec as `12abb55` and before
invoking `writing-plans`.

**When:** Reading the spec's Testing section, about to turn its 8-case table into
an implementation plan.

**Expected (spec):** "Follow the `pre-task-hint.test.sh` idiom: bash, `PASS`/`FAIL`
counters, a `check` helper, hook driven by piping event JSON to stdin, output
parsed with `jq`."

**Got (scouted reality):** `codescout-companion/hooks/pre-task-hint.test.sh` is a
**config-only** test. Its 42 lines `jq` over `hooks.json` to assert the PreToolUse
matcher is `Agent`; it never invokes `pre-task-hint.mjs` at all. Its own header
says so — "This guards the wiring (config), not the script's emission logic — the
matcher is CC routing, invisible to the script when invoked directly." The actual
stdin-driving exemplar is `explore-inject.test.sh:19-21`:
`run() { printf '%s' "$1" | CS_EXPLORE_INJECT_FORCE=1 node "$HOOK"; }`, paired with
`jq -nc`-built payloads and a `mktemp -d` two-repo git sandbox.

**Probable cause:** Exemplar chosen by filename adjacency (both are small
Agent-related hook tests) without reading the body.

**Correction (2026-07-28):** this entry originally continued "The spec's neighbouring
claim — that `subagent-guidance.mjs` has no test file — *was* verified; the substitute
exemplar was not." That is false and is retracted. The no-test-file claim was **not**
verified — it rested on a single `ls` of one directory, and `tests/test-subagent-guidance.sh`
existed the whole time. See F-4. Neither claim in this entry's original probable-cause
was verified; one exemplar went unread and one absence claim went unbounded.

**Workaround:** Repoint the spec's Testing section at `explore-inject.test.sh` for
stdin driving + sandbox construction, keeping `pre-task-hint.test.sh` only as the
`PASS`/`FAIL` `check`-helper reference.

**Severity:** med — a plan written from the spec would have produced a config-only
test that never executes the hook, and cases 3–8 (every output-shape assertion,
i.e. the entire point of the suite) cannot be expressed that way. Caught before any
plan text or subagent dispatch.

**Status:** fixed-verified — the spec's Testing section was repointed at `explore-inject.test.sh` for stdin driving + sandbox construction; `pre-task-hint.test.sh` kept only as the `PASS`/`FAIL` `check`-helper reference.

**Fix idea / Pointer:** Spec § Testing, this session.

## F-2 — Test case 1 unachievable as worded — `HAS_CODESCOUT` is config-based

**Observed:** 2026-07-28, same scout.

**When:** Checking whether each of the spec's 8 test cases can be produced
deterministically.

**Expected (spec):** Case 1 = "non-codescout cwd → empty output (existing gate,
currently unguarded)", implying a fixture cwd without codescout yields
`HAS_CODESCOUT=false`.

**Got (scouted reality):** `detect.mjs` resolves `hasCodescout` from, in order: a
routing-config `server_name` override (`<cwd>/.claude/codescout-companion.json` or
`codescout-routing.json`), `<cwd>/.mcp.json`, then the **user-level** configs
`<claudeDir>/.claude.json`, `<claudeDir>/settings.json`, and `~/.claude.json` (the
last only when `CLAUDE_CONFIG_DIR` is unset). Nothing about `<cwd>/.codescout/`
participates in the gate. So on a machine where codescout is configured at user
level, a bare `mktemp -d` cwd still yields `HAS_CODESCOUT=true`.
`session-start.test.sh:18-23` documents precisely this and copes by SKIPping its
whole suite when codescout is absent: "HAS_CODESCOUT is config-based (not
per-project)."

**Probable cause:** The spec conflated the config-based gate with per-project state.
`HAS_CS_MEMORIES` / `CS_MEMORY_NAMES` / `HAS_CS_SYSTEM_PROMPT` *do* read
`<cwd>/.codescout/…`, so fixtures work for cases 3–7 — but not for the gate itself.

**Workaround:** Case 1 must override the environment, not just the cwd:
`HOME=$TMP CLAUDE_CONFIG_DIR=$TMP/empty-cfg` with no `.mcp.json` and no
`.claude/codescout-*.json` under cwd drives `hasCodescout=false` deterministically.
Setting `CLAUDE_CONFIG_DIR` is what seals the last path, since `detect` consults
`~/.claude.json` only when it is unset.

**Severity:** med — as worded the case would pass by vacuity on an unconfigured CI
box and fail on the author's machine: an inverted flake, green where it tests
nothing. The env-override formulation is deterministic on both.

**Status:** fixed-verified — but the conclusion was partly overstated.

**Correction (2026-07-28):** the core fact holds — `HAS_CODESCOUT` is config-based, and
a bare `mktemp` cwd does not close the gate. But this entry's framing ("no fixture can
close it") was too strong, and the plan inherited it as the justification for an env
seam. Verified: sealing `HOME` + `CLAUDE_CONFIG_DIR` **does** close the gate, and
`write_routing_config '{"server_name":"codescout"}'` **opens** it per-project. Fixtures
control the gate in both directions; no production seam is needed. See F-4, F-5.

**Fix idea / Pointer:** Spec § Testing case 1, this session.

## F-3 — Machine-dependence strategy undecided; hook has no test seam

**Observed:** 2026-07-28, same scout.

**When:** Same — resolving how cases 3–7 satisfy the codescout gate.

**Expected (spec):** Cases 3–7 set `HAS_CS_MEMORIES` / `CS_MEMORY_NAMES` /
`HAS_CS_SYSTEM_PROMPT` via `mktemp` fixtures. The spec is silent on how the gate
itself is satisfied.

**Got (scouted reality):** The two sibling precedents diverge, and the spec picked
neither. `explore-inject.mjs` carries a deliberate seam —
`if (process.env.CS_EXPLORE_INJECT_FORCE !== '1') { if (detectFor(cwd).HAS_CODESCOUT === 'false') process.exit(0); }`
— so its suite runs anywhere. `session-start.test.sh` has no seam and SKIPs
instead. `subagent-guidance.mjs` has **no seam**: a bare
`detectFor(cwd).HAS_CODESCOUT === 'false'` early exit.

Also surfaced, and needed by the plan: `subagent-guidance.mjs` imports
`{ readInput, detectFor, emit }` from `lib.mjs`. `git` is exported by `lib.mjs` but
not currently imported here, so the root-resolution change must extend that import.

**Probable cause:** The spec wrote its test table before scouting how sibling suites
satisfy the gate.

**Workaround:** Add a `CS_SUBAGENT_GUIDANCE_FORCE=1` seam mirroring
`explore-inject`'s, and state it in the spec. Cases 3–7 then run deterministically
regardless of machine config. Case 1 stays on the env-override path from F-2 — the
force seam bypasses the gate in the wrong direction to test the gate.

**Severity:** med — undecided in the spec means the plan resolves it arbitrarily,
and the SKIP branch would leave the new suite silently inert on any box without
codescout, including CI.

**Status:** mitigated — real gap, wrong prescription.

**Correction (2026-07-28):** the observation stands — the spec did leave the strategy
undecided, and the hook did lack a seam. The prescribed fix was wrong: it recommended
*adding* a seam, when the repo already had `tests/lib/fixtures.sh` for exactly this.
The entry surveyed `explore-inject.test.sh` and `session-start.test.sh` and treated
those two as the whole precedent space, having never enumerated `tests/`. Superseded by
F-4.

**Fix idea / Pointer:** Spec § Testing preamble + § Change surface, this session.

## W-1 — Pre-planning scout caught three spec defects before any plan was written

**Observed:** 2026-07-28, after committing the design spec (`12abb55`) and before
invoking `writing-plans`.

**Pattern:** When a spec's testing section names an exemplar test file, or asserts
that a fixture can produce a given hook state, **read the exemplar's body and the
detection code before planning** — not just the hook under change. Specs assert on
the *test harness* as much as on the production code, and harness claims are exactly
as checkable as type shapes.

**Counterfactual:** Without the scout the plan would have inherited all three
defects. Concretely: (1) a `subagent-guidance.test.sh` patterned on
`pre-task-hint.test.sh` would have contained only `jq` assertions over `hooks.json`
and never executed the hook — cases 3–8 unexpressible, discovered only when the
implementer reached case 3; (2) case 1 would have been written against a `mktemp`
cwd and passed vacuously on the author's machine while asserting nothing — a guard
that reads green and tests nothing, the worst failure mode for a regression test;
(3) the implementer would have hit the missing gate seam at case 3 and either
invented an ad-hoc bypass or silently converted the suite to the SKIP pattern,
leaving it inert in CI. Estimated cost avoided: one full plan revision plus ~3
implementer round-trips, with the standing risk that (2) shipped undetected.

**Confirming data points:**
1. F-1 / F-2 / F-3 (this session) — three defects, all in the spec's Testing
   section, none in its design body.
2. Pending: any future spec whose testing section names an exemplar.

**Impact:** med — the design decisions survived the scout untouched; only harness
claims broke. That asymmetry is itself the lesson: design bodies get scrutinised
during brainstorming dialogue, test tables get written straight to disk.

**Promote-when:** A second spec's testing section is found to cite an unread
exemplar or an unachievable fixture. At 2 datapoints, promote to the project's
`reconnaissance` memory topic as "before planning from a spec, read every test file
the spec names as an exemplar."

**Status:** validated — three datapoints within one scout, all caught pre-plan.

**Correction (2026-07-28):** this win is real but was written too early to be the whole
picture. The same scout **missed** a fourth defect of the same class — the pre-existing
`tests/test-subagent-guidance.sh` — which escaped into implementation and a commit
before the Task 1 review caught it (F-4). The claim "only harness claims broke" was
correct; the implied claim that the scout *caught* the harness problems was not — it
caught three and created a fourth. R-2 is the counterweight to R-1 in the patterns
ledger. Net verdict on the scout: positive, but it demonstrated that a scout can be
simultaneously the thing that finds harness defects and the thing that introduces one,
when its absence claims outrun its search.

## Status vocabulary

Frictions: `open | mitigated | fixed-verified | wontfix-false-alarm | promoted-to-bug-tracker | pinned-as-eval-baseline`

Wins: `validated | promoted-to-permanent-docs | archived`

## F-4 — Scout concluded "no test file exists" from a one-directory search

**Observed:** 2026-07-28, during SDD execution of Task 1. Surfaced by the Task 1 code
review (Opus), after the work had been implemented and committed.

**When:** Reviewing Task 1's diff — one stage past the pre-planning scout that produced
F-1 through F-3.

**Expected (spec + plan + F-1 narrative + R-1):** "`subagent-guidance.mjs` currently has
**no test file**."

**Got (verified reality):** `tests/test-subagent-guidance.sh` exists — 33 lines, 4
cases, driving this exact hook, covering the `Bash` and `statusline-setup` exclusions,
the closed-gate path, and the system-prompt append. `tests/lib/fixtures.sh` (179 lines)
supplies `write_routing_config`, `make_memories`, `make_system_prompt`, `make_worktree`,
`make_git_repo`, `assert_context_contains`, `assert_no_output`, and `pass`/`fail`/
`print_summary`.

**Probable cause:** The scout ran `ls codescout-companion/hooks/` — the directory where
sibling hooks keep colocated `*.test.sh` files — and never enumerated `tests/`. It read
`tests/run-all.sh` and quoted the `hooks/*.test.sh` glob while missing the
`tests/test-*.sh` term on the same line. An absence claim was made at the width of one
directory and then propagated as established fact.

**Blast radius:** the false premise reached the spec, the plan, F-1's narrative, W-1's
counterfactual, R-1, and four commit messages. It caused the plan to mandate a
`CS_SUBAGENT_GUIDANCE_FORCE` env seam — production code added purely for testability —
in a repo that already had a fixture idiom for the job. The seam shipped with no
discriminating test: reverting the gate change left the suite 8/8 green.

**Workaround:** Revert the seam and the duplicate colocated suite; grow
`tests/test-subagent-guidance.sh` using `fixtures.sh`. Plan amended (`65c1e98`), spec
Testing section corrected, R-2 filed as the skill-level `miss`.

**Severity:** high — it cascaded. Unlike F-1/F-2/F-3, which were caught before any code
existed, this one survived into implementation and a commit, and corrupted five
documents plus the R-N ledger entry meant to record the lesson.

**Status:** fixed-verified — seam reverted, suite consolidated, all five documents
corrected.

**Fix idea / Pointer:** R-2 in `docs/trackers/reconnaissance-patterns.md` carries the
proposed Phase 1 checklist bullet: bound absence claims by the runner's actual glob
list, not by one directory.

## F-5 — `write_mcp_json` does not open the codescout gate; existing suite partly vacuous

**Observed:** 2026-07-28, controller re-verification of the Task 1 review's claims.

**When:** Checking the reviewer's assertion that `write_mcp_json` opens the gate
per-project, before rewriting the plan around it.

**Expected (review claim):** `tests/lib/fixtures.sh`'s `write_mcp_json` opens the gate,
so the existing suite's exclusion cases run against an open gate.

**Got (verified with `detect.mjs --json`, environment sealed):**

| Setup | `HAS_CODESCOUT` |
|---|---|
| `write_mcp_json` | **`false`** |
| `write_routing_config '{"server_name":"codescout"}'` | `true` (`CS_PREFIX=mcp__codescout__`) |
| sealed `HOME` + `CLAUDE_CONFIG_DIR`, no routing config | `false` |

`serverNameFromMcpConfig` matches `/codescout/` against the server's `command`/`args`;
`write_mcp_json` writes `command: <dir>/fake-ce`. The server *key* is never consulted,
so the fixture leaves the gate closed.

**Consequences for the pre-existing suite:** its `Bash` and `statusline-setup` cases ran
with the gate **closed**, so the silence they assert proves nothing about the exclusion
logic — deleting the `agentType` early-return would leave them green. Its system-prompt
case omits the env override entirely, so it reads the developer's ambient config and
passes only where codescout is configured; it would fail on CI.

**Probable cause:** `write_mcp_json` predates or diverged from `detect.mjs`'s
command/args matching. Nothing asserts the fixture actually achieves what its name
implies — a fixture with no test of its own.

**Workaround:** Use `write_routing_config` for the open-gate case; seal `HOME` +
`CLAUDE_CONFIG_DIR` on every invocation. Task 1 rewrites the suite accordingly and
proves two assertions discriminate by temporary mutation.

**Severity:** med — pre-existing and latent rather than introduced here, but it made
the suite's central guarantee false, and it nearly propagated into the amended plan on
the reviewer's word.

**Status:** fixed-verified — open-gate path switched to `write_routing_config`,
mutation checks added.

**Fix idea / Pointer:** `write_mcp_json` remains a trap for any future suite. Worth
either fixing the fixture (name the dummy binary so it matches `/codescout/`) or
renaming it to state what it actually does. Not in this work stream's scope.

## Template for new entries

Copy the shape of F-1 (Observed / When / Expected / Got / Probable cause /
Workaround / Severity / Status / Fix idea) or W-1 (Observed / Pattern /
Counterfactual / Confirming data points / Impact / Promote-when / Status).
