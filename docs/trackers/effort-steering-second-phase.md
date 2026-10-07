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
entry_high_water_ES: 21
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

**Status:** done in code 2026-10-05 and MERGED into local `main` (merge commit `586367e`; not pushed). Plan Tasks 2 to 4 plus the final fix wave: `adapter/claude-code/build-context.mjs`, `run-policy.mjs`, `user-prompt-submit.mjs`, each with Opus-reviewed tests (mutation lens). Still open from the final review: the planned `hooks.json` must set `EFFORT_STEERING_HOLDOUT_RATE` or production has no holdout (route to ES-10), and a stdin that never closes needs a `timeout` in `hooks.json` (ES-10).
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

**Status:** code built and reviewed 2026-10-05, run NOT started. **G2 DONE 2026-10-07** (merged into local `main` as `feb8105`, `e422ada`, `5077dc4`; Opus review approved the code; full suite green): `spikes/s4-prereg.json` registers direction `down`, steerLevel `shallow`, model `claude-sonnet-5-5`, 12 prompts x 4 repeats, holdoutRate 0.5, `minPerArm` 21, alpha 0.05, permutations 10000, seed 20261007, effect gate 60 `thinking_tokens`, `latencyBudgetMs` 500 (measured hook p95 about 101 ms over 48 runs, 0 failures); `POLICY_TIMEOUT_MS` is 500; `loadPrereg` now also refuses numbers the runner cannot satisfy (ruling R25). Power from a simulation with the real `analyzeArms` (300 trials per cell, alpha 0.05): false-pass 3 to 5 percent; at 12 x 4, a 30 percent cut passes 0.95 at noise CV 0.3, 0.48 at CV 0.7, 0.29 at CV 1.0, and a 50 percent cut at CV 1.0 passes 0.75. So a failed S4 is weak evidence at CV 0.7 or higher. `minPerArm` was set to 21 and not 24 because one excluded run would otherwise force `insufficient_data` (38 to 77 percent likely in 48 runs at 1 to 3 percent per run). Branch `feat/effort-steering-adapter` (plan Tasks 5 to 7 plus the final fix wave, ES-12): `spikes/s4-prereg.mjs` (+ null template `s4-prereg.json`), `s4-analyze.mjs`, `s4-rows.mjs`, `s4-run.mjs`, `s4-prng.mjs`. Gates refuse before any model call; the final scoped re-review (Opus, 39 mutants killed) says the layer is a fail-closed foundation. **S4 RUN 2026-10-07 (G3 approved by the operator, run once, treeCommit `aff8d20`, preregCommit `5077dc4`): registered verdict `mechanism_fail`, `stop` = [`mechanism_fail`], so Tasks 9 and 10 do not proceed and the settings write is NOT reopened without the operator.** 49 model calls (48 runs + canary), 0 excluded, canary ok, hook p95 98 ms (0 failures), `cacheOk` true (cache share 0.102 treated, 0.111 holdout). Statistic: signed mean delta 2.17 `thinking_tokens` against the 60 gate, p = 0.164 against alpha 0.05, 12 prompts x 2 treated + 2 holdout. **The test was floor-bound, so this verdict does not show that the steer does nothing.** From the 49 transcripts in `~/.claude-sdd/projects/-tmp-s4-run-90Qveb-work/`: the holdout arm has `thinking_tokens` 0 in 22 of 24 runs (the other 2 are the 'Prove that the sum of the first n odd numbers' prompt, 26 tokens each); the treated arm has 0 in all runs. Effort was `medium` in all 63 assistant records, model `claude-sonnet-5-5`. With nothing to cut, no reduction was measurable and the 60-token gate was unreachable (holdout mean about 2). The steer WAS delivered end to end: the treated transcripts hold a `hook_additional_context` attachment with `Answer directly without deliberating.`, the holdout transcripts none. Mean output tokens were about 810 treated (25 sessions, includes the canary) and 880 holdout (24), not tested. Cause of my error: the power simulation assumed a baseline of 400 thinking tokens; D-3 (ES-14) had said to stratify by difficulty because a turn near 0 thinking cannot show a shallow effect, and the first S4 deferred that. RESOLVED: a peer session's pilots (144 to 357 and 1,281 to 2,347 tokens) were INVALID. Its `claude -p` loop read the loop's stdin file, so every call saw the whole prompt file appended and answered 6 to 14 tasks at once. Its clean control (stdin from /dev/null, one-line message, Sonnet 5.5, effort `medium`) gave thinking_tokens 0 and 0 on the 404 prompt and 0 and 0 on the locking prompt, which matches the holdout arm here. Checked on our side: all 49 S4 transcripts have a one-line first user message (longest 138 characters), so the S4 runs were not contaminated. Rule for any script that runs `claude -p` in a `while read` loop: redirect stdin with `< /dev/null`. Discard every number from those pilots. The S4 runner's spawn is not affected. Options for a second registration (the operator decides, a new commit and a new run): prompts that elicit thinking (the peer's harder set), and/or direction `up` with a `deep` steer, which has no floor. Result JSON: session scratchpad `s4-result.json` (not durable); the numbers above are its content.
Waiting on the operator's decision about a second registration. G2 and G3 of the first registration are done.
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

