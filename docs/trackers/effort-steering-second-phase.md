---
id: af4ccc8b94a95c91
kind: tracker
status: active
title: Effort steering — second phase (ES-N)
tags:
- effort-steering
- second-phase
topic: effort-steering second phase
time_scope: dated:2026-10-05
entry_high_water_ES: 11
entry_prefix: ES
origin_session_id: 16bc6017-d129-44f7-91e5-43b0afad5ea9
---

# Effort steering — second phase (ES-N)

Work list for the second phase of the `effort-steering` plugin in this repo. The first phase built the harness-neutral core and three spikes; it is merged locally into `main` and is not a plugin yet (no `plugin.json`, no marketplace entry, no README row).

## Resume — state at handover, 2026-10-05

- `main` is `7475f6d`, the first phase is merged as a fast-forward, and the full suite passed on the merged tree (65 suites, 0 failures). Nothing is pushed: local `main` is 19 commits ahead of `origin/main`.
- Built and reviewed: prompt features, rules engine, steering text, holdout arm, per-session decision log, the `effort-policy` CLI, and spikes S1 to S3. The shipped `effort-steering/core/rules.json` is empty on purpose (ES-9).
- Not built: the Claude Code adapter (ES-3), the experiment that shows whether steering works (ES-5), packaging (ES-10).
- Read an entry's **Status** first. Values used: `open`, `blocked` (name what blocks it), `held`, `with <session>`, `done`.
- The design, the plan of the first phase, the spike findings and the review notes live in the codescout repo (`/home/marius/work/claude/codescout`, branch `experiments`), not here. See Pointers.

## Pointers

- Spec: codescout `docs/superpowers/specs/2026-10-04-effort-steering-design.md`, especially the section "Constraints carried into the second plan".
- Review notes (commit map, triage of every deferred finding, 22 rulings): codescout `docs/research/2026-10-04-effort-steering-branch-review-notes.md`.
- Spike findings: codescout `docs/research/2026-10-04-effort-steering-spike-findings.md`.
- First-phase plan: codescout `docs/superpowers/plans/2026-10-04-effort-steering-core-and-spikes.md`.
- Code: `effort-steering/` in this repo.

## ES-1 — Settle ruling R3: what a bad `--holdout-rate` does

**Status:** done — 2026-10-05. The operator ruled rate 1: a bad `--holdout-rate` holds the turn out and does not steer it. `resolveRate` returns the constant `BAD_RATE = 1`. An absent flag is still rate 0. A bad rate with no `session_id` or `turn_id` is still `treated`, because `assignArm` needs both ids; that was true before the ruling and is pinned by a test. The decision itself is unchanged, only the steering text is withheld. 14 tests failed first. The full run is 66 suites, all passing.
**Done when:** the operator chooses, and the CLI and its tests follow the choice.

A bad rate (not a number, below 0, above 1) was treated as rate 0, so every turn was steered. The final reviewer preferred rate 1 (no steering on a configuration error), and the operator chose it. Both choices lose those rows from the experiment, and the reason `bad_holdout_rate` is logged either way. The change was one constant and its tests in `effort-steering/bin/effort-policy.mjs`.

**Source:** codescout review notes, ruling R3.

## ES-2 — Write the second plan

**Status:** done — 2026-10-05. The operator approved the plan (gate G1) and the subagent-driven execution approach.
**Plan:** `docs/superpowers/plans/2026-10-05-effort-steering-adapter-and-experiment.md` in THIS repo, not in the codescout repo. The codescout checkout was dirty with unrelated work and its own convention document warns about shared-checkout commits, so the plan sits next to the code it describes. Move it if the operator prefers.
**Done when:** a plan for ES-3 to ES-10 is written with the writing-plans skill, committed and approved by the operator.

The design and every constraint are already written. Start from the spec section "Constraints carried into the second plan" and the review notes. Plan documents live in the codescout repo (`docs/superpowers/plans/`), as the first plan does. This tracker is the work list.

**Source:** codescout spec.

## ES-3 — Claude Code adapter (a `UserPromptSubmit` hook)

**Status:** built 2026-10-05 on branch `feat/effort-steering-adapter` (worktree `/home/marius/work/claude/claude-plugins-effort-steering-adapter`, base `6a92fe2`, head `a2f1f6f`; NOT merged, NOT pushed). Plan Tasks 2 to 4: `adapter/claude-code/build-context.mjs`, `run-policy.mjs`, `user-prompt-submit.mjs`, each with Opus-reviewed tests (mutation lens) and one fix round. The final whole-branch review says the adapter can merge once one test lands (ids absent + hostile prompt, FINAL I-5). Still open from it: `latencyBudgetMs` must be an integer and `runPolicy` must guard `timeoutMs` (FINAL I-3), and the planned `hooks.json` must set `EFFORT_STEERING_HOLDOUT_RATE` or production has no holdout (route to ES-10).
**Done when:** a hook script under `effort-steering/` reads the hook input, calls `bin/effort-policy.mjs decide` and emits `additionalContext` only when `steer` is not null, with tests.

