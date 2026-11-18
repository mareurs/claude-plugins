---
kind: spec
status: draft
title: 'Effort steering — an effort toggle the agent controls (delivery check and steering test) — design'
tags:
- effort-steering
- effort-toggle
- s5
- design
topic: effort toggle self-steering
---

## Purpose

The operator wants to know whether an agent can steer its own reasoning effort while it works, by any means and not only
through the prompt. The agent starts at `low` and has a tool that it calls to raise effort when a step needs more (the
operator's guidance: reviewing and verifying need higher effort) and to lower it again when it judges that `low` is enough.
The agent makes these choices. A Claude Code mod provides the tool and applies the chosen level to the requests that follow.

This replaces the question R1 asked (a static rule picks the effort from the prompt; operator ruling 2026-10-17: no-ship) with
a dynamic one: the model picks the effort, step by step.

**Success, in the operator's words (confirmed 2026-10-17):** the toggle arm passes about as often as fixed `xhigh`, costs
closer to fixed `low`, and beats a placebo toggle. The numeric form of this rule is in "Step 1" and is fixed in a registration
before any measured call.

## What is already known (each fact verified 2026-10-17; sources named)

- **A mod can provide the tool.** `$.tool.register({ name, description, inputSchema })` declares a tool that the model calls as
  `mcp__<plugin>__<name>`; a `tool.call` hook on that name answers it; a tool registered in `session.start` is listed from
  turn one (`claude-code.d.ts` of CLI 2.1.289, `tool.register` and `session.start` docs).
- **A mod can set the effort of each request.** `turn.step` fires once per model request; `next({ ...e, effort })` changes the
  request's effort, up or down, mid-turn; the transcript's `effort` field of the request equals the rewrite; no cache miss
  was measured, also with a thinking block in the history (tracker ES-17, probes 1 to 3, CLI 2.1.292). The `effort-stepper`
  probe mod ran headless with `--plugin-dir` on CLI 2.1.296 in Stage 0 (codescout research index, "Stage 0 result").
- **No behaviour change after a mid-turn switch has been shown.** In ES-17 probe 3, a switch at request 2 changed no measured
  behaviour (thinking followed the puzzle in every arm). Anthropic's "Effort" page says: "A `user` turn that holds only
  `tool_result` blocks doesn't count as new input, so a change placed after one in a tool-use loop waits for the next `user`
  turn with new input." A toggle call is answered by exactly such a turn. **So the toggle may be inert inside a turn.** Step 0
  exists to settle this before anything else is spent.
- **Where `low` loses on code.** R1 V2 (12 tasks, Sonnet 5.5, CLI 2.1.296): `low` passed 19 of 24 and `xhigh` 22 of 24; the gap
  is `cs-p20` (`low` 0 of 2, `xhigh` 2 of 2; 0 of 10 and 5 of 5 over all batches) and `cs-p12` (1 of 2, not reproduced in a
  rerun). `cs-p18` fails in both arms and carries no information. Cost per run: `low` $0.157, `xhigh` $0.599 (R1 spec,
  "Result"); on `cs-p20`: `low` $0.182, `xhigh` $0.478 (gate test references).
- **What separates the levels on `cs-p20` is the breadth of the final check, not run length.** Requests per run: `low` 13 and
  18, `xhigh` 19 and 18 (V2 transcripts). Both `xhigh` runs ran the whole suite (`cargo test` with no `--lib` and no name
  filter, `--no-fail-fast`, `clippy --all-targets`); both `low` runs ran only `--lib` with name filters (V2 transcripts; the
  research index reports the same for 8 of 8 `low` runs over the V2 and rerun batches). The `low` agents wrote their fix at
  requests 7 to 9.
- **Advice alone did not help at `low`.** Anthropic's verification paragraph at `low` on `cs-p20`: 0 of 5 (research index). This is
  why the placebo arm below is the key control.
- **R1 agents used no subagents** (0 sidechain records in the 48 V2 transcripts; tools used: Bash, Read, Edit, Write).

## Decisions

Operator decisions (2026-10-17):
1. The agent starts at `low` and controls its effort with a tool. It decides when to raise effort and when `low` is enough again.
2. The tool's description says that reviewing and verifying need higher effort (the operator knows this works empirically). It
   does not prescribe fixed switch points.
3. Effort only. No model switching.
4. Code tasks only (the 12 R1 tasks). No plan-writing items.
5. The success rule in "Purpose".
6. The delivery check (step 0) runs first; the steering test (step 1) runs only if step 0 shows delivery.
7. For the experiment the tool lives in a Claude Code mod. A codescout tool is a later, portable surface, only if this works.

My calls (the operator may change any of them; marked so the review can find them):
- **C1. Two levels, `low` and `xhigh`.** They match the fixed arms, and they make the random arm's matching well defined. The
  tool offers no `medium` or `high`.
- **C2. The level applies from the next request after the tool call, to every request of the session** (main loop and any
  subagent). R1 agents used no subagents; the log records `agentId` so a change would show.
- **C3. `cs-p20` gets 5 runs per arm in step 1; the other 11 tasks get 2.** The quality half of the success rule rests on
  `cs-p20`, the only task where `low` reliably fails; the 11 others measure cost and harm.
- **C4. The random arm carries the same tool and text as the toggle arm.** The agent's calls do nothing in it; the effort follows
  a random schedule. So toggle against random compares the agent's timing with random timing under identical text, and
  placebo against random shows what random effort changes alone do.
- **C5. Step 0 switches at request index 5** (before the earliest observed fix at 7). The registration re-derives this from all
  available `cs-p20` transcripts before step 0 runs.
- **C6. The harness, prompt, task trees and grader are R1 V2's, unchanged.** The only additions are the mod and the flag that
  loads it. The R1 build-hint sentence stays (it anchors `--no-default-features`; symmetric across arms, disclosed in R1).
  If the smoke run shows that the tool is not listed under the R1 V2 command (for example because of `--strict-mcp-config`),
  the needed flag change applies to EVERY arm, and the fixed arms then run fresh (no reuse of R1 V2 rows).
- **C7. "Request index" counts the main loop's requests across the whole session**, not `turn.step`'s `index`, which restarts
  at 0 on each turn (`claude-code.d.ts`, `TurnStepInput.index`). A run can get a second user turn (the S5 hook fired again on a
  queued task-notification in cs-p07.B.0, `run.mjs` row-guard comment (6b)). Such a run is flagged in its row. In step 0 it is
  excluded from the decision, because a new user turn is exactly where Anthropic's page says a change takes effect; it is
  replaced, at most twice per arm. Whether a run gets a second turn does not depend on its outcome.
- **C8. Step 0 has one registered extension.** If the positive control passes and an arm is inconclusive (2 of 4), that arm
  gets 4 more runs, and the pooled 8 decide: at least 6 → the 3-of-4 verdict, at most 2 → the 1-of-4 verdict, else
  **inconclusive**, stop and report. A failed positive control stops step 0 with no rerun.
- **C9. Smoke runs and the step 1 pilot are not measured calls** and do not count toward any arm. Step 0 and step 1 each
  have their own registration, committed before their first measured call; the step 1 registration comes after the pilot.
  If no pilot run calls the tool at all, I stop and report to the operator. I do not revise the tool text on my own,
  because the text carries the operator's guidance, and a revision after seeing data must be the operator's choice and is
  disclosed.
- **C10. The random arm is matched per stratum:** `cs-p20` alone, and the other 11 tasks pooled. The generator's parameters
  come from T's runs in that stratum and are committed before any R run. The R runs' realized share and switch count are
  reported, and no R run is repeated because of them.
- **C11. The S5 row guard `effort_mismatch`** (all transcript efforts equal `--effort`) cannot hold in modes that switch. Each mode
  gets its own guard: `placebo` and fixed arms keep the exact check; `toggle`, `random` and `schedule` check that every
  request's transcript effort equals the level the mod's log says it set.
- **C12. The plugin name, its mount path and the `--plugin-dir` argument are identical in every arm**, because the plugin name
  is part of the tool's name (`mcp__<plugin>__set_effort`) and the command line is readable through `/proc`. Only the
  mount's content differs between arms.

## The mod (`effort-toggle`)

One mod with a mode chosen per arm. It is loaded with `--plugin-dir` from the read-only harness mount, never from the agent's
working tree.

| mode | tool registered | effort per request |
|---|---|---|
| `toggle` | yes | the level of the agent's last valid call (start `low`) |
| `placebo` | yes, identical | unchanged (`low` throughout) |
| `random` | yes, identical | a random schedule (Step 1, arm R) |
| `schedule` | no | a fixed list per request index (Step 0, and fixed arms) |

- **Tool:** name `set_effort`; input `{ level: "low" | "xhigh", reason: string }`; both required. An invalid level returns an
  error result and changes nothing.
- **Tool description (draft; the exact text is fixed in the registration and is byte-identical in `toggle`, `placebo` and
  `random`):** "You start at low reasoning effort. Call this tool to change your effort for your next steps. Reviewing and
  verifying your work need higher effort: switch to xhigh before you review a change or run your final checks. When you judge
  that low effort is enough for what comes next, switch back to low."
- **Tool result text:** "Effort is now <level>. It applies from your next step." Identical in all three modes, whatever the
  real effort is.
- **Log:** one JSON line per request (session request number, `turnId`, `index`, `agentId`, effort before and after) and one
  per tool call (request number, requested level, `reason`, mode-independent result text), written OUTSIDE the agent's working
  tree. (The reviewer reports that `$.fs` writes absolute paths, `claude-code.d.ts` lines about 3115 to 3147; the builder
  confirms it.)
- **Blinding:** see "Blinding" below. In every case, nothing in the tool text, the result text, the agent's working tree or an
  environment variable may reveal the mode or the schedule. (The ES-17 probes read their schedule from a file in the working
  directory; that is not allowed here.)

### Blinding

Full blinding is not possible in the R1 V2 harness without changing it: the agent runs as the CLI's user, the transcript
(which records each request's `effort`) is in `/run/config`, a read-write mount, the mod's log would be in `/run/state`, and the
mod's files are in `/opt/es`, read-only but readable (`run.mjs`, the mounts and the environment of `runOne`). In R1 V2 no agent
looked: 0 of 856 Bash, Read, Grep and Glob calls in the 48 transcripts touched these paths or `/proc`.

**Operator decision (2026-10-17): audited blinding.** The harness stays as it is. After each run, a script reads every tool
call of the main transcript and flags the run if any call reads or lists `/run/config`, `/run/state`, `/opt/es`,
`/opt/claude` or `/proc`, runs `ps`, prints the environment (`env`, `printenv`, `set`, or `$CLAUDE_CONFIG_DIR` /
`$XDG_STATE_HOME`), or reads a `.jsonl` file outside `/work`. The matcher must recognise a command, not a word inside source
text (the R1 V2 scan found one false positive of that kind), and it is tested on the 48 R1 V2 transcripts before use: it
must flag none of them. My calls on the rule: a flagged run is excluded from the analysis, reported with the call that
flagged it, and replaced once; if more than 2 runs of one arm are flagged, the batch stops and I report to the operator.

## Step 0 — does a forced mid-turn switch change behaviour?

No agent decision. Task `cs-p20` only. Mode `schedule`, no tool registered.

| arm | effort by request index | runs |
|---|---|---|
| F-L | `low` throughout | 4 |
| F-X | `xhigh` throughout | 4 |
| F-LX | `low` for 0 to 4, `xhigh` from 5 | 4 |
| F-XL | `xhigh` for 0 to 4, `low` from 5 | 4 |

- **Primary observable, per run: `broad`** = the agent runs, at or after request 5, at least one check over more than the library
  unit tests: a `cargo test` with no `--lib` and no test-name filter, or with `--tests` or `--all-targets`, or a
  `cargo clippy --all-targets`, or a `cargo check --all-targets`. The registration fixes the exact matcher and tests it on the
  V2 and rerun transcripts (it must classify every known `xhigh` run broad and every known `low` run not broad).
- **Secondary, reported:** pass by the hidden tests; cost, output tokens and requests after index 5; the transcript `effort` of
  every request (an instrument check that the schedule reached the request, not evidence of behaviour).
- **Decision rule (draft; final in the registration):**
  - Positive control: F-X `broad` in at least 3 of 4 and F-L `broad` in at most 1 of 4. Otherwise step 0 is **uninformative**
    and stops.
  - Up-switch: F-LX `broad` in at least 3 of 4 → **delivered**; at most 1 of 4 → **not delivered**; else **inconclusive**.
  - Down-switch: F-XL `broad` in at most 1 of 4 → **delivered**; at least 3 of 4 → **not delivered**; else **inconclusive**.
- **If the up-switch is not delivered:** step 1 does not run as designed. Report to the operator. A different delivery path
  (for example, a turn boundary created by a `Stop` hook, whose feedback is a user message with new text) is a new design, not
  part of this one.
- **Cost estimate (not measured for the mixed arms):** about $5.5 for 16 runs, from $0.18 (`low`) and $0.48 (`xhigh`) per
  `cs-p20` run. Plus the smoke runs below.

## Step 1 — does the agent steer well?

Runs only if step 0 delivers the up-switch. All 12 R1 tasks; `cs-p20` 5 runs per arm, the other 11 tasks 2 runs per arm (C3).

| arm | start | tool | effort |
|---|---|---|---|
| L | `low` | no | `low` throughout |
| X | `xhigh` | no | `xhigh` throughout |
| T (toggle) | `low` | yes | the agent's choice |
| P (placebo) | `low` | yes | `low` throughout |
| R (random) | `low` | yes (calls ignored) | random schedule matched to T |

- **Order:** T and P first (interleaved). Then the random schedule's parameters are computed from T's runs and written down
  (committed) before any R run: R must match T's mean share of requests at `xhigh` and T's mean number of up-switches per run,
  each within 25 percent. Then R.
- **Fixed arms L and X:** fresh runs on `cs-p20` in this batch, with the mod loaded in `schedule` mode so the harness matches.
  On the other 11 tasks, the operator chooses at the cost approval: reuse the R1 V2 rows (same CLI, prompt and harness but no
  mod; a stated confound; saves about $17) or run them fresh.
- **Per run:** pass (hidden tests, the S5 grader); cost; requests; share of requests at `xhigh`; number of switches; the request
  index and `reason` of every tool call; `broad` as in step 0.
- **Success rule (draft numbers; final in the registration):**
  - **Quality (`cs-p20`, out of 5):** T passes at least X minus 1, AND T minus P is at least 3.
  - **Cost (all 12 tasks):** T's mean cost per run is at most the midpoint of L's and X's means.
  - **Harm (the 11 other tasks, out of 22):** T passes no fewer than L minus 1.
  - **"Steering works"** when all three hold. Each is also reported on its own. **T against R** (T minus R on `cs-p20` at least 2)
    is reported as the test of the agent's timing; it is not part of "works", because random switching that also passes would
    still be a working lever, only not a smart one.
- **Cost estimate (not measured for T, P and R):** 27 runs per new arm. T, P and R: 81 runs at an assumed $0.25 to $0.60 each,
  about $20 to $49. Fresh L and X on `cs-p20`: about $3.3. Fresh L and X on the other 11 tasks: about $17 more. A pilot of 2 or 3
  T runs on `cs-p20` comes first and replaces the assumption with a measured number before the operator approves the batch.

## Instrument checks before any measured call

1. Unit tests of the mod's logic: mode selection; the schedule (by index, and the random draw from a seed); identical tool text and
   result text across `toggle`, `placebo` and `random`; an invalid level changes nothing.
2. Tests of the runner change: the mod is copied into the read-only mount and loaded with `--plugin-dir`; arms without the mod get
   the exact R1 V2 command; the mode is not visible to the agent.
3. A smoke run in Docker on one task, per mode (operator-approved spend): the tool is listed and callable headless on CLI 2.1.296
   under the R1 V2 command (`--strict-mcp-config`, `--disallowedTools WebFetch WebSearch`; no probe has yet registered a tool);
   in `toggle` the transcript `effort` of the request after a call equals the chosen level; in `placebo` it stays `low`; the log is
   written outside `/work`; the agent's tree holds no mod file. If the tool is not listed, C6's fallback applies.
4. The runner change also touches `hook-copy.mjs`, whose header states the copy holds only `bin/`, `core/`, `adapter/` and
   `settings.json`; its tests change with it.
5. Rules learned in earlier stages: `claude -p` with stdin from `/dev/null`; per `message.id`, count thinking over all records and take
   the record with the largest `output_tokens`; a "no effect" result needs a positive control; grade with scripts; commit the
   registration before the first measured call.

## Goals, non-goals, anti-goals

- **Goals:** know whether a mid-turn effort switch changes behaviour (step 0); know whether an agent-controlled toggle meets the
  operator's success rule on the R1 tasks (step 1).
- **Non-goals:** a codescout tool; model switching; plan writing; a router or classifier; shipping anything; changing
  `core/rules.json`; models other than Sonnet 5.5.
- **Anti-goals (a "success" that would be a failure):** a win that comes from the tool's advice text and not from effort (the
  placebo guards this); an agent that can tell the placebo from the real toggle; a toggle arm that stays at `xhigh` and so costs
  like it (the cost rule catches this); thresholds chosen after seeing data.

## Constraints

- Sonnet 5.5 (`claude-sonnet-5-5`), CLI 2.1.296 (pinned), the R1 V2 Docker harness, the personal S5 token (to be revoked or replaced
  when the study ends).
- Every model stage needs the operator's approval of run count, model and cost: the smoke runs, step 0, the step 1 pilot, step 1.
- Nothing is pushed without the operator. Nothing is deleted without the operator. Commits by pathspec.
- Code lives in `effort-steering/spikes/toggle/` (mod, schedule logic, tests) and in a gated change to the S5 runner; the experiment
  root is outside the repository (for example `~/work/claude/s5-work-toggle/`).

## Left to the builder

- How the mod learns its mode and schedule without the agent being able to read them (a per-arm copy of the mod in the read-only
  mount is one way; the builder checks what `$.fs` can reach).
- The random schedule's generator, within the matching rule in step 1.
- The exact `broad` matcher, within the definition in step 0 and its test on the known transcripts.
- Runner details (config keys, row fields), following the S5 runner's existing patterns and tests.

## Open after this design

- The cache effect of switches on a long real session (ES-17 measured a 17k-token prefix) is not re-measured here; cost per run
  is the measure that would show it.
- A positive step 1 result covers one task for quality. A second task where `low` fails would be needed before any claim beyond
  `cs-p20`.
