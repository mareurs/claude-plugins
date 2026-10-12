---
id: '4ab6a0801b75e480'
kind: spec
status: draft
title: Effort steering — quality test on real coding tasks (S5-lite) — design
tags:
- effort-steering
- s5
- quality-test
- design
topic: effort-steering quality test
---

## Purpose

The steering sentence "Answer directly without deliberating." cuts thinking by 37 percent and output by 27 percent on Sonnet 5.5 at `xhigh` (S4, ES-21). Nothing shows that the shorter answers are as good. G4 is held for this (ES-5, ES-21, ES-22). Exact-answer tasks cannot show a quality difference: Sonnet 5.5 solved 33 of 35 even at `medium` (ES-20).

This test measures quality on hard, real coding tasks with hidden tests. It runs in two stages (operator ruling 2026-10-07, "Both, staged"):

- **Stage 1** answers G4: on hard tasks, does `xhigh` with the steer lose less than 15 points of pass rate against plain `xhigh`, and how much does it save?
- **Stage 2** (outline only, own registration later) reuses the tasks and the box for the effort levels. It answers the question the vendor documentation raises: is `xhigh` with the steer better than plain `high` at the same token cost? Stage 2 runs only if stage 1's validity gate held.

Work list: tracker `effort-steering-second-phase` (id `af4ccc8b94a95c91`), entries ES-22 (this test) and ES-23 (actuation design).

## Operator decisions (2026-10-07)

| Question | Decision |
|---|---|
| Purpose | Both, staged: stage 1 for G4, stage 2 for the effort levels |
| Kinds of hardness | Cause far from symptom; keep behaviour and read the spec; long horizon. Not chosen: single-function "subtle semantics" traps |
| Task source | Real fix commits from the operator's own repos (codescout, claude-plugins) made after 2026-07-15 (amended 2026-10-12; the first window was 2026-09-28) |
| Model | Sonnet 5.5 (`claude-sonnet-5-5`), stage 1 at `xhigh` |
| Margin | 15 points of pass rate (one-sided, 95 percent, 80 percent planned power) |
| Run box | Own Docker run box (not host runs, not Harbor) |
| Credential | A long-lived subscription token from `claude setup-token`; the pilot measures plan usage first |
| Design sections 1 to 5 | Approved in conversation |

## What the research found

Three research agents (Sonnet, `researcher` MCP) covered task sources, effort against quality, and method. Items marked **verified** were read at the primary source in this session. All other items are as the agents reported them, with their source; treat them as leads, not as measurements.

### Vendor documentation (verified on platform.claude.com, 2026-10-07)

- The "Steering thinking" page names our exact sentence: appending "Answer directly without deliberating." suppresses thinking; "Please think hard before responding." encourages it.
- The same page warns: "Steering Claude to think less often may reduce quality on tasks that benefit from reasoning. Lowering the effort level is usually the better first lever, since it is a calibrated control rather than a wording-sensitive instruction." It gives no quality number.
- In a tool loop, "the first request after new user input typically carries most of the reasoning", and follow-ups that only process tool results can skip thinking even at `xhigh` and `max`.
- Effort "is a behavioral signal, not a strict token budget". It affects all output tokens, including tool calls.
- Sonnet 5.5 guidance: start agentic coding at `medium` for well-specified tasks and `high` for harder or longer ones; use `xhigh` or `max` "only where your evals show a quality gain". At `low` the model "can skip verifying a change"; at `low` and `medium`, on long agentic tasks, it is "more likely to stop and check in" before it finishes. At `xhigh` and `max` it can start its own review rounds, sometimes with subagents.
- Changing the top-level effort between requests invalidates the cache; a per-message effort change (beta `mid-conversation-output-config-2026-07-01`) keeps it.

### Where effort changes quality (agent-reported; mostly other models)