Facts from spike S1: the hook input has `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name` and `prompt` (all strings) and no effort level. Use `prompt_id` as `turn_id`. Constraints:
- Put a wall-clock timeout around the CLI, and treat a timeout as `default` with no steering. The CLI has no timeout of its own.
- Always exit 0 from the hook. Exit code 2 from a `UserPromptSubmit` hook blocks and erases the user's prompt. The CLI exits 64 for a usage error.
- Never derive `turn_id`, `harness` or `session_id` from prompt text. The log writes them as given.
- Log and alert on the reasons `unknown_arg`, `bad_holdout_rate`, `rules_unreadable`, `table_unreadable` and `log_failed` during rollout. Each can silently change the experiment.
- Session signals (previous-turn failure, retries) can come from the transcript tail. `permission_mode` may give plan mode; its possible values are unchecked.

**Source:** codescout spec, decisions D1 and D2 and the constraints section; codescout findings, section S1.

## ES-4 — Check how Claude Code merges `additionalContext` from several hooks

**Status:** partly answered 2026-10-05 (read-only half, plan Task 1, branch `feat/effort-steering-adapter` commit `8b2642c`). The live merge check (plan Task 7 Step 7) is still open and needs the operator's approval for one model call.

**Read-only findings** (counts from the implementer's run over the three profiles; the total drifts by about 1 because live sessions append): 943 transcript files, 6,013 turns, 69 contexts with a `UserPromptSubmit` record. `UserPromptSubmit` output is recorded as `attachment` type `hook_success` (71 records in 35 files, checked by the controller), NOT `hook_additional_context`. The hook fired on non-human turns: peer 7, task-notification 6, command 24. So `UserPromptSubmit` does fire for those triggers, which answers that unverified claim in the affirmative for these three kinds. `hookName` is always the literal `UserPromptSubmit`, so the ORDER of several hooks cannot be read from a transcript (`orders` shows only `UserPromptSubmit>UserPromptSubmit`, 2 turns). The ordering and the cache-neutrality questions remain open.
**Done when:** a scratch run shows the order and the merge of `additionalContext` when `codescout-companion`'s `constitution-brief.mjs` and the new hook both fire, and the result is recorded here.

Spike S1 ran with user-level plugin hooks switched off (`--setting-sources local`), so it says nothing about this. Also check whether hook-injected steering text is cache-neutral. That feeds ES-5.

**Source:** codescout spec, "Unverified claims register".

## ES-5 — Spikes S4 and S5: does steering text move thinking depth?

**Status:** code built and reviewed 2026-10-05, run NOT started. Branch `feat/effort-steering-adapter` (plan Tasks 5 to 7 plus the final fix wave, ES-12): `spikes/s4-prereg.mjs` (+ null template `s4-prereg.json`), `s4-analyze.mjs`, `s4-rows.mjs`, `s4-run.mjs`, `s4-prng.mjs`. Gates refuse before any model call; the final scoped re-review (Opus, 39 mutants killed) says the layer is a fail-closed foundation. Waiting on two operator gates: G2 (register the numbers: effect size, latency budget, holdout rate, repeats, minPerArm, model, prompts, steer level, alpha, permutations, seed) and G3 (approve the model-call run; the plan's "As built" section lists what the G3 message must tell the operator, including the canary and that the endpoint and auth path are only checked by the first real call).
**Done when:** the gate numbers are registered BEFORE any run (effect size on `thinking_tokens`, latency budget, holdout rate), the experiment is run with the holdout arm, and the result is written down.

Stop rule from the spec: if steering text moves nothing against the holdout, actuation A fails. Then stop, or reopen the opt-in settings write (a shared-state hazard, because `settings.local.json` is per project). Measurement comes from transcripts: `usage.output_tokens_details.thinking_tokens`, the cache fields and the top-level `effort` field, deduped by `message.id`. The replay scripts in `effort-steering/spikes/` show how.

**Source:** codescout spec, decision D5 and "Measurement and gates".

## ES-6 — Session-signal replay (S3b)

**Status:** done 2026-10-05 (branch `feat/effort-steering-adapter`, plan Task 8, `spikes/s3-replay.mjs` extended, counts only). Plan mode is the top-level `permissionMode` on user records (values `auto`, `default`, `plan`). Over 3,562 turns (2,792 measured): `prevTurnFailed` true n=400 (median 5,947.5, p90 19,809) against false n=2,392 (median 5,332, p90 21,506). By effort level the direction is unstable (xhigh +7 percent, high -30 percent, medium +150 percent at n=20), so this is a weak association at best and not a basis for a rule. `planMode` true n=4 (median 8,247.5): far too few to conclude; false n=2,778; null n=10. `retryCount` was not measured (the spec gives no mechanical definition). Consequence for ES-9: the session signals do NOT give a basis for first rules either.
**Done when:** a replay of past sessions shows whether a failure in the previous turn, a retry count or plan mode (`permission_mode`) separates thinking depth, and the result is recorded here.

S3 tested prompt features only. The only feature that separated depth was `isQuestion` (lower at every effort level); length did not. The session signals are the likeliest escalation levers, and nothing measures them yet. This feeds ES-9.

**Source:** codescout findings, "Limits of S3".

## ES-7 — Make the `run-all.sh` glob recursive

**Status:** done — 2026-10-05. `tests/run-all.sh` now finds `effort-steering/**/*.test.mjs` at any depth with `find` (sorted, `node_modules` pruned). `tests/test-run-all-effort-discovery.sh` plants suites at depths 1 to 3, checks that a failing depth-3 suite fails the run, and checks that the empty-population guard still trips. It failed on the old glob (a failing depth-3 suite gave exit 0) and passes now. The full run lists 66 suites (65 plus the new test), all passing.
**Done when:** `tests/run-all.sh` finds `effort-steering/**/*.test.mjs` at any depth, the population is asserted, and a test shows that a suite two levels deep is run.

Today the glob reaches one level (`effort-steering/*/*.test.mjs`). A test under `effort-steering/adapter/claude-code/` would never run, and the runner would still print "All suites passed". `CS_TEST_SKIP` is keyed by file basename, so generic names such as `log.test.mjs` can collide.

**Source:** `tests/run-all.sh`; codescout spec, constraints section.

## ES-8 — Make skipped rules visible and decisions deterministic

**Status:** done — 2026-10-05. Three changes, each with a test that failed first:
- **Visible:** the CLI adds one reason `rules_skipped:<id>:<error>` per skipped rule, in file order, after `unknown_arg` and before `table_unreadable`. The log record is unchanged (it carries the reasons). It never appears with `rules_unreadable`.
- **Checked at test time:** `decide.test.mjs` compiles the shipped `rules.json` with the probe on and asserts `skipped` is empty.
- **Deterministic:** `compileRules(raw, { probe })` takes an option; only a strict `false` turns the probe off. The CLI passes `probe: false` for the shipped default file and keeps it on for a `--rules` override. A mutation (probe always on) fails exactly the new default-path test.

**Residual risk:** the shipped file now has no runtime probe, so a catastrophic regex there is caught only by the test-time probe and by review. The probe misses some (`(b+)+c` passes it and took 11.5 s on a 30-character prompt), so review every regex in a future `rules.json` for nested quantifiers (ES-9).
**Done when:** a skipped rule shows in the decision log (for example a `rules_skipped` reason with the ids), the shipped `rules.json` is checked at test time (no skipped rule), and the runtime slow-regex probe applies to `--rules` overrides only.

The probe uses wall-clock time. Under CPU starvation 27 of 1,500 benign regexes were skipped as `slow_regex`, so decisions could differ between runs once rules ship. A partly skipped file also logs the whole file's version. Also review every regex in a future `rules.json` for nested quantifiers: `(b+)+c` passes the probe and took 11.5 s on a 30-character prompt.

**Source:** codescout review notes; `effort-steering/core/decide.mjs`.

## ES-9 — First rules (the held Task 11)

**Status:** held — until ES-5 or ES-6 gives a basis.
**Done when:** `core/rules.json` holds rules chosen from evidence, each with a positive and a near-miss negative test.

`rules.json` ships empty by the operator's decision. S3 gave a thin basis: one candidate for `shallow` (`isQuestion`) and nothing for `deep` (`explicitDeep` and `hasStackTrace` had no data).

**Source:** codescout findings, "Decision requested"; first-phase plan, Task 11.

## ES-10 — Package `effort-steering` as a plugin

**Status:** blocked — by ES-3 and by the gate of ES-5.
**Done when:** `effort-steering/.claude-plugin/plugin.json` and `hooks/hooks.json` exist, `.claude-plugin/marketplace.json` has the entry (no version field), `README.md` has the version-table row, `effort-steering/spikes/` is deleted or excluded, and the release ran through `./scripts/release.sh effort-steering` followed by the cold restart of all three Claude Code instances.

Never bump a version inline in a feature commit. The spikes hard-code machine-specific paths into three profiles and would ship into every install cache.

**Source:** this repo's `CLAUDE.md`, section "Version Management".

## ES-11 — Push, and remove the branch and worktree

**Status:** with the "Push and deploy ceremony" session.
**Done when:** the operator decides whether and when `main` is pushed (local `main` is 19 commits ahead of `origin/main`: 17 are the effort-steering commits, 2 were there before), and the branch `feat/effort-steering-core` and the worktree `/home/marius/work/claude/claude-plugins-effort-steering` are removed.

Removing the worktree deletes its gitignored scratch workspace (`.superpowers/sdd/`), which holds the first phase's task reports. Remove the worktree first (`git worktree remove`), then the branch (`git branch -d feat/effort-steering-core`).

**Source:** handover message of 2026-10-05; codescout review notes.

## ES-12 — Fix the S4 method: a GO can come from chance alone

**Status:** done in code 2026-10-05 (branch `feat/effort-steering-adapter` @ the head recorded in the passover; not merged, not pushed). The operator chose "runner assigns balanced arms". Implemented and independently re-derived: the runner assigns arms balanced within each prompt (seeded shuffle, per-run rate '1' or '0'), the analysis is a per-prompt within-prompt permutation test (one-sided, add-one, `alpha` + `permutations` + `seed` registered) AND a registered effect-size gate. False-pass rate with no true effect: 0.0485 at alpha 0.05 and 0.0086 at alpha 0.01 over 224,000 fresh-seed trials (the old method gave 22 to 40 percent). The bundled items I-1 to I-5, the subcommand-name prompt guard, M-1 and M-2 are fixed too. REMAINING for the operator at G2: choose prompts, repeats, alpha, permutations, seed and the other gate numbers using the feasibility table in the plan's "As built" section (alpha 0.05 is reachable at 4 prompts x 3 repeats but with power about 0.43 at a 30 percent reduction; register permutations >= 10,000), and the G2 commit adds the three feasibility checks to `loadPrereg` (ruling R25).
**Done when:** the operator chooses the method, the code and tests follow it, and the registered statistic and alpha are in `s4-prereg.json` before any run.

`analyzeArms` pools every prompt's thinking tokens into two medians. Arms come from a hash of (session id, Claude Code's `prompt_id`), so the runner cannot balance them within a prompt, and prompts differ a lot in baseline thinking. Simulated with the real `analyzeArms` and `assignArm` and NO true effect: 4 prompts with different thinking levels x 3 repeats and effect size 150 gave `mechanism_pass` in 40.4 percent of runs; 4 similar prompts with more noise 28.7 percent; 5 to 10 repeats with effect size 300 gave 22 to 30 percent. With the cold-cache coin flip (FINAL I-4) a full GO under no effect is plausible in 10 to 20 percent of runs.

Options: (a) let the runner assign arms itself, balanced within each prompt (registered holdout rate 0 or 1 per run, shuffled run order), then compare within each prompt (paired differences) with a permutation test and a registered alpha; (b) keep the hash assignment but carry the prompt index in every row and register a per-prompt statistic plus a permutation test. The recommendation is (a): it removes the chance imbalance by design and keeps the analysis simple. It changes what G2 registers (the statistic and alpha), so the operator decides first.

Bundled in the same fix wave (all from the final review): FINAL I-1 (treated runs that were not steered dilute the effect; preflight every registered prompt and exclude `not_steered` / `steered_holdout` rows), I-2 (the children inherit the environment, here `ANTHROPIC_BASE_URL` points at llm-proxy; build the child env explicitly), I-3 (the latency gate cannot see a hook that falls back on every call), I-4 (warm-up run and shuffled order), I-5 (a test), the claude-subcommand-name prompt risk, M-1 (the treatment is not pinned to a commit) and M-2 (prompt guards).

**Source:** final whole-branch review, SDD ledger `progress.md` (git-ignored, in the worktree), plan `docs/superpowers/plans/2026-10-05-effort-steering-adapter-and-experiment.md` on the branch.

## Template for new entries

Use `doc(action="append_entry", id_prefix="ES", anchor_heading="## Template for new entries", title=…, body=…)` from the MAIN checkout. Each entry needs `**Status:**`, `**Done when:**` and `**Source:**`.
