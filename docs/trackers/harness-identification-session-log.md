---
id: '399f21aefc4471d3'
kind: tracker
status: draft
title: Session Log — harness identification and project migration
tags:
- session-log
- harnesses
topic: harness-identification
entry_prefix:
- F
- W
entry_high_water_F: 5
entry_high_water_W: 2
---

# Session Log — harness identification and project migration

> **Purpose:** Frictions (F-N) and wins (W-N) from the work on issue `docs/boxes/bugs/bugs/2026-11-24-no-harness-identification-and-no-tooling-to-clean-up-route.md`.
> Entries are appended with `doc(action="append_entry")`. Do not hand-allocate ids.

## Index

| ID | Date | Sev | Cat | Status | Title |
|---|---|---|---|---|---|
| F-5 | 2026-11-14 | low | instrument | mitigated | **No OpenCode instruction-file rule is measured; README is for 2.1.3, host is 2.2.7** — `debug config` does not show them |
| F-4 | 2026-11-14 | med | substrate | open | **OpenCode plugins are symlinked into a worktree on branch pr11-local, not main** — content equal today, link fragile |
| F-3 | 2026-11-14 | med | architectural | open | **The D3 generator for CLAUDE.local.md and AGENTS.override.md is designed, not built** — a routing design must not duplicate it |
| F-2 | 2026-11-14 | med | drift | open | **Root AGENTS.md is a stale hand-kept copy of CLAUDE.md** — contradicts itself on profile count |
| F-1 | 2026-11-14 | low | scope | open | **Install scripts for pi, opencode and copilot already exist** — the issue gap is project instruction files only |

## Wins Index

| ID | Date | Cat | Status | Title |
|----|----|----|----|----|
| W-2 | 2026-11-14 | measurement | validated | **OpenCode 2.2.7 loads a project AGENTS.md but not a lone CLAUDE.md** — probe with negative control, local model |
| W-1 | 2026-11-14 | seam | validated | **Reading the session contract ruled out shape-based harness detection** before it entered a design |

## F-1 — Install scripts for pi, opencode and Copilot already exist

**Status:** open

**Valid:** dated 2026-11-14

**Observed:** The issue (item 4) and my first brainstorming message both say there are no migration or integration scripts. Per-harness install scripts exist: `harnesses/pi/install.sh`, `harnesses/opencode/install.sh` and `scripts/sync-copilot.sh`. They install a plugin into a harness. None of them touches a project's instruction files, so the issue's gap is real but narrower than its wording.

**Cost:** A design that ignored these scripts would build a second installer. One wrong claim reached the user in the first message.

**Fix idea:** Word the scope as "project instruction files and a per-project report", and call the install scripts a dependency, not a gap. Read the install scripts before the approaches message.

## F-2 — Root AGENTS.md is a stale hand-kept copy of CLAUDE.md

**Valid:** dated 2026-11-14

**Status:** open

**Observed:** The root `AGENTS.md` is a regular file of 16,647 bytes, next to a `CLAUDE.md` of 32,899 bytes. It is a hand-kept copy that has fallen behind. Its heading map still has `## This Machine (verified 2026-08-05)`, which `CLAUDE.md` replaced with a measured Linux section. It still says "Zero active Claude Code profiles exist now" (line 46) and "the three Claude Code profile dirs" (line 55), but line 130 says "four profiles" and line 174 says "all four Claude Code instances". So the file contradicts itself.

**Cost:** This is first-hand evidence for issue item 2 (duplicate and stale instruction text). `AGENTS.override.md` does not exist here, so Codex loads `AGENTS.md` by the 2026-11-13 measurement in the separation design (D3). A Codex session in this repo therefore reads a false machine description. I read the text of `AGENTS.md`. I did not run Codex to see what it loads.

**Fix idea:** Do not hand-sync the two files. Generate one from the other, or generate both from a single source, in the routing step of the design.

