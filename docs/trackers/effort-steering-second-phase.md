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

**Status:** open — needs the operator.
**Done when:** the operator chooses, and the CLI and its tests follow the choice.

A bad rate (not a number, below 0, above 1) is now treated as rate 0, so every turn is steered. The final reviewer preferred rate 1 (no steering on a configuration error). Both choices lose those rows from the experiment, and the reason `bad_holdout_rate` is logged either way. The change is one constant and its tests in `effort-steering/bin/effort-policy.mjs`.

**Source:** codescout review notes, ruling R3.

## ES-2 — Write the second plan

**Status:** open.
**Done when:** a plan for ES-3 to ES-10 is written with the writing-plans skill, committed and approved by the operator.

The design and every constraint are already written. Start from the spec section "Constraints carried into the second plan" and the review notes. Plan documents live in the codescout repo (`docs/superpowers/plans/`), as the first plan does. This tracker is the work list.

**Source:** codescout spec.

## ES-3 — Claude Code adapter (a `UserPromptSubmit` hook)

**Status:** open — blocked by ES-2 and ES-7.
**Done when:** a hook script under `effort-steering/` reads the hook input, calls `bin/effort-policy.mjs decide` and emits `additionalContext` only when `steer` is not null, with tests.

Facts from spike S1: the hook input has `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name` and `prompt` (all strings) and no effort level. Use `prompt_id` as `turn_id`. Constraints:
- Put a wall-clock timeout around the CLI, and treat a timeout as `default` with no steering. The CLI has no timeout of its own.
- Always exit 0 from the hook. Exit code 2 from a `UserPromptSubmit` hook blocks and erases the user's prompt. The CLI exits 64 for a usage error.
- Never derive `turn_id`, `harness` or `session_id` from prompt text. The log writes them as given.
- Log and alert on the reasons `unknown_arg`, `bad_holdout_rate`, `rules_unreadable`, `table_unreadable` and `log_failed` during rollout. Each can silently change the experiment.
- Session signals (previous-turn failure, retries) can come from the transcript tail. `permission_mode` may give plan mode; its possible values are unchecked.

**Source:** codescout spec, decisions D1 and D2 and the constraints section; codescout findings, section S1.

## ES-4 — Check how Claude Code merges `additionalContext` from several hooks

**Status:** open — unverified.
**Done when:** a scratch run shows the order and the merge of `additionalContext` when `codescout-companion`'s `constitution-brief.mjs` and the new hook both fire, and the result is recorded here.

Spike S1 ran with user-level plugin hooks switched off (`--setting-sources local`), so it says nothing about this. Also check whether hook-injected steering text is cache-neutral. That feeds ES-5.

**Source:** codescout spec, "Unverified claims register".

## ES-5 — Spikes S4 and S5: does steering text move thinking depth?

**Status:** open — blocked by ES-3 and ES-4. It costs model calls, so ask the operator first.
**Done when:** the gate numbers are registered BEFORE any run (effect size on `thinking_tokens`, latency budget, holdout rate), the experiment is run with the holdout arm, and the result is written down.

Stop rule from the spec: if steering text moves nothing against the holdout, actuation A fails. Then stop, or reopen the opt-in settings write (a shared-state hazard, because `settings.local.json` is per project). Measurement comes from transcripts: `usage.output_tokens_details.thinking_tokens`, the cache fields and the top-level `effort` field, deduped by `message.id`. The replay scripts in `effort-steering/spikes/` show how.

**Source:** codescout spec, decision D5 and "Measurement and gates".

## ES-6 — Session-signal replay (S3b)

**Status:** open — read-only and cheap; it can run at any time.
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

## Template for new entries

Use `doc(action="append_entry", id_prefix="ES", anchor_heading="## Template for new entries", title=…, body=…)` from the MAIN checkout. Each entry needs `**Status:**`, `**Done when:**` and `**Source:**`.
