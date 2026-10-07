---
id: ec8f1f91d436b653
kind: tracker
status: active
title: Passover — effort-steering (S4 evidence and the quality check) — 2026-10-07
tags:
- passover
topic: effort-steering
time_scope: dated:2026-10-07
branch: main
origin_session_id: 16bc6017-d129-44f7-91e5-43b0afad5ea9
---

# Passover — effort-steering (S4 evidence and the quality check) — 2026-10-07

## State

The harness-neutral core, the Claude Code hook adapter and the S4 experiment code are built and (mostly) on `origin/main`. S4 ran twice on 2026-10-07: the first registration (12 prompts at `medium`) was `mechanism_fail` because the model thinks 0 tokens at `medium`; the second (ES-19, 8 prompts at `xhigh`) is `mechanism_pass`: the steering sentence cut thinking 37 percent and output 27 percent (ES-21, reproduced independently from the raw transcripts). A separate line of work found that a Claude Code mod hooking `turn.step` can set the request's effort per request, with the rewrite on the wire and no cache miss in the tested setup (ES-17). What is MISSING is a quality check: nothing shows the shorter answers are as good. **G4 (accepting the S4 verdict) is HELD by the operator until one exists.** Two calibration rounds on exact-answer tasks (105 calls, $2.454) ended at the ceiling (33 of 35 solved 3 of 3 at `medium`), so the operator ruled: **do the quality check with real coding tasks with tests, and make them harder than first proposed (ES-22).** Nothing is designed, registered or run for that yet. The next session starts there.

## Next actions