## F-3 — The D3 instruction-file generator is designed, not built

**Valid:** dated 2026-11-14

**Status:** open

**Observed:** `docs/superpowers/specs/2026-11-12-private-setup-separation-design.md` (D3) plans one local source, `.codescout/private-facts.md`, and a script `scripts/gen-local-instructions.sh` that writes `CLAUDE.local.md` and `AGENTS.override.md`. None of the three exists. `ls` found no `scripts/gen-local-instructions.sh`, no `AGENTS.override.md` and no `CLAUDE.local.md` in the repo root. D3 is a design, not a build.

**Cost:** The issue calls that generator "a first, small instance of the routing item". A routing design written now has two bad options. It can duplicate the generator, or it can assume a generator that does not exist. Either one leaves two tools that write the same two files.

**Fix idea:** Decide in the approaches message whether harness routing extends the D3 generator or waits for it. Do not design a second generator beside it.

## W-1 — The session contract rules out shape-based harness detection

**Valid:** dated 2026-11-14

**Status:** validated

**Observed:** Before the approaches message I read `normalizeHookContext` in `codescout-companion/hooks/session-context.mjs` (lines 35-52). It accepts only an explicit `claude-code` or `codex` origin and its comment says "similar native payloads never identify a host". `validateContext` (line 17) lists `claude-code`, `codex` and `manual` and nothing else. `codescout-companion/scripts/detect.py` resolves only `claude_config_dir` and the codescout server, not a harness.

**Counterfactual:** Without this read I would have proposed to extend the session contract with a project-level detector that infers the harness from file shape. The code states that rule out. A project directory has no payload, so detection there must come from measuring files on disk, which the issue already requires.

**Cost avoided:** One rejected approach in the approaches message, and one design section that would contradict an existing contract.

## F-4 — OpenCode plugins link into a worktree on branch pr11-local

**Valid:** dated 2026-11-14

**Status:** open

**Observed:** OpenCode `v2.2.7` is installed at `/usr/bin/opencode`. Every plugin and two commands under `~/.config/opencode/` are symlinks into a worktree, `/home/marius/work/claude/claude-plugins.worktrees/opencode-harness`. `git worktree list` shows that worktree on the local branch `pr11-local` (`fe94cee`), not on `main` (`1448818`). `diff -rq` of `harnesses/opencode` between `main` and that worktree reports one differing file, `tests/test-codescout-companion.mjs`. The plugin files, `lib/host.mjs` and the commands are identical. `sdd-init.md` and `sdd-review.md` in the commands directory are regular files, not links. I did not compare them with a source.

**Cost:** The installed runtime content matches `main` today, but it lives in a worktree of another branch. If someone removes that worktree, every OpenCode plugin link dangles at once. The release process (`release.sh`, `check-profile-parity.sh`) does not look at OpenCode at all.

**Fix idea:** The project report should list the target of each link and flag a target outside the main checkout. Decide separately whether `harnesses/opencode/install.sh` should link to the main checkout.

## F-5 — No measured OpenCode instruction-file rule, and a version skew

**Attempt 2026-11-14 (blocked, no measurement):** The operator approved the probe. I made four temporary directories: `a` with `AGENTS.md`, `b` with `CLAUDE.md`, `c` with both, `d` with neither, each holding a distinct `ZEBRA-xxxx` codeword. Every `opencode run --standalone` call failed before the model answered, so the result says nothing about instruction loading.
- Default model `github-copilot/gemini-4-carbon`: `HTTP 400: Personal Access Tokens are not supported for this endpoint`. All `github-copilot/*` models share that token.
- `local/qwen3-4b-q4_k_m-auto`: eleven `litellm ... Connection error` retries. The litellm proxy at `localhost:43000` answers `/v1/models` with 200, but the backend of that model does not answer.
- Provider `a5000` at `127.0.0.1:43102`: connection refused (curl exit 7).
- I did not use the `opencode/*-free` models: OpenCode puts the working directory in the request, and that path holds the project and user names.

