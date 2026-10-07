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
entry_high_water_ES: 16
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

**Status:** open, found 2026-10-06 in the live decision logs (hook wired in `~/.claude` and `~/.claude-sdd`). Nothing is changed in code. The operator has not yet decided the key or the arm unit.
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

**Status:** open. The research is recorded in the tracker `docs/trackers/effort-steering-research-2026-10-06.md` (id `8ad5f00472dc1e42`). Nothing is changed in code, and the operator has not ruled on D-1 to D-5.
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

## Template for new entries

Use `doc(action="append_entry", id_prefix="ES", anchor_heading="## Template for new entries", title=…, body=…)` from the MAIN checkout. Each entry needs `**Status:**`, `**Done when:**` and `**Source:**`.
