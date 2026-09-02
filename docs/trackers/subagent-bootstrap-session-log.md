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
entry_prefix:
- F
- W
entry_high_water_F: 9
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
| F-6 | explore-project skill and explore-inject hook both inject, and contradict on write permission | med | fixed-verified |
| F-7 | SKILL.md cites `explore-inject.sh`; only `.mjs` exists (rediscovery of the 1.14.0 port drift) | low | fixed-verified (6 surfaces + system-prompt hook map) |
| F-8 | PreToolUse-on-Agent does not fire for nested (subagent-issued) dispatches — 0 of 15 marked | med | **wontfix-false-alarm** — title is false; hook DOES fire, measured end-to-end |
| F-9 | extractPaths swallows trailing punctuation, silently skipping injection (2 real misses in 1,564) | low | fixed-verified |

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

## F-6 — explore-project skill and explore-inject hook both inject, and contradict on write permission

**Observed:** 2026-09-02, scouting the `explore-project` ↔ `explore-inject` seam before designing a read-write parameter for the skill.

**When:** The user asked whether the hook and the skill duplicate each other — before any design was presented.

**Expected:** The skill's conditional guard ("If a foreign-project bootstrap directive was not already prepended above this line") implies the two compose cleanly: the hook supplies the bootstrap, the skill's copy no-ops.