Finished later the same day: the operator had the local `llm-qwen38.service` started, and the probe ran. See W-2 for the result. The version skew between the README (2.1.3) and the host (2.2.7) remains. The four probe directories are in the session scratchpad under `oc-probe/`.

**Valid:** dated 2026-11-14

**Status:** mitigated

**Observed:** `harnesses/opencode/README.md` records its measurements on OpenCode `2.1.3`, and it reads the binary under `~/.local/share/mise/installs/opencode/2.1.3/`. The installed binary is now `v2.2.7` at `/usr/bin/opencode`. The README has no line about how OpenCode loads `AGENTS.md` or `CLAUDE.md`. My grep for those names matched only lines about MCP and system-prompt instructions. `opencode debug config` printed 102 lines. A filter on `agents|claude|instruction|.md` matched two lines, both MCP binary paths. I did not read the other lines, because `opencode.json` has 8 lines that match secret-like words.

**Cost:** The repo holds no measured OpenCode rule for project instruction files, which agrees with the issue ("Not yet known"). Any rule taken from memory or docs would be the guessed rule that the issue forbids, and the old measurements are for another version.

**Fix idea:** Measure on `2.2.7`: a real `opencode run --standalone` session in a temporary directory with distinct marker text in `AGENTS.md` and `CLAUDE.md`, as the README did for other claims. That calls a model, so the operator must approve it first. `opencode debug config` is not an instrument for this question.

## W-2 — OpenCode 2.2.7 loads project AGENTS.md but not a lone CLAUDE.md

**Valid:** dated 2026-11-14

**Status:** validated

**Observed:** OpenCode `v2.2.7`, 2026-11-14. Method: four temporary project directories, each with distinct `Codeword: ZEBRA-xxxx` text. `a` had `AGENTS.md`, `b` had `CLAUDE.md`, `c` had both, `d` had neither. In each, `opencode run --standalone --model a5000/qwen3.8-27b-ud-q4_k_xl` asked the model to quote the lines that start with `Codeword`. The model ran on a local `llama-server` (`llm-qwen38.service`, port 43102). The environment of the runs held no `OPENCODE_*` variable, and `opencode.json` has no `instructions` key.

| dir | files | valid runs | the model quoted |
|---|---|---|---|
| `d` | none | 2 | `NONE` both times |
| `a` | `AGENTS.md` | 1 | `ZEBRA-AAA1` |
| `b` | `CLAUDE.md` | 2 | `NONE` both times |
| `c` | both | 2 | `ZEBRA-CCC3` only (the `AGENTS.md` text) |

**What this shows:** In this setup, a project `AGENTS.md` reaches the model. A project `CLAUDE.md` alone does not. The result in `c` follows from the result in `b`. It does not show a precedence rule, because `CLAUDE.md` never loads in either case.

**Validity checks:** The negative control `d` was clean. Every valid run echoed its control word, so the model followed the format. The first `b` run is discarded: the model refused the control line and called the prompt a canary probe, so its `NONE` could have been a refusal. I reworded the prompt and ran `b` twice more. Both gave `NONE` with the control word present. A world where `CLAUDE.md` loads would show its codeword in `b` in those runs, so the instrument can express the failure. It is still model behavior: a loaded file that the model fails to quote would look like a missing file. The `AGENTS.md` positive control in `a` and `c` lowers that risk. One model and a few runs only.

**Not tested:** the global `~/.claude/CLAUDE.md` fallback, parent directories and the git root, nested `AGENTS.md` in a subdirectory, and other models. The measurement is for this host's config and environment, not a statement about OpenCode's defaults.

**Cost:** None. This is the first measured OpenCode rule in this repo. It fills the gap named in F-5 and in the issue ("Not yet known").

## Template for new entries

Copy the shape of an existing entry: **Observed**, **Cost**, **Fix idea**.