**Status:** open — the operator decides (the "Push and deploy ceremony" session has no further work until then). Update 2026-10-05: `main` is now 53 commits ahead of `origin/main` (the first-phase work, the issue-file commits, the plan, the adapter branch merge `586367e` and the tracker commits). Three worktrees exist: the old `claude-plugins-effort-steering` (branch `feat/effort-steering-core`, clean, holds the first phase's scratch reports) and `claude-plugins-effort-steering-adapter` (branch `feat/effort-steering-adapter`, merged, holds the SDD ledger with rulings R1 to R25), plus an unrelated prunable `/tmp/claude-plugins-buddy-codex-summon`. Removing a worktree deletes its git-ignored scratch; remove each only on the operator's word.
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

## ES-13 — The hook's `turn_id` is a turn, not a prompt: key the log and the arm on it with care

**Valid:** dated 2026-10-06

**Status:** open, found 2026-10-06 in the live decision logs (hook wired in `~/.claude` and `~/.claude-sdd`). Nothing is changed in code. RULED 2026-10-07 (operator, "accept all as recommended"): the arm unit is the turn; the log's join key is `session_id` + `turn_id` + `prompt_sha256`; injected messages are handled by the D-2 content-shape guard (ES-14), as its own later task and not part of S4. Still open: inspect one real hook payload for an origin field before the guard is built.
**Done when:** the operator rules on the arm unit (per turn or per prompt) and on the log's join key; the ruling is written into ES-9 and ES-10 before the packaged `hooks.json` sets `EFFORT_STEERING_HOLDOUT_RATE`; and the operator decides how the adapter treats injected messages (task notifications, peer and agent messages), after one real hook payload has been inspected for an origin field. The coverage check is done (below).

**Observed.** The adapter sets `turn_id` from the hook input's `prompt_id` (`buildContext`). The 417 records in `~/.local/state/effort-steering` (18 sessions, 2026-10-05 15:36 to 2026-10-06 16:32 local) hold only 392 distinct `turn_id` values: 23 ids appear twice and 2 appear three times. Every duplicate is inside one session, the prompt hashes differ, and the records are seconds to minutes apart.

**Verified in one case.** Turn `5370ba54` in session `e1cb2369` has records at 11:50:55 and 11:51:04 (UTC). In that session's transcript, the message typed at 11:50:55 and the next ten tool-result entries all carry `promptId` `5370ba54`. At 11:51:04.863 the transcript has a `queue-operation` `enqueue` and a `queued_command` attachment, and the second record follows 82 ms later. So `prompt_id` names the whole agent turn, and a message sent while Claude is still working gets its own record under the running turn's id. The other 24 duplicates fit the same pattern, but only this one was traced in the transcript.

**What it affects.**
- The log itself: nothing. Each record is still one distinct prompt (distinct `prompt_sha256`), and in the session `a615adc6` the three records match the three messages sent after wiring (12, 27 and 43 characters).
- `assignArm` hashes `[session_id, turn_id]`, so a queued message gets the same arm as the message that started the turn. With a holdout rate strictly between 0 and 1 the arm is therefore per turn. This may be the right unit, because `thinking_tokens` belong to the model calls inside a turn, but it is a decision, not an accident.
- Any join of the log to transcript `thinking_tokens` by `turn_id` alone is one-to-many. A key of `session_id` + `turn_id` + `prompt_sha256` is unique in these logs.
- S4 is NOT affected: the S4 runner sets the holdout rate to '1' or '0' per run, and `assignArm` returns `holdout` for every id at rate 1 and `treated` at rate 0.

**Coverage check, 2026-10-06 (the `~/.claude` transcripts).** 15 logged sessions have a transcript there, holding 409 of the 417 records. Every transcript message from the wiring time on (2026-10-05 12:36Z) was matched to a record: first by equal character count within -3 s to +120 s, then by time alone within 3 s. The scripts (`coverage.mjs`, `coverage2.mjs`) are in the session scratchpad under `/tmp`, so they are not durable.
- Typed messages: 106 of 106 sent after pickup have a record with the same character count. The matcher found 102; the other 4 were checked by hand (one record came 5 s BEFORE its transcript entry, because the message was queued while the model worked). One more candidate, `[Request interrupted by user for tool use]`, is a system marker and not a prompt. The record follows the transcript entry by a median of 91 ms. No missed typed prompt was found.
- Queued typed messages: 10 of 10 matched (median +221 ms). Queued agent messages (`<agent-message ...>`): 5 of 5 matched (median +3.8 s; one record came 25 s after the message was queued).
- Task notifications (`commandMode: task-notification`): 249 of 265 have a record (113 with equal length, 136 by time only; the record comes a median 204 ms BEFORE the transcript entry). 10 have none and 6 came before the session's first record. For the 136, the lengths differ, so they are not confirmed to be the same text.
- Cross-session peer messages (`Another Claude session sent a message`) are marked `isMeta` in the transcript, so the script skipped them. They explain most of the 42 unmatched records. 3 of 3 sampled peer messages have a record about 140 ms before the transcript entry. The other unmatched records were not examined.
- No record, as expected: local commands (`/compact`, `/mcp`, `/reload-plugins`: 20 of 20 with none) and compaction summaries (6 of 6).

**What the check shows.** The hook fires for harness-injected messages as well as typed ones: at least 249 of the 409 records (61 percent) belong to task notifications, and peer and agent messages add more. The record has no field that tells them apart (it holds only `harness`, features, the prompt hash and the decision), so the log mixes human prompts with machine messages. This probably explains the large prompt sizes (median 1568 characters, maximum 20558); size per category was not measured. For ES-9: a rule that matches on prompt features would also see these messages, and a steer would be added as `additionalContext` to a machine message. The fixture hook input has only seven fields (`session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`, `prompt`). The transcript entries have `origin.kind`, `promptSource`, `turnOrigin` and `isMeta`. Whether the real hook input carries any of them was NOT checked.

**Decision for the operator (add to Done when).** Should the adapter skip or tag injected messages, and by what test? Candidates: a prefix test on the prompt (`<task-notification`, `Another Claude session sent a message`, `<agent-message`), or a field of the real hook input if one exists. The first step is to log one real hook payload (all keys, no prompt text) to see which fields exist.

**Source:** live logs `~/.local/state/effort-steering/*.jsonl`; transcript `~/.claude/projects/-home-marius-work-claude-codescout/e1cb2369-1071-450c-a3e0-5634a7d447e0.jsonl`; `effort-steering/adapter/claude-code/build-context.mjs`, `effort-steering/core/arm.mjs`; passover `b2838d56206e8d62` ("Local deployment").

## ES-14 — Research landscape recorded; the decisions it forces (D-1 to D-5)

**Valid:** dated 2026-10-06

**Status:** open. The research is recorded in the tracker `docs/trackers/effort-steering-research-2026-10-06.md` (id `8ad5f00472dc1e42`). Nothing is changed in code. RULED 2026-10-07 (operator, "accept all as recommended"): D-1, D-2, D-3, D-4 and D-5 stand as written below. For D-3 this means S4 stays two-arm; the neutral-length control arm and the quality check are added only if S4 passes. Each ruling still has to be written into ES-9, ES-12 or ES-13 where it applies.
**Done when:** the operator rules on D-1 to D-5, and each ruling is written into ES-9, ES-12 or ES-13 where it applies.

**What the research shows (details and sources in the research tracker).** No source measures steering text against billed `thinking_tokens` under adaptive thinking on real coding turns, so S4 would be new. Claude evidence for steering text is small: `ultrathink` +27 percent median thinking on Opus 5.5 (45 runs, 3 of 5 problems below 300 reasoning tokens); "deep thinking" wording 1.25 to 1.30 times output tokens on Sonnet 5 with no success gain. Learned per-step routers save about 20 to 45 percent of tokens, but not on coding in a repository, and no source tests rules against them. Prompt text alone predicts needed effort weakly (about AUC 0.6 for coding-agent success). A `UserPromptSubmit` hook can return only `additionalContext` (plus block and session title); it cannot set effort and cannot see an origin field.

**Decisions.** Each item gives the recommended answer, with the reason.
- **D-1, actuation.** Steer with `additionalContext` only; do not write settings. Reason: a settings write is racy across sessions, its effect on a running session is contested between sources, and text on the newest user message keeps the cache.
- **D-2, injected messages (ES-13).** Add a content-shape guard in one swappable function: skip a prompt that contains `<task-notification`, `<agent-message` or `<cross-session-message`, or that starts with `<`, `[` or a slash command. Reason: no hook field tells typed from injected (issue #94675); the transcript fields `promptSource` and `isMeta` do not reach the hook. The guard is brittle by the issue's own account, so keep it replaceable.
- **D-3, S4 changes (for G2, ES-12).** Record `output_tokens` as well as `thinking_tokens`, and report first-request thinking apart from tool-result requests. Add a neutral-length control sentence arm. Stratify by difficulty, because a turn near 0 thinking cannot show a shallow effect. Add a quality check besides tokens. Add a lower-effort comparison arm. Plan the test for modest effects. Do not test "Answer directly without deliberating." while the `between_tools` thinking setting is in use (documented XML-tag leak); first find out whether Claude Code uses that setting.
- **D-4, first rules (ES-9).** Treat a short prompt ("go", "5", "ok, go") as "unknown, inherit the previous turn's state", not as shallow. Use loop state (previous tool error, step index) before prompt length. No model call in the hook: the Haiku-based hooks add 4 to 12 s, and the rules-only Qcko router is about 150 to 300 ms (README, not measured here).
- **D-5, golden set.** Treat the 50 labels as a calibration set: keep the design weights, keep `unclear`, write the guidelines before labelling, define levels by what was needed and not by what was spent, re-label 10 to 15 turns after a few days. Do not use thinking-token spend as the label. Optionally read the `totally-tim/effort-router` README and code for its label protocol.

**Unverified (do not treat as findings).** Whether Claude Code sends `between_tools`. Whether hook-injected text triggers the `ultrathink` recognition. Whether a settings write changes effort on the current Claude Code version. All numbers come from agent summaries of pages and were not re-checked. One report was flagged by the harness for instruction-shaped text (it quotes tags and settings names); no action was taken on it.

**Source:** six subagent reports, 2026-10-06; research tracker `8ad5f00472dc1e42`; ES-12, ES-13.

## ES-15 — What the traces can measure: Langfuse via llm-proxy and usage.db, and the first probes

**Valid:** dated 2026-10-06

**Status:** probed 2026-10-06 (read-only; no code changed). The operator picks which measurements go into S4 and the analysis.
**Done when:** the operator chooses the measurements and join keys for S4 and for the first-rules analysis, and the follow-up probes below are run or declined.

**Sources found.**
- **Langfuse via `llm-proxy`.** All three profiles send API traffic to `http://localhost:8082` (each profile's `settings.json` env block). The proxy and Langfuse are running. This session has 1,865 traces; the golden-sample sessions are covered (G-08 537 traces, G-04 784, G-07 49, G-01 746). Per API call it holds input, output and total tokens (no thinking split), cache read and write, latency, TTFT, served model, stop reason, tool calls with arguments (from 2026-08-27), the full `input.messages` and the reasoning text. It does NOT store the request's `thinking` object, the `stream` flag or the `anthropic-beta` header (the proxy's own notes say so; `modelParameters` is null). Capturing those needs `scripts/record_shim.py` in `~/agents/llm-proxy`.
- **Effort pins are visible in the requests.** Messages like `{"role":"system","content":[],"output_config":{"effort":"medium"}}` appear inside `input.messages`. In 30 sampled calls, 23 carried at least one pin (medium 5, high 16, xhigh 4); the August traces (Opus 5) carry none. A pin sits at the position where the effort changed and stays there in later requests, so the effort in force is the last pin. This session: pins at message index 1 (medium) and 4 (high), even in a 271-message request. The transcript `effort` field agrees: medium from 2026-10-04 09:30 to 2026-10-05 12:37 UTC, high from 2026-10-06 12:03 on, and the trace at 12:03:34 holds both pins. Subagent requests are separate short conversations with their own pin (Opus 5.5 xhigh and Sonnet 5.5 medium were seen). So Claude Code sends effort per message in the wire format, but in the sample the value changed only when the session setting changed.
- **Reasoning text.** 16 of 18 calls with a thinking block had readable text (186 to 2,156 characters per call). 12 of 30 sampled calls had no thinking block at all.
- **Hook output reaches the request.** Hook output and system reminders appear in `input.messages` (65 mentions of `UserPromptSubmit` in one request). When steering is on, delivery can be checked in the trace. Not tested with a real steer yet, because the hook emits nothing today.
- **`usage.db`** (`~/work/claude/codescout/.codescout/usage.db`, codescout tool telemetry, not LLM calls): 66,629 rows from 2026-09-07 to 2026-10-06 over 461 sessions. `tool_use_id` is set on 20,760 rows (almost all rows since 2026-09-30, about half on 2026-10-02), so rows join exactly to transcript tool-use ids. `agent_id` is set on 17,381 rows (237 agents). Outcomes: success 63,523, recoverable_error 3,073, error 33. `effect_class`: read 8,394, write 5,015, unset 53,220. Top error families are policy-guard blocks (il3_pipe_to_trimmer 668, il3_shell_on_source 416, il1_read_overlaps_symbol 313, librarian_managed_artifact 303, worktree_activate_required 219, il2_structural_edit 176). It covers only codescout MCP calls, not the built-in Read, Bash or Edit.

**Probe result: where thinking happens inside a turn** (transcripts, 2,583 measured turns, billed `thinking_tokens` per message). The first assistant message holds 9.4 percent of all thinking tokens (median share 0.11); it holds at least half in only 13.5 percent of turns. The share of messages with any thinking falls from 88.5 percent (1st) to 77.2 percent (2nd) and 61.0 percent (13th and later). Median thinking per message: 421 (1st), 244 (2nd), 128 (7th and later). So the first message is the heaviest single message, but most of a turn's thinking comes later in the tool loop. This does NOT match the Anthropic docs' remark that the first request carries most of the reasoning, at least for long Claude Code agent turns, and it undercuts the research tracker's inference that a hook injection acts mainly on the first request. A steer stays in the context for the later requests of the turn. S4 must therefore sum thinking over every request in the turn and report it by position.

**What can be measured.**
- Per turn: billed thinking and output tokens, steps, tool errors, duration (transcript); effort in force (transcript `effort` and the proxy pins); cache read and write and TTFT per call (proxy); codescout call counts, guard blocks and write effects (`usage.db`).
- Join keys: transcript and `usage.db` by `tool_use_id` (exact since 2026-09-30); transcript and proxy by session id and timestamp (no shared id was found); hook log and transcript by `session_id` plus `prompt_sha256`.
- Not available: billed thinking tokens per call in Langfuse; the request `thinking` object and beta header (needs `record_shim.py`); a success label per turn.

**Follow-up probes (not run).** (a) Agreement of pins and transcript effort across many sessions. (b) Whether a changed pin changes `cache_creation_tokens` in the next call. (c) One `record_shim.py` capture to see the `thinking` object and the betas, and whether Claude Code uses `between_tools` (this decides part of D-3). (d) A steer smoke test in a scratch session: emit a harmless context line from the hook and confirm it appears in `input.messages` and in the transcript. (e) Per-turn friction from `usage.db` as a context field for the golden set.

**Privacy.** Langfuse and the transcripts hold full prompts, system text and reasoning. The probes printed only key names, counts and numbers.

**Source:** probes of 2026-10-06 (scripts in the session scratchpad under `/tmp`, so not durable); `~/agents/llm-proxy/CLAUDE.md` and `docs/trackers/observability-instruments.md`; ES-13, ES-14; research tracker `8ad5f00472dc1e42`.

## ES-16 — Thinking text in S4 runs: `--thinking-display summarized`

**Valid:** dated 2026-10-07

**Status:** tested 2026-10-07. The S4 runner now passes `--thinking-display summarized` (`spikes/s4-run.mjs`, test in `s4-run.test.mjs`). The change is in the working tree and NOT committed. Fable 5.1 is untested.
**Done when:** the runner change is committed, Fable 5.1 is tested or declined, and G2 and G3 have run.

**Finding.** An S4-shaped call (`claude -p --setting-sources local --settings <file> --strict-mcp-config`) sends `thinking: {"type":"adaptive","display":"omitted"}`. The transcript then holds thinking blocks that are signed and empty. Adding `--thinking-display summarized` changes the request to `display: "summarized"` and the transcript gets readable text. This answers probe (c) of ES-15 for the S4 shape only: that shape does not use `between_tools`. An interactive session was not captured.

**Evidence.** One call per arm, same prompt, run direct to Anthropic with no `ANTHROPIC_BASE_URL`. Langfuse showed `traces=0` for those sessions, twice, about 30 s apart. That is strong evidence of a direct path, not proof, because ingestion lags.

| model | arm | `thinking_tokens` | transcript thinking text |
|---|---|---|---|
| Sonnet 5.5 | S4 as built | 121 | 1 block, 0 chars |
| Sonnet 5.5 | plus flag | 55 | 1 block, 193 chars |
| Opus 5.5 | S4 as built | 333 | 2 blocks, 0 chars each |
| Opus 5.5 | plus flag | 770 | 2 blocks, 118 and 718 chars |

The token gaps between arms are noise at one run per arm. They are not an effect of the flag.

**Why the first capture misled.** A first pair went through `scripts/record_shim.py` and the proxy. The shim logged what the client sent: `omitted` for the plain arm and `summarized` for the flag arm. Both transcripts held text, because `FORCE_THINKING_DISPLAY=1` in the proxy rewrote `omitted` after the shim. So a transcript is empty only without the flag AND without the proxy rewrite. The statement in `observability-instruments.md` that transcripts are empty needs that qualifier.

**What the docs say (read by a research agent, not re-read by the author).**
- `display` has three values: `summarized`, `omitted` and `updates` (beta, header `thinking-display-updates-2026-08-18`). Sonnet 5.5, Opus 5.5 and Fable 5.1 default to `omitted`.
- The text is a summary written by a different model. No setting returns the raw chain of thought.
- Billing is the same for every `display` value. `usage.output_tokens_details.thinking_tokens` is the billed count, and summary length is not.
- The installed CLI (2.1.292) has `--thinking-display`, hidden from `--help`. Its text also names a value `highlights`, which the API accepts only from Anthropic-hosted sessions.
- `showThinkingSummaries` applies to interactive sessions only. OpenTelemetry redacts thinking. No hook field carries thinking text.
- anthropics/claude-code#78200 reports empty text from Sonnet 5 and Opus 4.8 even with the flag. It did not reproduce on Sonnet 5.5 or Opus 5.5.

**Not established.** (a) Whether the flag changes how much the model thinks: the docs say it does not, and n=1 per arm cannot show it. (b) Behaviour on Fable 5.1, which also needs 30-day retention. (c) Whether a full S4 run keeps text in every transcript. The canary does not check for text.

**Source:** direct and shim runs of 2026-10-07 (outputs under the session scratchpad in `/tmp`, so not durable); `~/agents/llm-proxy/docs/trackers/observability-instruments.md`; research tracker `8ad5f00472dc1e42`; ES-5, ES-15.

## ES-17 — Mods expose `turn.step` with a rewritable `effort`: the actuation lever the research missed

**Valid:** dated 2026-10-07

**Observer probe 2026-10-07 (read-only mod `effort-observer`, hot-reloaded in the `~/.claude-sdd` session, `claude plugin validate` passed):** `turn.step` DOES fire once per model request on the main loop. Two steps of one turn were logged: `turnId` b03a411e-…, `index` 0 and 1, `agentId` null, `model` `claude-sonnet-5-5`, `effort` `high` at both, `messageCount` 1934 then 1944. The transcript's assistant records in the same minute carry `effort` `high` and `perTurnEffort` `high`, so the event's `effort` equals the effort in force. The step timestamps (07:56:37Z and 07:56:41Z) bracket the assistant record at 07:56:40Z. Still NOT tested: a subagent step with an `agentId`; a rewrite (`next({ ...e, effort })`) and whether it reaches the wire and the transcript; the cache effect of a change; a headless `claude -p --setting-sources local --settings ...` load (`--plugin-dir`). Probe files: session scratchpad `effort-observer/` (not durable) and `~/.claude-sdd/dev-mods/<session>/effort-observer/` (session-scoped, outside any repo).

**Headless rewrite probe 2026-10-07 (operator approved 6 calls; all 6 ran, rc 0, empty stderr):** mod `effort-rewriter` (scratchpad, loaded with `--plugin-dir`, NOT in `dev-mods`), `claude -p --model claude-sonnet-5-5 --setting-sources local --settings '{}' --strict-mcp-config --thinking-display summarized --plugin-dir <mod>`, `env -i` with `CLAUDE_CONFIG_DIR=~/.claude-sdd`, stdin from /dev/null, one-line prompt (registered S4 prompt 9, the Redis rate limiter), interleaved order none, low, high, none, low, high. Results (one assistant call per run; transcripts under `~/.claude-sdd/projects/*/<session>.jsonl`):

| run | rewrite | `effort` in transcript | thinking_tokens | output_tokens |
|---|---|---|---|---|
| 1 | none | medium | 0 | 2087 |
| 4 | none | medium | 0 | 2340 |
| 2 | low | low | 0 | 1533 |
| 5 | low | low | 0 | 1734 |
| 3 | high | high | 1033 | 3120 |
| 6 | high | high | 1396 | 3519 |

Established: (1) a mod DOES load in a headless `claude -p` with `--setting-sources local --settings '{}'` and `--plugin-dir`; every run wrote its step file. (2) `next({ ...e, effort })` in `turn.step` DOES reach the request: the step logs show `before` medium and `rewrittenTo` low or high, and the transcript's `effort` and `perTurnEffort` fields equal the rewritten level in every run. (3) Effort moves the output: mean output tokens 1,634 at low, 2,214 at medium (low is 26 percent lower), 3,320 at high (50 percent above medium). (4) At `high` the model thinks (1,033 and 1,396 thinking_tokens, one thinking block each) where it thought 0 at medium and low on the same prompt: the floor that sank S4 is broken by effort. Limits: n=2 per arm, one prompt, one-request turns; no quality check; thinking appears only at high, so a low-versus-medium thinking effect cannot be seen on this prompt; the cache effect of a change is NOT measured (a single request has no earlier cache) and a mid-turn change is NOT tested (index 0 only); subagent steps are untested. The 6 transcripts and the run directories stay in the scratchpad and `~/.claude-sdd/projects/` (not cleaned).

**Cache and mid-turn probe 2026-10-07 (operator approved 6 runs; all ran, rc 0, empty stderr, every run answered `banana`):** mod `effort-stepper` (scratchpad, `--plugin-dir`; effort per step index from a comma list), `claude -p --model claude-sonnet-5-5 --setting-sources local --settings '{}' --strict-mcp-config --thinking-display summarized --tools Read --allowedTools Read`, `env -i`, `CLAUDE_CONFIG_DIR=~/.claude-sdd`, stdin /dev/null. Each run is a forced sequential tool loop (step1.txt to step4.txt, DONE), so a turn has 5 requests, index 0 to 4. Arms: A no rewrite (medium); B medium for steps 0 and 1, then high; C high for steps 0 and 1, then low; order A,B,C,A,B,C. Per request (from the transcripts, deduped by `message.id`): `cache_creation_input_tokens` / `cache_read_input_tokens` were IDENTICAL in all six runs: step 0 create 2,209 read 1,448; step 1 create 163 read 3,657; step 2 create 163 read 3,820; step 3 create 163 read 3,983; step 4 create 162 read 4,146; `input_tokens` 2 throughout. So the step where the effort changed (index 2, medium to high in B, high to low in C) shows the same cache read and creation as the unchanged control A, and as the step before it. The transcript `effort` of each request equals the rewrite (B: medium, medium, high, high, high; C: high, high, low, low, low). No API error, no failed run. `thinking_tokens` were 0 at every step of every arm, including `high`.

Established (Sonnet 5.5, this setup): (1) a mid-turn effort change is accepted by the API in both directions (up and down) and reaches the request; (2) in a tool loop with a small prefix (about 4,000 tokens, tools limited to Read) it caused NO cache miss: the cache-read and creation counts at the changed step equal the control's, and a miss would have shown as creation near the whole prefix with read near 0, so the metric could have shown the failure. NOT established: (a) the cache behaviour when the history holds thinking blocks (thinking was 0 here, so no thinking block existed to be invalidated; the docs treat changed thinking parameters as an invalidation risk for message prefixes); (b) a large prefix (the default tool set and a long session; research tracker section 8 cites #92444, partial miss on Sonnet 5 and full rewrite on Opus 5, which this probe neither confirms nor refutes for those conditions); (c) other models (Opus 5.5, Fable 5.1); (d) any thinking effect of a mid-turn change: the model did not think even at `high` on this trivial loop, which is the same floor as the first S4, so the loop needs a task that makes it think; (e) subagent steps; (f) answer quality. The 6 run directories and transcripts stay in the scratchpad `probe2-runs/` and `~/.claude-sdd/projects/` (not cleaned).

**Cache and mid-turn probe 3, thinking loop and default tools, 2026-10-07 (operator "ok, go", about 6 runs; all 6 ran, rc 0, empty stderr, each run capped at 2 USD, every run answered `kiwi`):** same mod (`effort-stepper`) and flags as probe 2 but WITHOUT `--tools Read` (the default tool set, `--allowedTools Read`) and a loop of three puzzles whose answers name the next file (start.txt answer 80, f80.txt answer 61, f61.txt answer 14, f14.txt `DONE: kiwi`; 100 files f00 to f99 per run so a listing reveals nothing). 5 requests per turn, index 0 to 4; the effort changes at index 2. Arms: A no rewrite (medium); B medium,medium,high; C high,high,low; D high throughout; order C,B,D,A,C,B. Per request (transcripts; every record of a message counted, the thinking block sits in an earlier record than the tool_use of the same `message.id`):

**Cache.** The invariant `cache_read(k) = cache_read(k-1) + cache_creation(k-1)` held at ALL 24 request-to-request transitions in 6 runs, including the changed step 2 of B (medium to high) and C (high to low). Prefix about 17,000 tokens (step 0: create 5,642, read 10,946; step 1 read 16,588; step 4 read 17,396 to 17,464). In C the history before the change held a thinking block (step 1 thinking, 40 to 42 tokens), and step 2 still read exactly the previous read plus creation. So no cache miss from a mid-turn effort change in either direction, with a 17k prefix and with a thinking block in the history of the same turn. A miss would have shown as a read below the expected value; the check could have failed.

**Thinking and output (secondary).** `thinking_tokens` per step (steps 1, 2, 3): A (medium) 0, 0, 207; B (medium, medium, high) 0, 0 then 224 and 189 at step 3 in its two runs; D (high all) 0, 0, 238; C (high, high, low) 42, 108, 225 and 40, 108, 221. Where the model did not think it wrote visible text before the tool call instead. Total output tokens per run were close (about 790 to 870). Effort therefore had NO consistent effect on thinking in this loop: the model thought about puzzle 3 in every arm whatever the effort; at step 1 under the same `high` it thought in both C runs and in the single D run it did not (n=1 for D, unexplained and not a finding); at step 2 effort `low` in C went with 108 thinking tokens in both runs while medium and high had 0. Probe 1 (a free-form design prompt) is still the only place where `high` clearly raised thinking (0 to 1,033 and 1,396).

NOT established after probes 2 and 3: (a) a change at a TURN boundary (a new user message in a long session, which is what a `UserPromptSubmit`-style policy does; thinking blocks of earlier turns are dropped there, so the docs' invalidation risk applies to that case and not to what these probes tested); (b) a large prefix of a long real session (these were 17k tokens); (c) Opus 5.5 and Fable 5.1 (the research cites a full rewrite on Opus 5); (d) subagent steps; (e) quality; (f) dollar cost (transcripts carry no price; no `--max-budget-usd` stop fired). A bug of mine while reading the data: the first table counted thinking blocks from the last record of each message and showed none; recounting over all records found them (kept here as a warning for any analysis of these transcripts).

**INSTRUMENT AUDIT 2026-10-07 (operator asked "are we sure our instruments are ok?"; no model call; read this before relying on any ES-17 conclusion above).** (1) Transcript `usage` fields (cache creation and read, `thinking_tokens`): self-consistent (first, last and max record of a message agree in probe 3; the cache numbers repeat exactly across runs; the read-plus-creation rule holds in the constant-effort arms A and D), but NOT checked against an independent source (the runs bypassed llm-proxy, so no Langfuse record exists). (2) The cache-miss detector (read(k) = read(k-1) + creation(k-1)): a real regularity in the controls, but it has NO positive control: nobody has made it fail on purpose, so "it could have failed" is an argument and not a demonstration. (3) MOST IMPORTANT: that the rewritten effort reached the WIRE at a mid-turn step is not established. The only evidence is the harness's own records (the mod's `before` and `rewrittenTo`, and the transcript `effort` / `perTurnEffort` fields). Behavioural evidence exists only for step 0 (probe 1: `high` gave 1,033 and 1,396 thinking tokens against 0, and output tokens moved by minus 26 and plus 50 percent). For mid-turn steps in probes 2 and 3 there is no behavioural difference and no wire capture, and the research tracker says the per-message effort mechanism "keeps the cache and takes effect from the next user turn" (effort-steering-research-2026-10-06.md, section 1; read from docs, not tested). So "a mid-turn change causes no cache miss" is currently NOT interpretable: it is equally what we would see if the mid-turn rewrite were recorded but not applied, or applied as an appended pin message that leaves the prefix alone. DOWNGRADE: of the probe 2 and 3 conclusions only "the API raised no error and the runs completed" stands; the cache conclusion is provisional. (4) My own reading error (last record of a message hides the thinking block) was found and fixed. (5) The existing `~/agents/llm-proxy/scripts/record_shim.py` records `thinking`, `stream`, `model`, `max_tokens`, `n_messages`, `n_tools` and the beta header, but NOT `output_config` and NOT the effort pins inside `messages`, so it cannot answer (3) as it stands; its upstream is llm-proxy (shared infrastructure), which the product must not depend on. (6) The first S4 instruments were checked independently (49 transcripts with one-line first messages, the peer's clean control, a mutation-reviewed analysis), but its power assumption (baseline 400 thinking tokens) was wrong. Needed before any cache conclusion: I1, wire visibility of the effort per request (try `claude --debug-file` first; otherwise a minimal recording forwarder that logs `output_config`, `thinking`, the beta header and any `role: system` pins per request); I2, a positive control that must break the cache (the mod switches `model` at step 2); and for the turn-boundary probe a same-effort control at the boundary.

**INSTRUMENT CHECKS I1 AND I2, RESULT 2026-10-07 (operator approved; 2 recorder runs of 5 and 17 requests, plus one 5-request debug-log run).** I1, wire visibility. (a) `claude --debug-file` (586 lines, 5 requests) shows plugin loading and `[API REQUEST]` lines but NO request parameters (0 hits for `output_config`): it cannot answer the question. (b) I wrote a local recorder (scratchpad `wire_recorder.py`, not durable: it binds 127.0.0.1, forwards to https://api.anthropic.com unchanged and logs per request only `output_config`, `thinking`, the beta header, model, stream, max_tokens, message count, last roles and the pin messages; tested with no model call against a dummy upstream: fields logged, response forwarded, a planted secret and prompt text not logged). (c) One B-arm run (medium, medium, high) through it, `ANTHROPIC_BASE_URL=http://127.0.0.1:8099`: the top-level `output_config.effort` of requests 0 to 4 was medium, medium, HIGH, high, high, `thinking` was `adaptive` with `display: summarized` on all, and Claude Code also appended a `role: system` message carrying `output_config: {effort: high}` at the tail of the messages at the change (index 7 in request 2; the earlier medium pin at index 1 stayed in place); the betas included `per-turn-control-2026-07-01` and `mid-conversation-system-2026-04-07`. So a mod's mid-turn effort rewrite DOES reach the wire, both as the request's own effort and as an appended pin, and the earlier part of the messages is not touched. In that same run the cache rule held at all four transitions including the changed step 2 (create 238, read 31,684 as expected). I2, positive control for the cache-miss detector: the mod (`step-switcher`) switched the model from `claude-sonnet-5-5` to `claude-haiku-4-5-20251001` at step 2. At step 2 the cache read fell to 0 and the creation rose to 24,682 (expected read 31,683, violation 31,683 tokens), then recovered from step 3; Haiku wandered through 17 requests instead of 5 (it answered puzzles wrongly, then recovered, and the loop still ended `kiwi`). The wire shows the engine rebuilt the request for the new model: `thinking` `{type: enabled, budget_tokens: 31999}` and NO `output_config`. So the detector CAN see a miss. Side effect: through the recorder the prefix was about 31,400 tokens at step 0 and 1 against about 16,600 for the same run shape sent direct; the cause was not investigated; do not mix cache numbers across the two paths.

**Conclusion after the checks.** The mid-turn effort result is now a measured one for this configuration: Sonnet 5.5, Claude Code 2.1.292 headless, up direction (medium to high) wire-verified with a 31k prefix, down direction (high to low) cache-checked in probe 3 only (not wire-captured), default tools: a mid-turn effort change reaches the API and caused NO cache miss. This differs from the research tracker's reading of the docs ("a top-level effort change restarts the prompt cache") and its #92444 measurements; those concern other conditions (Sonnet 5 versus 5.5, Opus 5) and were not re-tested. Still untested: a change at a TURN boundary, a long real session, Opus 5.5 and Fable 5.1, subagent steps, quality, and the thinking effect of a mid-turn change (the model thinks little in these loops).

**PROBE 4, EFFORT CHANGE AT A TURN BOUNDARY, 2026-10-07 (operator approved; script `effort-steering/spikes/probes/run-boundary.sh` at commit `8e4370f`; 4 arms x 2 turns, 8 requests, Sonnet 5.5, CLI 2.1.292, default tools, through the wire recorder; all rc 0):** turn 1 at effort X, then `--resume` of the same session for turn 2 at effort Y (the stepper mod reads `.effort-probe`, rewritten between the calls). Wire effort (recorder) and transcript effort agreed in every request.

| arm X>Y | turn 1 effort | turn 1 create / read | turn 1 thinking | turn 2 effort (wire) | turn 2 read | expected read (read1 + create1) | gap |
|---|---|---|---|---|---|---|---|
| H>H (control) | high | 5,731 / 25,676 | 847 | high | 31,407 | 31,407 | 0 |
| M>H | medium | 5,731 / 25,676 | 898 | high | 31,407 | 31,407 | 0 |
| H>L | high | 5,731 / 25,676 | 1,388 | low | 31,407 | 31,407 | 0 |
| M>M (control) | medium | 5,731 / 25,676 | 535 | medium | 31,407 | 31,407 | 0 |

Established: at a turn boundary the rewritten effort reaches the wire (a new system pin message appears, `nPins` 1 to 2, in the control arms too) and the cache read at the first request of turn 2 equals the previous request's read plus creation exactly (gap 0) in all four arms, up (M>H) and down (H>L) as well as in the same-effort controls. Together with probes 2 and 3 and the checks I1 and I2: in this configuration (Sonnet 5.5, CLI 2.1.292, headless, default tools, a prefix of about 31,000 tokens through the recorder) an effort change, mid-turn or at a turn boundary, up or down, causes no cache miss.

LIMIT OF THIS PROBE (found while reading the controls): every turn here was ONE request, so turn 1's assistant message, thinking block included, was never written to the cache by a later request of the same turn. What the boundary invalidates in a long session (the thinking blocks of earlier turns that a later request had cached) is therefore NOT exercised, and the control arms show gap 0 for that reason. A probe with a tool loop in turn 1 followed by a new turn would test it; its same-effort control would show the baseline loss, and the effort arms would be read against it. NOT tested either: a long real session, Opus 5.5 and Fable 5.1, subagent steps, quality.

OBSERVATION, NOT A FINDING: through the recorder (`ANTHROPIC_BASE_URL` set, which also doubled the prefix, see I1) the model thought 898 and 535 tokens at medium effort on the rate-limiter prompt, where the direct runs gave 0 thinking at medium on the same prompt (probe 1: 0 and 0; S4 holdout and the peer's baseline: 0 in 23 of 24 medium runs). The two paths are therefore NOT comparable for thinking amounts, and the cause was not isolated (candidates the data cannot separate: the recorder path, the explicit medium rewrite by the mod instead of the default). Any measured S4 run must use the direct path; the recorder is only for wire checks. Turn-1 thinking by effort, n=2 each: high 847 and 1,388, medium 898 and 535 (overlapping, not a result). Turn 2 thinking was 0 in every arm.

**Status:** found 2026-10-07 by reading the mods type declarations first-hand; the read-only observer probe confirmed that `turn.step` fires and carries the real `effort`; the headless rewrite probe confirmed that a rewrite reaches the request and the transcript and changes thinking and output. Probes 2, 3 and 4 plus the instrument checks I1 and I2 showed that an effort change reaches the wire and causes no cache miss, mid-turn or at a turn boundary, in the tested configuration (see INSTRUMENT CHECKS and PROBE 4 above, including the limit of probe 4). Still untested: the thinking-block effect of a boundary after a tool-loop turn, a long real session, other models, subagent steps, quality. The operator decides the next step.
**Done when:** a probe shows, in a transcript or on the wire, whether `next({ ...e, effort })` in a `turn.step` hook changes the effort of that request, whether a mod loads in a headless `claude -p --setting-sources local --settings ...` run (`--plugin-dir`), and what a changed effort does to the cache; then ES-5's second registration is chosen with this lever in view.

**Finding (read, not tested).** The `plugin-authoring` skill of this session writes this build's API to `types/claude-code.d.ts` (path `/tmp/claude-1000/bundled-skills/2.1.289/<hash>/plugin-authoring/types/`, not durable; the skill says 2.1.289 while ES-16 records the installed CLI as 2.1.292, so the builds may differ). It declares the event `turn.step` (lines 4293 to 4301 and 12768 to 12830): it fires when the engine is about to send ONE model request of a turn, main or subagent (`e.agentId`), `next(e)` resolves to the whole response, and `next({ ...e, model })` or `next({ ...e, effort })` sends another. Fields: `turnId` and `index` (the step's position in the turn, from 0) and `messageCount` are pinned; `model` and `effort` (`'low' | 'medium' | 'high' | 'xhigh' | 'max' | number`, absent for a model without effort) are rewritable. `$.session.messages()` reads the conversation. A hook that answers without `next` sends no request. Other declared items: `turn.start` and `turn.complete`, `prompt.submit` (`next({ ...e, text })`), `prompt.compose` (system prompt sections), `$.model.complete({ model, prompt, effort })`, `$.process.run(argv)` (a mod could call `effort-policy decide`), and the classic hook input's `effort` (BaseHookInput line 793: effort in force, also the env var `CLAUDE_EFFORT`).

**Why it matters.** (1) The first-phase conclusion "a hook cannot set effort" (ES-14) is true of classic `UserPromptSubmit` hooks only. A mod can set effort per request, with the step index, and so per turn or per step, without a settings write (D-1's shared-state hazard) and without steering text. (2) `claude-mods-research-2026-10-06.md` never mentions effort or thinking (grep: only `$.model.complete` and MQ-5 match), so this route is in no research file. (3) It changes the measurement: S4 could compare effort levels directly (a lever with an expected large effect and, at high effort, no floor) before steering text is tested at all.

**Not known.** Whether a rewritten effort reaches the wire request and is kept in the transcript (`effort` / `perTurnEffort` fields exist on assistant records); whether a mid-turn change is accepted by the API under adaptive thinking or invalidates the prompt cache (research tracker section 8 cites contested measurements: partial miss on Sonnet 5, full rewrite on Opus 5, none on Fable 5.1); whether a mod loads under `--setting-sources local --settings` and `--strict-mcp-config`; whether the hot-reload folder or `--plugin-dir` is the right load path (MQ-1); the budget of a streaming hook. Mods are unsandboxed and see every prompt. Portability: a mod is Claude Code only, so the harness-neutral core stays and a mod would be a second adapter (shallow / default / deep mapped to `low` / unchanged / `high`).

**Source:** `types/claude-code.d.ts` of the `plugin-authoring` skill, lines 4288 to 4301, 12768 to 12830, 793 to 797, 5946 to 5956; `docs/trackers/claude-mods-research-2026-10-06.md`; ES-14 (D-1), ES-5, ES-16; explorer digest of 2026-10-07.

## ES-18 — Clean baselines at medium and xhigh, and the stdin pitfall that voided three pilots

**Valid:** dated 2026-10-07

**Status:** measured 2026-10-07; findings only. No code, registration or `effort-steering/` file was changed by this entry. The registered S4 run (verdict `mechanism_fail`, ES-5) used the default effort `medium`. A second registration is the operator's decision.
**Done when:** the operator decides whether to re-register S4 at `xhigh` (option A) or with reweighted prompts (option B), and the decision is written down.

**Correction first.** Three earlier pilots by the llm-proxy session were INVALID and are discarded. Their loop was `while read -r P; do claude -p ... -- "$P"; done < prompts.txt`, and `claude -p` also read the loop's stdin file, so every call saw the whole prompt file appended. The first user message of those transcripts had 8, 8 and 14 lines instead of 1. Rule for every harness script: redirect stdin (`< /dev/null`) on each `claude -p` call, or read the prompts on another file descriptor, and check `first user message lines == 1` in the transcript. The ES-16 runs were checked and are clean.

**Clean baselines** (Sonnet 5.5, no steering hook, no proxy, `claude -p --setting-sources local --settings '{}' --strict-mcp-config --thinking-display summarized`, stdin from `/dev/null`, the 12 registered prompts, 2 runs each, 24 calls per level; every transcript has a one-line first user message and the recorded `effort`).

| effort | zero-thinking runs | mean `thinking_tokens` | max | cost |
|---|---|---|---|---|
| `medium` | 23 of 24 | 1.0 | 23 | $0.44 |
| `xhigh` | 6 of 24 | 883 | 5,928 | $0.93 |

At `xhigh`, per-prompt means: p1 to p3 0; p4 16; p5 63; p6 28; p7 162; p8 85; p9 (rate limiter) 3,148; p10 (memory leak) 1,355; p11 264; p12 (palindrome) 5,472. Prompts 9, 10 and 12 hold about 94 percent of all thinking. The two runs of one prompt differ by 177 tokens on average (rough, n=2). This agrees with the peer's S4 holdout arm: 0 thinking tokens in 22 of 24 runs at `medium`.

**What follows.** (1) The `mechanism_fail` of the registered run is expected: at `medium` the baseline has almost no thinking to cut, so the 60-token gate on the mean over prompts cannot be met by any steer. It does not show that steering text fails. (2) At `xhigh` a steer has room: a 30 percent cut of the overall mean would be about 265 tokens (arithmetic, not a power calculation). (3) Prompts 1 to 3 never think at either level, so they add a delta of 0 and dilute the mean. (4) Direction `up` at `medium` is untested.

**How to set effort for a child run.** `claude -p --effort <level>` works (the flag is listed in `claude --help`); `CLAUDE_CODE_EFFORT_LEVEL` also exists in the binary. A saved `/model` or settings default does not reach a child started with `--setting-sources local`. The S4 runner passes no `--effort`, so its runs use the default. One verification call with `--effort xhigh` recorded `effort: xhigh` in the transcript.

**Not established.** One model (Sonnet 5.5), two runs per prompt; Opus 5.5, `high` and `max` untested; the S4 cost at `xhigh` is an estimate (perhaps $2 to $3 for 49 calls, most of it in the heavy prompts).

**Source:** clean baseline runs of 2026-10-07 (outputs under the llm-proxy session scratchpad in `/tmp`, not durable); peer message from the S4 session (holdout 0 in 22 of 24, all 49 transcripts clean); ES-5, ES-16; `~/agents/llm-proxy/docs/trackers/observability-instruments.md`.

## ES-19 — Second S4 registration at xhigh on 8 prompts that think (G3 pending)

**Valid:** dated 2026-10-07

**Status:** second S4 registration committed as `c018c8b` (suite green, 514 ok). NO run has happened. G3 (the model-call run, 33 calls with the canary) waits for the operator. The first registration (`5077dc4`, 12 prompts at the default `medium` effort, verdict `mechanism_fail`) stays in history.
**Done when:** the operator approves or declines G3, the run is made once, and the verdict is written down.

**What changed.** (1) `loadPrereg` has a required `effort` field (`low`, `medium`, `high`, `xhigh`, `max`); the runner passes `--effort <registered>` on every call, canary included; two runner tests and one loader test pin it. (2) `s4-prereg.json` registers: direction `down`, steerLevel `shallow`, model `claude-sonnet-5-5`, effort `xhigh`, 8 prompts, 4 repeats at holdout 0.5 (2 treated and 2 holdout per prompt), effect gate 400 `thinking_tokens` on the mean signed delta, alpha 0.01, 20,000 permutations, `minPerArm` 13 (planned arm totals are 16, so 3 runs of slack), latency budget 500 ms (unchanged, `POLICY_TIMEOUT_MS` still 500), seed 20261008.

**Why these prompts.** Chosen from the clean `xhigh` baselines of ES-18 and a second clean candidate round (20 calls, 10 candidates, 2 runs each): rate limiter (mean 3,148), memory leak (1,355), palindromic substring (5,472), 3x10 tiling (1,268), minimal DFA (705), Go gzip latency (1,482), bug hunt (2,012), LRU cache (1,286). Left out on purpose: the schema migration (mean 7,372, runs 5,531 and 9,214) and the SPSC ring buffer (4,530, runs 3,170 and 5,891), because their spread would add more noise than signal to a mean of absolute deltas; the n^5 - n proof (222) is below the floor of about 300; the first 12 prompts p1 to p8 and p11 think 0 to about 260 tokens at `xhigh`. The choice used only those baseline runs, never the registered run.

**Rough expectation, not a simulation.** From two runs per prompt, the standard error of the mean delta is near 120 tokens against a 30 percent cut of about 630. Spreads rest on n=2 and a tight pair may be luck, so this is optimistic. A cost estimate of $2 to $3 for 33 calls is an estimate from the baseline cost per call.

**Before G3.** (a) `effort-steering/spikes/probes/` is untracked; the runner refuses with `dirty_tree` while any untracked or ignored file is under `effort-steering/`. The owner of the probes must commit or remove them. (b) The runner does not yet check that each transcript records the registered effort. One verification call with the same argv shape recorded `effort: xhigh`; a per-run check would make a silent mismatch visible before the budget is spent. (c) A pass would show that steering lowers thinking where there is much to lower; it would not show the same for light turns. Opus 5.5 and the other effort levels are untested.

**Source:** commit `c018c8b`; ES-5, ES-16, ES-18; clean candidate runs of 2026-10-07 (outputs under the llm-proxy session scratchpad in `/tmp`, not durable).

## ES-20 — Effort dose-response experiment (design): does the effort lever save cost and keep quality?

**Valid:** dated 2026-10-07

**Status:** DESIGN proposed 2026-10-07; nothing is registered; the only model calls made for it are the calibration pilot below (63 calls at medium, $0.673), whose result is that the first candidate set is at the ceiling. The operator ruled on two points (below). The candidate tasks are committed for review; the registration numbers, the plan and the runner variant wait for the operator's approval of this design.
**Done when:** the operator approves the task set and the gate proposals (or changes them); a plan exists; a calibration pilot has chosen the final tasks; the registration is committed BEFORE the first measured call; the run is done once and its verdict written down.

**Why this experiment.** ES-17 shows a mod can set the request's effort per request, mid-turn or at a turn boundary, with no cache miss (Sonnet 5.5, CLI 2.1.292). For a policy to be worth building the lever must deliver: less cost on easy turns, better answers on hard turns. ES-19 (the peer's second S4 registration) tests whether a steering SENTENCE cuts thinking at xhigh; this entry tests the effort PARAMETER itself, which is the stronger lever and needs no sentence and no settings write. The two do not conflict: text steering stays the portable actuator for harnesses without an effort control; the effort lever is the Claude Code actuator.

**Operator rulings (2026-10-07).** (1) Baseline effort `high` (what the operator's sessions run now: transcripts show medium 2026-10-04 to 05, high from 2026-10-06), four levels low, medium, high, xhigh; savings are measured against `high` and quality gains are xhigh against `high`. (2) Quality is measured with CHECKABLE tasks (an exact answer graded by a script), not with an LLM judge.

**Proposed design (all numbers below are proposals, not registered).**
- Manipulation: `claude -p --effort <level>` (works for a child, ES-18; ES-19's loader and runner change already registers and passes it), levels low, medium, high, xhigh, one model (Sonnet 5.5), the DIRECT path (not the wire recorder: ES-17 probe 4 found the recorder path changes how much the model thinks), stdin from /dev/null, tools off for these text tasks (check that `--tools ""` disables all tools before use), and a check that every first user message is one line.
- Tasks: `effort-steering/spikes/dose/tasks.candidates.json`, 21 candidates (6 easy, 7 medium, 8 hard), each with an exact answer COMPUTED by `make-tasks.py` (a literal that disagreed with the computation aborts the script; it was run and regenerates the file byte for byte). The prompt ends with `End your reply with one final line of the form "ANSWER: <value>".` Grading: take the last `ANSWER:` line, normalise (trim, case, thousands separators) and compare exactly; a fraction is compared as reduced a/b; a two-digit value keeps its leading zero. No model-written code is executed (so no sandbox is needed); the realism limit is that these are single-turn exact-answer tasks, not tool-loop coding turns (that is S5).
- Calibration pilot (before registering): each candidate three times at `medium` (about 63 calls, a few dollars). Keep the medium and hard tasks that medium solves neither 0 of 3 nor 3 of 3 (a quality effect cannot show on the others); keep the easy tasks that medium always solves. Target after calibration: up to 4 easy, 4 medium, 6 to 8 hard.
- Main run: kept tasks x 4 levels x 3 repeats, order interleaved and shuffled with a registered seed (about 190 calls). Cost is an extrapolation, NOT measured for these tasks: ES-18 measured about $0.018 per call at medium and about $0.039 at xhigh for the open-ended prompts, so about $4 to $6.
- Outcomes per run: `output_tokens` (includes thinking), `thinking_tokens`, cost, correct (0 or 1). Per-stratum within-task paired differences against `high`, tested with the within-task permutation test the first S4 already has (`analyzeArms` style, arms relabelled).
- Gate proposals (to be fixed after the calibration shows the output scale, before the main run): (A) saving: on the easy stratum, `low` cuts mean `output_tokens` against `high` by at least a registered fraction (proposal 25 percent) AND at least a registered absolute amount, one-sided p at most 0.01, with accuracy at `low` not below accuracy at `high` by more than a registered margin (proposal one run in 15). (B) quality: on the hard stratum report accuracy of xhigh minus `high` with an exact paired test; with about 20 to 24 hard runs per level a gain below about 20 percentage points cannot be shown, so B is DESCRIPTIVE and not a gate unless the calibration leaves enough discriminating hard tasks. (C) a mid-level reading (`medium` against `high`) is reported, not gated.

**CALIBRATION PILOT 1 RESULT 2026-10-07 (operator approved the design and the pilot; 63 calls = a 1-call smoke test plus 62; `effort-steering/spikes/dose/run-calibration.py`, not yet committed because the ES-19 run was in progress; rows in the session scratchpad `dose/calib/rows.jsonl`, not durable).** Sonnet 5.5, `--effort medium`, `--tools ""`, direct path, stdin from /dev/null, one session per run, `--output-format json`, 21 tasks x 3 repeats in a seeded shuffled order. All 63 runs rc 0, no errors, every first user message one line, no tool use, effort recorded `medium` in every transcript, total cost $0.673 (about $0.011 per call, measured from the JSON results). RESULT: **all 21 tasks were answered correctly 3 of 3** (easy, medium and hard alike). Only two tasks made the model think at medium: h2 (the seating puzzle, 317 to 404 thinking tokens) and h5 (squarefree pairs up to 100, 930 to 1,052); every other run had 0 thinking and 34 to 203 output tokens (h2 749 to 854, h5 1,405 to 1,476 output). So under the pilot rule (keep medium and hard tasks that medium solves neither 0 of 3 nor 3 of 3) NO task qualifies: this candidate set is at the ceiling for Sonnet 5.5 at medium and cannot show a quality effect of effort in either direction. What it still shows: these tasks are cheap (a few tokens), so on them `low` against `high` has little to save; the saving that matters is where a higher effort buys thinking that the task does not need, and on this set that is at most h2 and h5. DECISION NEEDED from the operator: author harder candidates (answers computed by script, difficulty scaled until medium accuracy is mixed) and run a second calibration round, or change the experiment (for example drop the accuracy outcome and measure only the thinking and cost that each effort level buys on tasks medium already solves).

**CALIBRATION ROUND 2 RESULT 2026-10-07 (operator approved a second round; 42 calls at medium on 14 harder tasks from `make-tasks2.py` -> `tasks.candidates2.json`, answers computed by script and three re-checked by a different code path; `run-calibration.py --tasks`).** 12 of the 14 tasks were solved 3 of 3 at medium (digit sums, a prime count below 3,000, coin and partition counts, a lattice-path count with an obstacle, an 18-digit product, modular powers). The other two, x3 (digit sum of 2 to the power 300) and x12 (count of composite n^2+n+41 up to 1,000), have NO wrong answers: with `--tools ""` the model reached for a tool that does not exist and wrote raw `<invoke name="Bash">` XML as its reply, so no `ANSWER:` line exists (x3: 3 runs; x12: 1 run a parse failure, 1 run a 600 s timeout, 1 run a runaway of 128,000 output tokens). Those are FORMAT failures of the tools-off setup on computation-heavy tasks, not accuracy failures, and the grader scored them wrong. COST: round 2 cost $1.781 (not the $0.5 I expected): the x12 runaway alone cost $1.2887, above the `--max-budget-usd 1` cap (the cap is checked after the fact), and the timed-out run is uncounted. Fix for any future runner: a call timeout of about 120 s, a flag for any run with more than a few thousand output tokens, and no computation-heavy task with tools off. Across both rounds the model solves 33 of 35 candidate tasks 3 of 3 at medium: exact-answer tasks answerable without tools are at the CEILING for Sonnet 5.5 at medium. CONSEQUENCE: no candidate qualifies under the pilot rule (medium accuracy neither 0 of 3 nor 3 of 3), so these tasks cannot show a quality GAIN from a higher effort; they can only show that a lower effort or the steer does not LOSE accuracy, and only if accuracy drops somewhere, which medium never did. The dose-response run as designed would therefore mostly measure tokens and cost per level. OPTIONS for the operator: (1) run it anyway on the 33 solvable tasks as a token and cost dose-response plus a non-inferiority check (cost about $5 to $8 for 2 repeats at 5 conditions, extrapolated); (2) measure quality on real-shaped tool-loop tasks with a test as grader (S5: a small repo with a bug, a hidden test, tools on), which is closer to the product and costs more to build; (3) park ES-20 and carry the quality caveat into the adapter work.

**Known weaknesses stated before the run.** Accuracy has low power at this size; token effects should have good power (the effort effect on output was 26 percent down at low and 50 percent up at high on one prompt, n=2, ES-17 probe 1, noise about 20 to 35 percent CV on thinking tokens). The tasks are easier and shorter than real coding turns; a result here says the lever works on exact-answer tasks and nothing yet about tool-loop turns. Single model. A calibration that selects tasks on medium accuracy cannot be used as evidence about medium.

**Review of ES-19 while preparing this (for the record).** The loader and runner change in `c018c8b` is minimal and correct (one required field, `--effort <registered>` on every call). Power of the ES-19 registration, from the real `analyzeArms`, 400 trials per cell, alpha 0.01, gate 400, 8 prompts with the three known xhigh means (3,148, 1,355, 5,472) and the other five ASSUMED at 2,000: false pass 1 to 2 percent; at noise CV 0.3 a 30 percent cut passes 0.71 and a 50 percent cut 1.00; at CV 0.7 they pass 0.18 and 0.59; at CV 1.0 0.12 and 0.35. Observed CV of thinking tokens at one prompt and effort: about 0.2 to 0.35 (ES-17 probes 1 and 4, n=2), so the first reading is the likelier one, but the five baselines are unknown. Suggested guard, not added: exclude a run whose transcript `effort` differs from the registered level (the transcript records it in every assistant record).

**Source:** operator rulings of 2026-10-07; ES-17, ES-18, ES-19; `effort-steering/spikes/dose/`.

## ES-21 — S4 second registration run: mechanism_pass (thinking -37%, answers also shorter)

**Valid:** dated 2026-10-07

**Status:** the second registered S4 run was made ONCE on 2026-10-07 and the verdict is `mechanism_pass`. The S4 verdict gate (G4) and what to do with it are the operator's.
**Done when:** the operator rules on the verdict (G4) and the next step (a quality check, S5, or the actuation work) is chosen.

**Run.** Registration `c018c8b` (ES-19), code at `2682f46` (the effort guard), run from a clean detached worktree because an untracked file in the main checkout would have made the runner refuse with `dirty_tree`. 33 calls (32 runs and 1 canary) on `claude-sonnet-5-5` at `xhigh`, direct to Anthropic (`endpoint: default`), exit 0 with an empty `stop` list. Canary ok. Zero exclusions in every reason, including the new `effort_mismatch`. Hook latency p95 119 ms over 32 runs against the 500 ms budget, 0 failures.

**Result.** 16 treated and 16 holdout runs over 8 prompts (2 and 2 per prompt). Median thinking 963.5 treated against 1,533.5 holdout. The statistic, the mean over prompts of the signed within-prompt reduction, is 688.75 `thinking_tokens` against the gate of 400. One-sided permutation p = 9.9995e-5 (20,000 permutations, alpha 0.01). Cache-creation share 10.4 percent treated against 12.2 percent holdout, so the cache gate holds.

| prompt | holdout | treated | change |
|---|---|---|---|
| rate limiter | 3,909 | 2,891 | -26% |
| memory leak | 1,534 | 940 | -39% |
| palindromic substring | 2,132 | 962 | -55% |
| 3x10 tiling | 569 | 396 | -30% |
| minimal DFA | 793 | 792 | 0% |
| Go gzip latency | 1,599 | 1,340 | -16% |
| bug hunt | 2,934 | 1,600 | -45% |
| LRU cache | 1,330 | 370 | -72% |

(Per-prompt medians of 2 runs per arm.) Seven of eight prompts fell; the DFA prompt did not move.

**Read from the transcripts afterwards (not part of the runner's verdict).** Mean over runs, treated against holdout: thinking 1,161 against 1,850 (-37 percent) and total `output_tokens` 2,892 against 3,954 (-27 percent). Output tokens fell on all 8 prompts and by more than thinking did, so the visible answers also became shorter. The steer did not move reasoning into visible text. A first attempt to measure visible text length was invalid (it kept only the first record of each message) and is discarded.

**What this does and does not show.** It shows that the hook's steering text ("Answer directly without deliberating.") lowers billed thinking on prompts where the model thinks a lot: the mechanism works for Sonnet 5.5 at `xhigh` on these 8 prompts. It does NOT show that the shorter answers are as good: no quality measure exists here, and the answers got shorter. Other limits: 2 runs per arm per prompt and one registered run; prompts were chosen because they think; no light turns; only Sonnet 5.5 at `xhigh`; Opus 5.5 and other levels untested; cost was not recorded by the runner (estimate $2 to $3). The effort guard was added after the registration; with 0 exclusions it changed no data.

**Independent re-derivation (the S4 first-registration session, 2026-10-07, from the 33 raw transcripts in `~/.claude-kat/projects/-tmp-s4-run-XmzuHv-work`, read-only, own script):** 33 sessions; `effort` is `xhigh` in every assistant record; every first user message is one line; arm taken from the presence of a `hook_additional_context` attachment: 16 treated and 16 holdout after dropping the earliest session (the canary, a treated rate-limiter run); per-prompt means of 2 and 2 give a mean signed within-prompt delta of 688.75 (the peer's figure, to the digit), mean thinking 1,161 treated against 1,850 holdout, mean output tokens 2,892 against 3,954, medians 963.5 against 1,533.5. All of the peer's headline numbers reproduce. Observation: the within-prompt spread is large for some prompts (palindrome treated runs 1,783 and 140; DFA holdout 593 and 992), so the n = 2 per-prompt figures are rough; the registered permutation test, not the per-prompt table, carries the verdict.

**Quality look at the existing S4 answers (the S4 first-registration session, 2026-10-07, no model call; script `effort-steering/spikes/dose/grade-s4-existing.py`; exploratory, NOT part of the verdict).** From the 32 non-canary transcripts, the four prompts with checkable content: (a) 3 by 10 domino tilings: the true count is 571 (dynamic programming; an earlier version of this check used 153 from memory, which is the 3 by 8 count, and was wrong; the recomputed value stands), and the final number of all four answers is 571 (2 treated, 2 holdout); (b) the bug-hunt snippet: all four answers name all three real bugs (`lo = mid` never advances, `hi = mid - 1` against an exclusive bound, the final `a[lo]` index past the end), by crude keyword match; (c) the palindrome function: the code of all four answers, run in an isolated `python3 -I` subprocess against a brute force on 47 strings, passes; (d) the LRU cache: the class of all four answers passes a get, put, eviction and update sequence (a first run of the harness left two holdout results untestable because of a harness bug, a `from __future__` line that must come first; fixed and rerun). Result: 16 of 16 graded runs pass, treated and holdout alike, so there is NO visible quality loss from the steer on these four prompts, which cut thinking 37 percent and output 27 percent overall. This is weak evidence: n = 2 per arm per prompt, the holdout arm also passes everything (a ceiling: a small quality loss could not show), the bug-hunt grade is a keyword match, the LRU test is one short sequence and ignores the thread-safety half of the prompt, and the other four prompts (rate limiter, memory leak, DFA, Go gzip) have no checkable answer.

**Operator ruling 2026-10-07: G4 (the S4 verdict) is HELD until a quality check exists** (the operator chose "hold until the quality check" over "accept the verdict").

**Source:** run output `s4-result.txt` (llm-proxy session scratchpad in `/tmp`, not durable; the numbers above are copied from it); transcripts under `~/.claude-kat/projects/-tmp-s4-run-XmzuHv-work`; ES-5, ES-18, ES-19, ES-20.

## Template for new entries

Use `doc(action="append_entry", id_prefix="ES", anchor_heading="## Template for new entries", title=…, body=…)` from the MAIN checkout. Each entry needs `**Status:**`, `**Done when:**` and `**Source:**`.