1. Read this doc, then **VERIFY** the working state below before acting: in `/home/marius/work/claude/claude-plugins` run `git status --short` (expect clean apart from other sessions' edits), `git log origin/main..main --oneline` (expect about 21 local commits, see Working state), `git worktree list`, and `./tests/run-all.sh` (all suites passing; a peer saw 521 ok at `2682f46`). The handoff may be stale.
2. Read the work list: `doc(action="get", id="af4ccc8b94a95c91", workspace="/home/marius/work/claude/claude-plugins")`. Start with its section "Resume — state at 2026-10-07", then ES-22, ES-23, ES-21, ES-20, ES-17, ES-18.
3. Start ES-22 with the `superpowers:brainstorming` skill (architectural path: a new experiment). Ask the operator what "harder" means to them before proposing tasks. Specs and plans for this work now live in the claude-plugins repo (`docs/superpowers/specs/`, `docs/superpowers/plans/`; the adapter-and-experiment plan is there). Then the spec, the plan (`superpowers:writing-plans`), and subagent-driven development with Sonnet as the floor and an Opus mutation-lens review of load-bearing code (the operator's standing rule).
4. Do NOT run model calls without telling the operator the number of calls, the model and an honest cost (measure two or three pilot runs before extrapolating). A registration is committed before the first measured call.
5. Leave G4 held. The push of the local commits and the removal of the merged worktree and branch are the operator's decision (ES-11). ES-23 (Claude Code actuation design) and ES-10 (packaging) wait for G4 and ES-22.
6. A peer session may still be alive: `llm-proxy-3a` at `uds:/run/user/1000/cc-socks/2835935.sock` (it made and ran the second registration and owns observability work). Check with `/codescout-companion:reaching-peer-sessions` before messaging; tell it about anything that touches a registration.

## Working state

- Repo `/home/marius/work/claude/claude-plugins`, branch `main`. `origin/main` was at `bcb1d3a` when checked (it holds the first phase, the adapter merge `586367e`, the G2 registration `5077dc4`, the S4 runner `b9f9043`). About 21 local commits are ahead: ES-17 to ES-23 tracker commits, the second registration `c018c8b`, the effort guard `2682f46`, `effort-steering/spikes/probes/` (`8e4370f`), `effort-steering/spikes/dose/`, this passover, and one unrelated commit `4d0a691` from another session. Nothing is pushed by this session.
- Worktree `/home/marius/work/claude/claude-plugins-effort-steering-g2` on branch `feat/effort-steering-g2` (merged into `main` as `5077dc4`, clean). Safe to remove on the operator's word: `git worktree remove` it, then `git branch -d feat/effort-steering-g2`.
- Committed, throwaway instruments (delete with `effort-steering/spikes/` before any `plugin.json` lands, ES-10): `spikes/probes/` (four mods kept as flat files, a localhost wire recorder, run scripts, analyzers, README) and `spikes/dose/` (`run-calibration.py`, `make-tasks.py`, `make-tasks2.py`, the two candidate task files, `grade-s4-existing.py`). Set `PROBE_DIR` (a scratch directory outside any repo) before running any probe script.
- NOT durable: this session's scratchpad `/tmp/claude-1000/-home-marius-work-claude-codescout/16bc6017-d129-44f7-91e5-43b0afad5ea9/scratchpad/` (probe runs, `rows.jsonl`, wire logs, power-simulation scripts). Every number from it is recorded in ES-17, ES-18, ES-20 or ES-21. Safe to delete. Transcripts of the probe, calibration and S4 runs sit in `~/.claude-sdd/projects/-tmp-*` and `~/.claude-kat/projects/-tmp-s4-run-XmzuHv-work`; they hold no secrets and can be removed with the profile's session cleanup.
- No process needs to run. The mod `effort-observer` is loaded only in the origin session (its dev-mods folder is session-scoped); it dies with that session.

## Local deployment (2026-10-05, operator-approved; STILL LIVE as far as known, verify first)

A logging-only `UserPromptSubmit` hook is wired into `~/.claude` and `~/.claude-sdd` (not `~/.claude-kat`): `hooks.UserPromptSubmit = [{hooks:[{type:"command", command:"node /home/marius/work/claude/claude-plugins/effort-steering/adapter/claude-code/user-prompt-submit.mjs", timeout:5}]}]`. The shipped `core/rules.json` is empty, so it never steers: it writes one decision record per prompt (a prompt hash and numeric features, no prompt text) to `~/.local/state/effort-steering/<session_id>.jsonl`, about 0.16 s per prompt, and always exits 0. These logs are not holdout data (no holdout rate is set) and are NOT read by S4. The hook fires for harness-injected messages too (task notifications, peer and agent messages; ES-13), so the log mixes human prompts and machine messages. It points at the working tree of `main`: a later change to those files is live at once; moving the repo makes it exit 1 (visible, non-blocking). **To undo:** `jq 'del(.hooks.UserPromptSubmit)' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json`; for `~/.claude-sdd`: `jq 'del(.hooks.UserPromptSubmit)' ~/.claude-sdd/settings.json > /tmp/s.json && cat /tmp/s.json > ~/.claude-sdd/settings.json`; logs: remove `~/.local/state/effort-steering`.

## Anti-goals

- Do not accept G4 without quality evidence, and do not release or add rules (ES-9) before it.
- Do not repeat the exact-answer route: both calibration rounds are at the ceiling for Sonnet 5.5 at `medium`; calibrate any new task set at `xhigh`, where the model actually thinks.
- Do not use the wire recorder in a measured run: through it the model thought at `medium` where it did not when sent direct (ES-17 probe 4), and cache numbers doubled. Direct path only; the recorder is for wire checks.
- Do not run `claude -p` with `--tools ""` on computation-heavy tasks: the model writes raw tool-call text and loops (a 128,000-token, $1.29 run). Do not trust a cost cap; it is checked after the fact.
- Do not read a message's usage from the last transcript record only (it hides the thinking block); do not run `claude -p` in a `while read` loop without `< /dev/null`; do not take a ground-truth number from memory.
- Do not use `llm-proxy` or any infrastructure other people lack inside the product (operator constraint); it is fine for observing probes only.
- Do not write a settings-file writer (`settings.local.json` is per project and shared by concurrent sessions). Do not add `plugin.json`, a marketplace entry or a README row before ES-10 is unblocked.
- Never push, release, or run a model-call experiment without the operator saying so. Shared-checkout rules: stage explicit paths, commit by pathspec with `git commit -F <file>`, never `git add .`.

## Open threads

- G4 (held), ES-22 design and spend approvals, ES-11 (push, worktree and branch removal), ES-9 (no rules without evidence), ES-10 (blocked by G4 and ES-23).
- Built but not wired into S4 results: the effort guard (`2682f46`). Ruled but not built: the content-shape guard for injected messages (ES-14 D-2); the per-turn arm unit (ES-13) is a rule for the packaged adapter.
- Untested and recorded as such: the thinking-block drop at a turn boundary after a tool-loop turn, a long real session, Opus 5.5 and Fable 5.1, subagent steps, the `deep` sentence, the live merge check of several hooks' `additionalContext` (ES-4), quality of the effort lever (ES-17).
- Five parked residual findings of the first phase and the codescout review notes are unchanged (codescout repo).

## Pointers

- Work list: `docs/trackers/effort-steering-second-phase.md` in the claude-plugins repo, id `af4ccc8b94a95c91` (ES-1 to ES-23). Research: `docs/trackers/effort-steering-research-2026-10-06.md` (id `8ad5f00472dc1e42`) and `docs/trackers/claude-mods-research-2026-10-06.md`. The previous passover `b2838d56206e8d62` is superseded.
- Plans: claude-plugins `docs/superpowers/plans/2026-10-05-effort-steering-adapter-and-experiment.md` ("As built" first). First-phase design, plan, spike findings and review notes are in the codescout repo (`/home/marius/work/claude/codescout`, branch `experiments`, `docs/superpowers/` and `docs/research/`; its status note points here).
- Durable memory: codescout memory topic `research/effort-steering` (verified findings and instrument rules in short form).
- Code: `effort-steering/` (`core/`, `bin/effort-policy.mjs`, `adapter/claude-code/`, `spikes/`).
- Origin session transcript: `/home/marius/.claude-sdd/projects/-home-marius-work-claude-codescout/16bc6017-d129-44f7-91e5-43b0afad5ea9.jsonl` (large; the trackers hold the results).