- Long-horizon terminal tasks show the largest gaps: Opus 5.5 on Terminal-Bench 4.0, 38.5 at `low` to 64.2 at `high` (secondary source, StationX); TUA-Bench (arXiv 2606.28480, 120 tasks): GPT-5.5 under Codex 46.7 at low to 64.2 at high, high to xhigh only +0.5.
- Multi-file systems tasks: 9 to 13 points from low to high (arXiv 2609.26777, SWE-Serve). Well-specified single fixes: small. Function-level code: about 1 point (SonarSource).
- Above `high`, gains flatten or reverse; timeouts and out-of-scope edits rise.
- **Unresolved contradiction:** blog readings of Anthropic's Sonnet 5.5 launch charts give Terminal-Bench 4.0 at 43.0 for `high` and 61.5 for `xhigh` (+18.5), while other suites show 0 to 2 points between `high` and `xhigh`. If `xhigh` equals `high` on our tasks, the steer cannot visibly hurt quality; the validity gate and the stage 2 comparison exist for this reason.
- The closest published design (arXiv 2608.01347, Claude Code with hidden tests): a "bounded efficiency" prompt kept success but made the agent skip the requirements file on an ambiguous spec, 3 of 5 hidden-test failures against 0 of 5 at baseline. This is the failure the steer most plausibly causes.
- Anthropic's April 2026 postmortem: a Claude Code default change from `high` to `medium` and a brevity rule both passed internal evals at first; wider evaluation later found losses. A first eval set can miss the cost of terseness.

### Task sources (agent-reported)

- SWE-bench Verified is saturated (95 to 97 percent, vals.ai stopped running it) and reported as contaminated. SWE-bench Pro V2 is close to the ceiling for Claude.
- Still discriminating: Terminal-Bench 3.0 and 4.0, fresh SWE-rebench windows, DeepSWE. All run through Harbor and Docker.
- Simple injected bugs are about as hard as Verified; bugs that appear while an agent adds a feature were about 25 points harder (BugPilot, arXiv 2510.19898, Sonnet 4).
- Hidden behaviour tests catch runs that diagnose the bug and then rewrite code wholesale (latitude.so, one case). Weak tests inflate scores by about 6 points or more (UTBoost, PatchDiff); for a non-inferiority claim, weak tests are anti-conservative.
- One agent found the fixing commit online in an open-network run (Scale, SWE-bench Pro V2): disable web access.

### Method (agent-reported; the sizing arithmetic re-derived in this session)

