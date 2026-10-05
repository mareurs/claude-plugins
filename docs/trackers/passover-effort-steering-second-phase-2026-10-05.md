---
id: b2838d56206e8d62
kind: tracker
status: active
title: Passover — effort-steering second phase — 2026-10-05
tags:
- passover
topic: effort-steering second phase
time_scope: dated:2026-10-05
branch: main
origin_session_id: 16bc6017-d129-44f7-91e5-43b0afad5ea9
---

# Passover — effort-steering second phase — 2026-10-05

## State

UPDATE 2026-10-05 (later): the plan was approved (ES-2 done) and executed with subagent-driven development up to the first operator gates. ES-1, ES-6, ES-7, ES-8 are done on `main`/the branch; ES-3, ES-4 (read-only half) and the code of ES-5 are built on the branch `feat/effort-steering-adapter` (worktree `/home/marius/work/claude/claude-plugins-effort-steering-adapter`, base `6a92fe2`, head `a2f1f6f`, 17 commits, NOT merged, NOT pushed). The final whole-branch review found one CRITICAL issue (ES-12: the S4 method could return a GO by chance alone, 22 to 40 percent under no true effect). The operator ruled "runner assigns balanced arms" and ONE fix wave plus ONE scoped Opus re-review followed. RESULT: fixed and independently re-derived (false-pass rate 0.0485 at alpha 0.05 over 224,000 fresh-seed no-effect trials); the re-review verdict is "ready to merge as the foundation for the gated steps". The branch head is `84807a2` (base `6a92fe2`; code head `a7ba5a2`; NOT merged, NOT pushed). The SDD ledger with all rulings R1 to R25 is `.superpowers/sdd/2026-10-05-effort-steering-adapter-and-experiment/progress.md` in the worktree (git-ignored: KEEP the worktree until the operator decides).

Original state at the first handover: the first phase is done and merged locally into `main` (`7475f6d`, fast-forward, full suite green: 65 suites). Nothing is pushed. Its work list is the tracker `effort-steering-second-phase` (id `af4ccc8b94a95c91`).

## Next actions

1. Read this doc, then **VERIFY** the working state below still holds: `git status` (expect clean), `git log --oneline -3` (expect `7475f6d` on `main`, plus the commit that added this tracker and passover, unless the ceremony session changed more), and `./tests/run-all.sh` (65 suites, all passing). The handoff may be stale.
2. Read the work list: `doc(action="get", id="af4ccc8b94a95c91")`. Start with the entries whose **Status** is `open`.
3. The operator decides how to land the branch `feat/effort-steering-adapter` (merge into `main`, PR, keep or discard). Then the gates: **G2** the operator chooses prompts, repeats, alpha, permutations, seed and the other numbers using the feasibility table in the plan's "As built" section; the G2 commit also adds the three feasibility checks to `loadPrereg` (ruling R25), replaces the null-template test, and sets `POLICY_TIMEOUT_MS` to the registered latency budget. **G3** the operator approves the model-call run after reading the G3 caveats in the plan's "As built" section (canary, endpoint, auth, transcripts left behind). ES-9 and ES-10 only if the S4 `stop` list is empty.
4. ES-6 (replay of session signals) is read-only and cheap. It can run at any time if the operator wants evidence early. ES-7 (recursive test glob) is a small prerequisite for ES-3.
5. Do not push or release unless the operator says so. ES-11 belongs to the "Push and deploy ceremony" session.

## Working state

- Branch and commit: `main` is `7475f6d` plus the commit that adds the tracker and this passover. Clean unless the ceremony session changed it. Local `main` is 19 commits ahead of `origin/main` before that commit (2 were there before the effort-steering work).
- Worktree: `/home/marius/work/claude/claude-plugins-effort-steering` on `feat/effort-steering-core`, clean at `7475f6d`. It holds a gitignored scratch workspace (`.superpowers/sdd/2026-10-04-effort-steering-core-and-spikes/`: the ledger, the task reports with RED and GREEN evidence, the review diffs). **KEEP** it until ES-11.
- Temp files: `/tmp/effort-steering-spikes/` holds aggregate reports from spikes S2 and S3. They hold no prompt text and are safe to delete.
- No process needs to run.

## Anti-goals

- Do not add `plugin.json`, a marketplace entry or a README row before the adapter works and the gate of ES-5 passes (ES-10). That would ship an empty plugin.
- Do not use `llm-proxy` or any infrastructure that other people do not have. This is the operator's constraint.
- Do not write a settings-file writer. `settings.local.json` is per project, so concurrent sessions would overwrite each other. The first actuation channel is steering text. Reopen the settings write only if spike S4 fails and the operator asks.
- Do not add rules to `core/rules.json` without evidence (ES-9). It ships empty on purpose.
- Do not change the exit code 64 for a usage error or the reason names casually. The adapter will rely on them.
- Do not run a model-call experiment (S4, S5) without asking the operator (ES-5).
- Do not re-open the first phase's review loop. It is closed.

## Open threads

- Ruling R3 (ES-1): settled 2026-10-05. A bad `--holdout-rate` is rate 1 (held out, not steered). Do not ask again.
- Five parked residual findings from the final re-review (three test-hygiene items, one note about filtering features by key, one wording nit). They are listed in the codescout review notes.
- The ceremony session owns the push decision and the cleanup of the branch and worktree (ES-11).

## Pointers

- Work list: tracker `effort-steering-second-phase` (`docs/trackers/effort-steering-second-phase.md`, id `af4ccc8b94a95c91`).
- Codescout repo (`/home/marius/work/claude/codescout`, branch `experiments`, unpushed):
  - Spec: `docs/superpowers/specs/2026-10-04-effort-steering-design.md`, section "Constraints carried into the second plan".
  - Review notes (commit map, triage, 22 rulings): `docs/research/2026-10-04-effort-steering-branch-review-notes.md`.
  - Spike findings: `docs/research/2026-10-04-effort-steering-spike-findings.md`.
  - First-phase plan: `docs/superpowers/plans/2026-10-04-effort-steering-core-and-spikes.md`.
- Code: `effort-steering/` in this repo (`core/`, `bin/effort-policy.mjs`, `spikes/`).
- Origin session transcript: `/home/marius/.claude-sdd/projects/-home-marius-work-claude-codescout/16bc6017-d129-44f7-91e5-43b0afad5ea9.jsonl`.