**Got (verified by running the hook on the skill's own template, `CS_EXPLORE_INJECT_FORCE=1`, cwd=claude-plugins, foreign path=backend-kotlin):** the hook injects. Its idempotency guard (`explore-inject.mjs:101`) trips only on `[[cs-explore-bootstrap]]` or `workspace(action="activate"`, and the skill template contains neither — so the subagent receives hook directive **+** skill template. Counts in the composed prompt:

| instruction | occurrences |
|---|---|
| target `CLAUDE.md` read | 2 |
| `memory(action="list", workspace=…)` | 2 |
| "not native Read/Grep/Bash on source" | 2 |
| `workspace=` pinning | 4 |

The same prompt carries both `edit_code` (hook, `explore-inject.mjs:76`) and `READ-ONLY. Do not write or modify any file.` (`skills/explore-project/SKILL.md:56`) — a direct contradiction on write permission. The tool lists also disagree in both directions: the hook names `edit_code` but not `tree`; the skill names `tree` but not `edit_code`.

**Probable cause:** the skill's guard covers its *context-loading* half only. Its `Rules:` block repeats the tool-routing unconditionally, and the two texts were maintained independently — the hook grew `edit_code` while the skill kept `READ-ONLY`.

**Workaround:** none applied. Whether the later, more specific `READ-ONLY` block reliably wins over the hook's earlier `edit_code` mention is **not measured** — no dispatch was run to observe subagent behaviour, so the practical impact on read-only use is unestablished, not established-benign.

**Severity:** med — no failure observed, but it is a contradictory instruction pair delivered on *every* skill dispatch, and `SKILL.md:56` is the only text making exploration read-only anywhere in the plugin, so it is precisely what a write parameter must modify. The duplication also spends prompt budget that the injection-budget redesign exists to conserve.

**Status:** fixed-verified — resolved by **precedence, not de-duplication** (2026-09-02). `SKILL.md`'s `Rules:` block now reads "If a directive above this line named an editing tool (`edit_code`), it does not apply to this task", so the later, more specific block explicitly retires the hook's earlier mention. The duplication itself is retained deliberately and labelled as such in `## Common Mistakes` — see F-8 for why removing it would have been a silent regression. Regression test: `hooks/explore-inject.compose.test.sh`, which runs the hook over the skill's own extracted template and asserts `edit_code`-implies-precedence-clause; verified to discriminate by temporary mutation (dropping the clause fails exactly that assertion).

**Valid:** conditional — the skill's `Rules:` block is de-duplicated against the hook, or either text stops naming write tools

**Fix idea / Pointer:** when the RW parameter lands, guard the skill's `Rules:` block the way its bootstrap half already is, so write permission is stated in exactly one place instead of two that can disagree. Design pending in this session.

## F-7 — SKILL.md cites `explore-inject.sh`; only `.mjs` exists (rediscovery of the 1.14.0 port drift)

**Observed:** 2026-09-02, while reading `skills/explore-project/SKILL.md` during the F-6 scout.

**KNOWN — rediscovery, not a new defect.** The root cause is already filed at `docs/trackers/version-bump-checklist.md:1039`: the hooks became `.mjs` in the 1.14.0 cross-platform port, and `.codescout/system-prompt.md` still lists them as `.sh`. This entry extends the **scope** of that finding rather than re-reporting it; the fix named there (`onboarding(action="refresh_prompt")`) does not reach the surfaces below.

**When:** Following the skill's own "See also" pointer to the hook it composes with.

**Expected:** `codescout-companion/hooks/explore-inject.sh` exists, as three separate lines of `SKILL.md` assert.

**Got:** only `explore-inject.mjs` (plus `.fixtures.jsonl` and `.test.sh`) exists — no `explore-inject.sh`. Live surfaces still naming the nonexistent `.sh`:

| file | lines |
|---|---|
| `codescout-companion/skills/explore-project/SKILL.md` | 10, 81, 91 |
| `buddy/tests/explore-project-eval/README.md` | 17, 66, 86 |
| `buddy/tests/BENCHMARK.md` | 218 |

Two surfaces are **correct** and should not be swept: `.codescout/memories/architecture.md:40` already says `.mjs`, and `codescout-companion/docs/plans/2026-06-13-explore-bootstrap-injector-design.md` (lines 49, 106) says `.sh` as a *design-time working name* — historically accurate, so rewriting it would falsify the record.

**Probable cause:** the 1.14.0 `.sh` → `.mjs` port updated the files but not the prose citing them. The skill's pointer is a `See also` line, which no test or gate reads — `audit_doc_refs` is the check that would catch it, and it is manual (`librarian(action="audit_doc_refs")`), not run on this repo's default path.

**Workaround:** none needed — a reader who follows the pointer finds `.mjs` adjacent and infers the rename. Cost is a wrong-path grep, not a wrong action.

**Severity:** low — three stale pointers in a `See also` and two test-doc surfaces. It cost this session one failed `grep` on a nonexistent path (0 matches, which reads identically to "the hook says nothing about writes" — the shape of a silently-wrong negative) before `tree` showed the real filename.

**Status:** fixed-verified (2026-09-02) — swept beyond the original scope. `SKILL.md` (3), `hooks/explore-inject.test.sh` header, `tests/test-hooks-json-registration.sh` (3 stale assertion labels), `buddy/tests/explore-project-eval/README.md` (3), `buddy/tests/BENCHMARK.md` (1), and `buddy/tests/explore-project-eval/prompt_tdd.yaml` (1) — the last a **fifth surface this entry's original `**/*.md` grep could not see**, which is the reusable lesson: the glob was a hypothesis about where citations live, and it returned a clean zero for the `.yaml`. Also corrected `.codescout/system-prompt.md`'s hook map (the always-on subagent channel flagged at `version-bump-checklist.md:1039`): six `.sh`→`.mjs`, plus `il3-warn-hook.sh` → `il3-deny-hook.sh`, which is **not** a `.sh`→`.mjs` rename — the file is genuinely `.sh`, the basename was wrong, and it is registered in **no** `hooks.json` event, so the map presented an inert file as an active hook. Deliberately left: the design doc's two `.sh` mentions (design-time working name, historically accurate) and this entry's own description of the bug.

**Valid:** conditional — the `.sh` → `.mjs` rename is swept through the five live citation lines above

**Fix idea / Pointer:** cheap to fix alongside the F-6 edit, since it touches the same file. Worth running `librarian(action="audit_doc_refs")` once to find the rest of the 1.14.0 port's stale hook paths repo-wide rather than fixing these five by hand and re-discovering the next set later.

## F-8 — PreToolUse-on-Agent does not fire for nested (subagent-issued) dispatches — 0 of 15 marked

> **RESOLVED 2026-09-02 — FALSE ALARM. The hook DOES fire for nested dispatches.** Settled by direct measurement, not transcripts. The title is kept for citation stability and is **false as written**.
>
> Method: instrumented `explore-inject.mjs` to append one line per invocation *before every early exit*, with the instrument's positive control established first (a synthetic payload produced a log line) — the step whose absence caused the retraction below. Then dispatched a subagent instructed to dispatch a nested subagent whose prompt named a foreign repo.
>
> Result — three log lines, in order: the synthetic selftest, the outer main-agent dispatch, and **the nested subagent-issued dispatch** (`head: "Report back the first 200 characters of your own prompt…"`, 8s after the outer). The grandchild independently reported its received prompt beginning `[[cs-explore-bootstrap]] This task targets a FOREIGN project at /home/marius/work/claude/codescout…`, `MARKER_PRESENT: yes`. So the hook fires **and** the injection reaches the grandchild end-to-end.
>
> This also explains the 0/15: the hook was firing the whole time and the transcript simply records the original `tool_input`, at a 2% rate on the control path. Instrumentation removed after capture.
>
> **Consequence for the F-6 fix:** the skill's `Rules:` duplication is **redundant on the subagent path**, not essential — the guard makes it a no-op there. It is retained as the fallback for hook-*absent* environments (the prompt-tdd eval profile, non-Claude-Code harnesses), which is what `SKILL.md`'s note now says. The fix itself needed no change; its rationale was wrong twice before landing here.
>
> **Lesson, twice over:** the first claim inverted the truth because its instrument could not express the failure; the second ("unresolved") was honest but still cost a round. A direct probe with its own positive control took one dispatch and ~18 seconds, and was available from the start.

> **RETRACTED 2026-09-02, same day, by its own missing control.** The conclusion below is **not supported** and the title overstates what was shown. Read this banner first; the measurement is kept because the instrument's failure is the lesson.
>
> The claim rested on "the positive control matters: rewritten input **is** recorded when injection happens" — asserted from **2** marked main-agent dispatches without ever computing the denominator. Replaying every post-2026-06-14 dispatch through the hook:
>
> | origin | marked | would-inject-but-unmarked | recorded-rate |
> |---|---|---|---|
> | main (hook demonstrably fires) | 2 | 92 | **2%** |
> | sidechain | 0 | 15 | 0% |
>
> Identical with the codescout gate live and bypassed. On the path where the hook **does** fire, the marker is absent 98% of the time — transcripts predominantly record the *original* `tool_input`, not `updatedInput`. So marker-absence cannot distinguish "hook did not fire" from "hook fired, rewrite not recorded", and 0/15 is uninformative rather than evidence.
>
> **Seam class: an instrument that cannot express the failure it is used to detect.** A broken world — hook firing normally, transcripts simply not recording rewrites — produces exactly the observed 0/15. Phase 3 of the reconnaissance skill names this check, and it was run on the sidechain number while the control that mattered went unexamined.
>
> **Still true and unaffected:** subagents do issue nested `Agent` dispatches (75) and do invoke `Skill` (5), so the path exists; 15 of those nested dispatches named a foreign path the hook would target. **Now unknown:** whether the hook fires there.
>
> **How to actually settle it:** one live nested dispatch at a foreign path, reading the *child's* received prompt (or a hook-side log written at invocation), never the parent transcript's recorded input.

**Observed:** 2026-09-02, answering "if someone launches the explorer in a subagent, do both get triggered?" during the F-6 design discussion.

**When:** Before designing the de-duplication fix for F-6 — which is what makes this load-bearing rather than trivia.

**Expected:** `PreToolUse` with `"matcher": "Agent"` is registered unscoped in `hooks/hooks.json`, so it should fire on any `Agent` tool call, including one issued by a subagent (nested dispatch).

**Got (measured across 2,527 transcripts in all three profiles):**

| quantity | count |
|---|---|
| nested (`isSidechain: true`) `Agent` dispatches | 75 |
| …dated after the hook shipped (2026-06-13) | 75 |
| …where the hook itself, replayed offline, says it **would** inject (foreign path named) | 15 |
| …of those 15, carrying `[[cs-explore-bootstrap]]` live | **0** |
| main-agent dispatches carrying the marker (positive control) | 2 |

The positive control matters: rewritten input **is** recorded in transcripts when injection happens, so the 0/15 is not an artefact of the marker being unobservable. Conclusion: **PreToolUse-on-`Agent` does not fire for `Agent` calls issued by a subagent** — the hook is main-agent-only in practice.

Subagents also invoke `Skill` (5 sidechain occurrences), so "subagent runs the explore-project skill" is a real path, not hypothetical.

**Residual confound — this is strong evidence, not proof.** Two alternatives are not excluded from transcript data alone: (1) sidechain entries may record *pre*-rewrite input while main entries record post-rewrite; (2) the codescout gate (`HAS_CODESCOUT`) may have been closed in those particular sessions, since the offline replay used `CS_EXPLORE_INJECT_FORCE=1` to bypass it. One live nested dispatch at a foreign path would settle it.

**Probable cause:** unestablished — plausibly the harness does not run PreToolUse hooks for subagent-issued tool calls at all, which would also explain why `pre-task-hint.mjs` (same matcher) has no observed nested effect. Not confirmed against harness behaviour.

**Consequence — inverts the obvious F-6 fix.** The two compositions differ:

- main agent → hook + skill both reach the subagent (F-6: duplication + `edit_code` vs `READ-ONLY` contradiction)
- subagent → skill text only; **nothing else supplies the bootstrap**

So the skill's conditional fallback ("If a foreign-project bootstrap directive was not already prepended above this line") is not defensive boilerplate — it is the sole bootstrap on the subagent path. De-duplicating F-6 by *deleting* the skill's copy as redundant would have silently broken that path, with no test and no error to reveal it.

**Severity:** med — no live failure (the skill has 0 lifetime invocations per `.codescout/memories/agent-dispatch-hooks.md`, so the subagent path has never actually run), but it was one step from being designed into a silent regression, and it redirects the write-mode feature from the skill to the hook.

**Status:** wontfix-false-alarm — the claimed defect does not exist; the hook fires for nested dispatches and the injection reaches the grandchild (see RESOLVED banner). No code change was warranted. The F-6 fix stands on a corrected rationale.

**Valid:** invariant — measured directly end-to-end; supersedes both the original conditional and the retraction's

**Valid (superseded — see Status):** conditional — a live nested dispatch at a foreign path is observed, confirming or refuting non-firing

**Fix idea / Pointer:** nothing to fix in the hook — this is a harness constraint to design around. Record it where a future session will hit it: the skill's duplication must be labelled *deliberate* so nobody "cleans it up". Blocks any plan that assumes hook coverage of nested dispatches.

## F-9 — extractPaths swallows trailing punctuation, silently skipping injection (2 real misses in 1,564)

**Observed:** 2026-09-02, as a *test* failure while adding agent-type branching (B′) to the hook — every new assertion returned an empty directive.

**When:** First run of new `dir_for()` cases in `explore-inject.test.sh`, whose probe prompt was `"Work in $SB/repoB."` — path immediately followed by a sentence-ending period.

**Root cause (hook, not test):** `extractPaths`'s character class is `[A-Za-z0-9._-]`, which **includes `.`**. So `…/repoB.` is captured *with* the period, `isDir` fails on it, `firstForeignRoot` finds no foreign root, and the hook exits 0 — silently, indistinguishable from "no foreign path named". The pre-existing tests never caught this because every one of them happens to follow the path with a space (`"…in $SB/repoB per the spec."`).

**Measured real-world frequency — and why the first number was wrong.** Across 1,564 post-2026-06-14 `Agent` dispatches:

| quantity | count |
|---|---|
| prompts containing a punctuation-truncated path whose stripped form is a real dir | 125 |
| …where the truncated dir was **not** foreign to cwd (harmless) | 119 |
| …where it **was** foreign | 6 |
| …of those, hook still injected via another well-formed path in the same prompt | 4 |
| **genuine missed injections** | **2** |

The headline 125 (8% of dispatches) is an **upper bound, not an impact count** — the hook takes the first foreign root among *all* extracted paths, so one broken path does not imply a miss. Reporting 125 would have repeated the F-8 error in the same session; the decomposition is the finding.

**Severity:** low — 2 misses in 1,564 dispatches (0.13%), and the failure mode is a *missing* bootstrap (subagent works without foreign context) rather than a wrong one. But it is silent and its likeliest trigger is the most natural way to write a prompt: ending a sentence with the path.

**Status:** fixed-verified (2026-09-02) — `extractPaths` now also offers the dot-stripped candidate; `firstForeignRoot`'s real-dir + different-repo checks still gate it, so nothing new can be invented. Four assertions added to `explore-inject.test.sh` (period-terminated foreign path injects; directive names the dir not the captured period; stripped-local and stripped-nonexistent still skip). Verified to discriminate: reverting the two-line fix fails exactly the two injection assertions and nothing else.

**Valid:** conditional — `extractPaths` is changed to consider punctuation-stripped candidates

**Fix idea / Pointer:** additive and low-risk — have `extractPaths` emit both the raw match and, when the match ends in `[.,;:)]`, the stripped variant. Both go into the same dedup set, so no currently-detected path can be lost; `firstForeignRoot` already discards candidates that aren't real dirs. Roughly a two-line change in `codescout-companion/hooks/explore-inject.mjs:51-54` plus a case in `explore-inject.test.sh` asserting a period-terminated foreign path still injects.

## Template for new entries

Copy the shape of F-1 (Observed / When / Expected / Got / Probable cause /
Workaround / Severity / Status / Fix idea) or W-1 (Observed / Pattern /
Counterfactual / Confirming data points / Impact / Promote-when / Status).