- Run-to-run spread is real: per-task outcomes are unstable (70 percent of issues solved at least once in 5 runs, 40 percent in all 5); infrastructure alone moved Terminal-Bench scores by up to 6 points (anthropic.com/engineering/infrastructure-noise).
- Unit of analysis is the task; pair by task; never pool runs as independent (Miller, anthropic.com/research/statistical-approach-to-model-evals).
- Non-inferiority needs a margin fixed before the data; "no significant difference" is not equivalence (arXiv 2608.15046).
- Sizing: N ≈ 6.18 · var(d) / m², with var(d) ≈ 2 · E[p(1−p)] / r for a paired difference of two per-task means over r runs. With r = 3 and E[p(1−p)] from 0.15 to 0.20: m = 0.15 needs 27 to 37 tasks. At N = 32 the planned power is about 75 to 85 percent.
- Calibrate difficulty on runs that the measurement does not reuse; filtering on the same baseline runs makes the cheaper arm look fine (arXiv 2603.23749 and the agent's own simulation).
- Report cost per resolved task with failures counted, and the full token breakdown; count timeouts as failures; re-run and log infrastructure failures separately.

## Stage 1: arms and decision rule

**Arms.** All arms run Sonnet 5.5 on the same tasks, in the same image, with `claude -p --effort <level>`.

| Arm | Setting | Runs per task | Role |
|---|---|---|---|
| A | `xhigh`, no steer | 3 | baseline |
| B | `xhigh` plus the S4 hook ("Answer directly without deliberating.") | 3 | treatment |
| C | `low`, no steer | 2 | positive control: proves the tasks can show a loss |

**Pass for one run.** The build succeeds and every hidden test passes:

- fail-to-pass: the fix commit's tests, which fail on the parent commit P and pass on the fix commit C;
- pass-to-pass: the existing tests of the touched modules, plus extra hidden tests that check preserved behaviour.

A wall-clock timeout counts as a failure. An infrastructure failure (container error, API error storm, out-of-memory kill, effort-guard mismatch) is re-run, at most twice, and logged. A task with an infrastructure failure that persists is dropped from all arms, never from one.

**Decision rule** (registered and committed before the first measured call):

1. Per task, the score of an arm is its mean pass over its runs. Δ is the mean over tasks of (B − A).
2. A task-level paired bootstrap gives a one-sided 95 percent lower bound for Δ (registered resample count and seed).
3. **Validity gate:** the same bootstrap on (A − C) must give a lower bound above 0. If it does not, the verdict is "uninformative: the tasks cannot detect a loss". It is never "pass". At N = 32 the gate detects a drop of about 17 points or more with 80 percent power.
4. If the gate holds: the steer is **non-inferior** if and only if the lower bound of Δ is above −0.15. Otherwise it is **not shown safe**.

| Result | Meaning for G4 |
|---|---|
| Non-inferior | G4 can pass; the operator rules |
| Not shown safe | The steer stays off at `xhigh` |
| Uninformative | The tasks are redesigned; G4 stays held |

**The margin's scope.** The calibration keeps only tasks where effort is not idle (see "Calibration"). So the 15-point margin applies to such tasks, not to all coding work. The report states this.

**Run order.** Within each task, the order of the arms' runs is randomized from a registered seed, to spread API drift and time-of-day effects across arms.

## Tasks

### Mining (structural rules only, no model outcomes)

- Non-merge commits whose subject starts with `fix`, dated after 2026-09-28, that change both test code and non-test source. Sonnet 5.5's training data cutoff is June 2026 (models overview page, verified 2026-10-07), so these commits cannot be in its training data. (2026-09-28 is the release date a research agent reported; the page states none.)
  **Amended 2026-10-12 (operator decision): the window starts 2026-07-15.** The June 2026 cutoff is what keeps a commit out of the training data; 2026-09-28 was an unverified release date, and it left 59 candidates after the rules below, too few for 32 tasks after calibration (measured: 179 `fix` commits since 2026-09-28, 1,211 since 2026-08-01, 1,352 since 2026-06-28). The list mined for the wider window is `effort-steering/spikes/s5/tasks/candidates-0715.json` (196 candidates). `candidates.json` stays as the list the pilot tasks came from. The wider list is not a superset of it: the per-subsystem cap keeps the earliest four, so earlier commits displace later ones.
- Duplicates removed by patch-id (example: `4d49908a` and `2a1215c8` carry the same fix on two branches).
- At least 2 non-test files changed, or at least 40 changed non-test lines (the hard-slice criterion of arXiv 2608.01347).
- At most 4 tasks per subsystem. The subsystem is the conventional-commit scope in the subject (for example `read_file`, `run_command`, `librarian`); a subject without a scope uses the parent directory of its most-changed non-test file.
- Commits under `effort-steering/` are excluded: a task about the steering code could make the agent aware of the steer.
- codescout is the main source (143 fix commits and 464 commits in all since 2026-09-28, measured 2026-10-07). claude-plugins adds a few JS and bash tasks (16 fix commits, most of them in `effort-steering/`).

### Building a task from fix commit C with parent P

- **Working copy:** `git archive P`, then a fresh `git init` with one commit. The agent can use `git diff`; no history reaches C.
- **Leak scrub:** remove the bug's issue file; scan the tree for the issue slug and for identifiers that C introduces; remove trackers or memories that describe the fix.
- **Instructions:** the repo's `CLAUDE.md` files and `.claude/` directories are replaced by one short task `CLAUDE.md` that says how to build and run the tests. (codescout's own file points to MCP tools and `scripts/gate.sh` that the box does not have.)
- **Prompt:** a short paragraph that describes the symptom and says that the requirements are in `TASK.md`. `TASK.md` holds the expected behaviour and the constraints, written from the issue file's observed and expected parts, never its root cause or its fix. This tests whether the agent reads the spec.
- **Hidden tests:** fail-to-pass from C's test changes (codescout keeps most tests in separate files inside `src/`, for example `read_file_one_handle_tests.rs`); pass-to-pass from the existing tests of the touched modules, scoped so that grading takes minutes, not the whole suite.

### Gates for each built task (scripts, before any model call)

1. The hidden tests compile against P and fail by assertion on P, not by a missing symbol.
2. The hidden tests pass on C, three times in a row (flaky filter).
3. The fail-to-pass tests name only symbols that exist at P or that `TASK.md` names. A correct fix with a different internal design must not fail on a name.
4. An Opus review checks each task for leaks and for unfair tests.

### Calibration (separate runs, never reused for measurement)

About 50 candidate tasks, A run twice and C run once on each. The drop rule is fixed now:

- drop a task that A solves 0 of 2 times (no room to lose);
- drop a task that A solves 2 of 2 and C solves 1 of 1 (effort is idle; it would dilute the margin);
- keep the rest. The target is 32 tasks. If fewer survive, the operator chooses: curate more tasks or accept a wider margin.

## Run box

- **Images:** one per repo. Debian, the pinned toolchain (Rust or Node, plus Python), and the host's exact Claude Code binary (`~/.local/share/claude/versions/2.1.292`). Dependencies are fetched into the image (cargo offline mode), so builds need no network. The agent runs as a non-root user.
- **One container per run:** a fresh copy of the task tree on `/home` (not `/tmp`: it is a 24 GB tmpfs, 87 percent full on 2026-10-07), with a pre-built `target/` from P so the first Rust build is incremental. Equal CPU and memory limits for all arms with about 3× headroom; a fixed number of parallel containers.
- **Network:** no direct internet route. One allowlisting CONNECT proxy passes only the hosts Claude Code needs (the pilot finds the list). WebFetch and WebSearch are disallowed. The copy has no git remote and no GitHub credentials. Both repos are public (HTTP 200 without a login, 2026-10-07), and some fix commits are on `origin/experiments`, so an open network could leak the fix.
- **Proxy control:** the memory rule "measured runs go DIRECT" came from a wire recorder that changed `ANTHROPIC_BASE_URL`. A CONNECT proxy changes no URL and sees no plaintext, but it is still a change to the instrument. One prompt runs direct and through the proxy; thinking and output must agree within run-to-run spread before the proxy is used. Fallback: an open network plus a transcript scan for any fetch from GitHub; a run that fetched the repo is a protocol deviation.
- **Invocation** (the S4 arguments plus what tool loops need):

```
claude -p --model claude-sonnet-5-5 --effort <arm> --session-id <uuid>
  --setting-sources local --settings <run settings> --strict-mcp-config
  --thinking-display summarized --dangerously-skip-permissions
  --disallowedTools WebFetch WebSearch --output-format json -- "<prompt>"
```

- stdin from `/dev/null`. Both steer arms run the same hook copy, as in S4; `EFFORT_STEERING_HOLDOUT_RATE` (`'0'` treated, `'1'` holdout) selects the arm. `CLAUDE_CONFIG_DIR` is a per-run directory mounted from the host, so transcripts land on disk. The credential is the `setup-token` token, passed as an environment variable.
- **Limits:** 2.1.292 has no max-turns flag, and `--max-budget-usd` is checked after the fact (ES-20: $1.29 against a $1 cap). A wall-clock kill at T minutes bounds each run; the pilot sets T at about 3× the median A run, with a cap.
- **Grading:** in a fresh container with no network: copy the agent's final tree, record its diff against P, graft in the hidden tests, run the fail-to-pass and pass-to-pass commands under a timeout. Model-written code never runs on the host.
- **Records:** one row per run, in the `spikes/dose/run-calibration.py` style with resume: usage over all transcripts including subagent transcripts, deduplicated by `message.id`, thinking counted over all records of a message; cost estimate; wall time; tool steps; whether the agent ran tests before reporting done; effort-guard result; infrastructure and timeout flags; per-test grades; diff stats.
- **Before any batch:** one smoke run per arm; the hook fired in B and logged without steering in A; every first user message is one line; the proxy control.

## Pilot, calibration, registration, measured run

Each step that calls the model is a separate operator gate with a stated run count and the cost measured so far.

1. **Pilot** (about 12 runs): 3 tasks × arms A, B, C × 1 run, plus the proxy control. It measures plan usage and the client cost estimate per run, run time (sets T), grading time, and whether the box, the arms and the effort guard work end to end.
2. **Calibration** (about 150 runs): see "Calibration".
3. **Registration:** a prereg file committed before the first measured call, loaded with the S4 pattern (bytes equal the HEAD blob, feasibility checks). It names the model, effort and runs per arm, each task id with hashes of its tree and its hidden tests, margin 0.15, one-sided alpha 0.05, bootstrap resamples and seed, the arm-order seed, T, resource limits, concurrency, CLI version, image digests, proxy allowlist, and the infrastructure re-run limit.
4. **Measured run** (about 256 runs): 32 tasks; A 3, B 3, C 2. Done once.

**Stop rule:** if plan usage reaches a limit the operator sets, the runner stops; the rows file allows a resume.

**Cost estimate (not our measurement):** published runs on hard tasks cost about $2 to $5 per run at `xhigh` and about $0.8 at `low`. On the subscription, this is plan usage, not a bill. The pilot measures our own figure before calibration is approved.

## Analysis

- **Primary:** per-task mean pass by arm; task-level paired bootstrap of mean (B − A); one-sided 95 percent lower bound; verdict as in "Decision rule". An exact sign test on the per-task differences is reported as a robustness check.
- **Validity gate:** the same bootstrap on (A − C).
- **Mechanism check:** does the steer still cut thinking in tool loops? S4 measured only one-shot prompts. B against A on main-session thinking and output tokens, with the S4 within-task permutation test and paired log-ratios with confidence intervals; totals including subagents are reported beside them. If the steer cuts nothing in tool loops, the report says so, because "harmless" then means nothing.
- **Secondary (registered, not gating):** cost per resolved task with failures counted; pass^3 per arm; failure modes (no test run before "done", an early stop or check-in, timeouts); regressions in existing tests; diff size as a sign of out-of-scope edits; wall time; the discordant tasks by name.
- **Simulation check before any model call:** the analysis code must pass planted-truth tests. At a true Δ of −0.15 it claims non-inferiority in at most about 5 percent of trials; at a true Δ of 0 it claims it at about the planned power; with the gate's true difference at 0 the gate passes in at most about 5 percent of trials. (This kind of check caught the S4 method passing by chance, ES-12.)

## Components and files

- **Code:** `effort-steering/spikes/s5/` in claude-plugins. Throwaway spike code like S4; deleted before any `plugin.json` (ES-10 anti-goal). Node `.mjs` with `*.test.mjs`, so `tests/run-all.sh` finds the suites (ES-7). Reuses `s4-prng`, the `s4-prereg` loader pattern and the S4 transcript reading.
- **Committed:** task definitions only (commit ids, `TASK.md`, the prompt, the hidden-test lists, the scrub rules).
- **Generated, not committed:** built trees, `target/` snapshots, images and run directories, in a work directory on `/home`.

| Unit | Job | Tested by |
|---|---|---|
| `mine` | list candidate fix commits by the mining rules (patch-id dedupe, size, subsystem cap, `effort-steering/` excluded) | a fixture git repo |
| `build-task` | tree at P via `git archive`, scrub, task `CLAUDE.md`, hidden-test extraction, manifest with hashes | a fixture repo with a planted fix |
| `gate-task` | two-sided gate, 3× flaky check, "symbols exist at P" check | fixture tasks that must pass or fail each gate |
| images and proxy | Dockerfiles per repo; an allowlisting CONNECT proxy | a smoke build; an allowlist refusal test |
| `run` | arms, order seed, container launch, wall-clock kill, rows, resume, stop at a usage limit | a fake `claude` binary in the container |
| `usage` | tokens over all transcripts including subagents, by `message.id`; effort guard | recorded transcript fixtures |
| `grade` | fresh container with no network, graft, per-test results | fixture trees: right fix, wrong fix, no fix |
| `prereg` and `analyze` | loader with feasibility checks; bootstrap non-inferiority, gate, mechanism check, secondaries | unit tests and the planted-truth simulation |

## Process and gates

1. The operator reviews this spec; then the implementation plan (writing-plans).
2. The operator chooses the execution method. With subagent-driven development, Sonnet is the floor; `run`, `usage`, `grade`, `prereg` and `analyze` are load-bearing and get Opus reviews with a mutation-testing lens.
3. Pilot gate (about 12 runs).
4. Task authoring: a Sonnet subagent drafts each `TASK.md`; an Opus review checks each task for leaks and unfair tests.
5. Calibration gate (about 150 runs).
6. Registration gate (the prereg commit).
7. Measured-run gate (about 256 runs).
8. The result goes into ES-22; the operator rules on G4.

Nothing is pushed without the operator. Every Claude Code configuration change goes to all three profiles (OP-4); this design needs none, because the runs use per-run config directories.

## Risks

- **The proxy changes behaviour.** The proxy control tests it; fallback is an open network with a transcript scan.
- **Fewer than 32 tasks survive calibration.** The operator chooses more curation or a wider margin.
- **The steer cuts nothing in tool loops.** The mechanism check reports it.
- **Rust build time and disk per run.** Unmeasured; the pilot measures them.
- **Plan quota.** Hundreds of long `xhigh` runs consume plan usage and could block daily sessions; the pilot measures it and the stop rule enforces a limit.
- **Hidden tests that pin the reference design.** Gate 3 and the Opus review reduce it; what remains lowers both arms alike.
- **Realism.** The replaced `CLAUDE.md` and the missing MCP tools make the box less like the operator's sessions. This is a deliberate trade for control.

## Facts verified in this session (2026-10-07)

- Docker 29.8.2 server running; 64 cores; 125 GB RAM; `/tmp` tmpfs 24 GB with 3.2 GB free; `/home` 204 GB free.
- Claude Code 2.1.292 at `~/.local/share/claude/versions/2.1.292`; `--help` lists no max-turns flag; `setup-token` exists ("requires Claude subscription"); `--restricted` removes Bash unless `--tools` names it and confines only the file tools.
- `https://github.com/mareurs/codescout` and `https://github.com/mareurs/claude-plugins` answer HTTP 200 without a login; commit `40349c9d` is on `origin/experiments`, `91c7f705` is not on any remote branch.
- Profile settings: `~/.claude` model `sonnet`, effort `medium`; `~/.claude-sdd` model default (Opus 5.5 since 2026-10-07), effort `xhigh`; `~/.claude-kat` model `sonnet`, effort `xhigh`.
- Sonnet 5.5 (models overview page): training data cutoff June 2026; $2 per million input tokens and $10 per million output tokens; API default effort `high`.
- No `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is set in the environment; each profile has a `.credentials.json` (mode 600).

## Open items for the plan and the pilot

- The proxy allowlist (which hosts Claude Code 2.1.292 contacts with a `setup-token` token).
- That the native binary runs in the Debian image and that the token works with `--setting-sources local`.
- Where Claude Code 2.1.292 writes subagent transcripts, so `usage` reads them.
- How plan usage per run is measured.
- T, the resource limits, the concurrency and the bootstrap resample count.
- The pass-to-pass scope for each task (which module tests, and their run time).

## Stage 2 (outline)

Same tasks and box. Adds `high` and `medium` arms, and possibly the `deep` sentence. The main comparison is `xhigh` with the steer against plain `high` at matched tokens, which feeds ES-23 (hook text steer, effort mod, or both). It has its own registration, decided after stage 1.
