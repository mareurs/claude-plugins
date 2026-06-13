# Explore Bootstrap Injector — Design

**Date:** 2026-06-13
**Status:** built + tested + wired (not yet shipped — needs version-bump + cold-restart)
**Related:** `skills/explore-project/SKILL.md`, `skills/reconnaissance/SKILL.md`,
`hooks/pre-task-hint.sh`, codescout memory `agent-dispatch-hooks`

## Problem

`explore-project` (spawn a subagent that bootstraps a *foreign* project's context
before exploring) has **0 invocations across all 3 profiles, ever**. Meanwhile the
model dispatches `Agent` subagents ~2,501 times and, when the target is another
repo, **hand-rolls the bootstrap inline** — retyping the absolute path and
"use codescout tools (symbols/semantic_search/grep), NOT native Read/Grep" into
prompt after prompt (verbatim across the BUG-IEL/BUG-GEN series; a hand-written
"Read README, Cargo.toml, src tree" checklist for a codescout-overview dispatch).

The demand is real and visible; the skill just isn't the channel. And the channel
can't be fixed by wording: `reconnaissance` — moment-anchored description, listed
at SessionStart, hinted per-dispatch — fired only **2 times**. Advisory prompts
that the model must *choose* top out near zero against the dispatch reflex.

Subagents already use codescout tools well (~13k codescout calls vs 78 native
`Read` in sidechains), so the gap is **bootstrap/context for foreign projects**,
not tool routing (SubagentStart already covers routing).

## Prerequisite bug (fixed 2026-06-13)

`pre-task-hint.sh` was wired to `"matcher": "Task"`, but CC renamed the
subagent-dispatch tool **`Task` → `Agent`** (transcripts: ~932 `"name":"Agent"`,
0 `"name":"Task"`). The hook never fired — the per-dispatch recon nudge was dead.
Fixed: matcher → `Agent`; regression tests `pre-task-hint.test.sh` +
`test-hooks-json-registration.sh` Test 2.

## Mechanism (verified live, 2026-06-13)

- A `PreToolUse` hook with `"matcher": "Agent"` receives `tool_input.subagent_type`
  and `tool_input.prompt`.
- It can **rewrite** the dispatch prompt via
  `hookSpecificOutput.updatedInput.prompt` — confirmed: a spawned subagent echoed
  back its prompt with a hook-appended sentinel. (`updatedInput` echoes the full
  `tool_input`, preserving `subagent_type`/`description`, with `prompt` modified.)
- Project `.claude/settings.local.json` hooks load **mid-session** (no restart).
- `SubagentStart` sees only `agent_type`/`cwd`/`agent_id` — **not** the prompt — so
  it cannot detect a foreign target path. The detector MUST live in PreToolUse-on-Agent.

## Design

A new PreToolUse-on-`Agent` hook (working name `explore-inject.sh`) that, before a
subagent runs, detects a foreign-project target in the prompt and prepends a compact
bootstrap directive via `updatedInput.prompt`.

### Decision 1 — trigger scope: foreign-project only
Inject **only** when the prompt names an absolute path resolving to a *different git
repo* than cwd's. Universal "use codescout not native Read" is already delivered by
`subagent-guidance.sh` (SubagentStart); the injector's unique, uncovered value is the
foreign bootstrap. (Not "all exploration" — that double-injects.)

### Decision 2 — inject a directive, not resolved content
Prepend an *instruction* ("you are operating in foreign project `<X>`; first
`workspace(activate, path=X, read_only=true)`, read its `CLAUDE.md`,
`memory(list)` then read what's relevant, use codescout tools") rather than
resolving and inlining X's memory bodies at hook time. The subagent has codescout
tools and self-bootstraps; the hook stays a cheap path-check (no per-dispatch
codescout round-trip → no latency tax on ~2,501 dispatches). Include an
**idempotency marker** so we never double-inject when `explore-project` (or the
model) already wrote a bootstrap.

### Detector contract (the load-bearing piece)
`foreign(cwd, path)` ⟺ `repo_id(path)` exists and `≠ repo_id(cwd)`, where
`repo_id(p) = realpath(git -C <p-or-its-dir> rev-parse --git-common-dir)`.
Using **git-common-dir** (not the nearest `.git`) folds worktrees of the same repo
to one identity, so a worktree of cwd's own repo is NOT foreign.
A dispatch injects iff **any** abs path in its prompt is `foreign`.
Short-circuit: skip the git calls entirely when no abs path lies outside cwd.

## Executed eval (not invented)

Ran the proposed classifier against all **2,501** real dispatches:

- **199 (7%) would inject.** Every INJECT sample is genuine cross-repo work
  (`backend-kotlin↔eduplanner-ui`, `backend-kotlin→deployment`,
  `claude-plugins→codescout`, …).
- Every false-positive *class* is correctly rejected: `/usr/bin/env` shebangs,
  `/tmp/*`, `~/.claude/sessions/*`, `~/.cargo/registry/*` (deps), `/home/u/...`
  placeholders — none resolve to a git repo.
- A naive "any path outside cwd" rule fires **15%** (395) with heavy FPs; the
  git-identity rule halves that to the precise 7%.

Corpus + gold labels: `hooks/explore-inject.fixtures.jsonl`.

### Known imperfections (encoded in the corpus)
- **FP-RISK:** a prompt that merely *reads a file* in another repo while doing its
  real work in cwd will over-trigger. Primary residual false positive.
- **KNOWN-FN:** foreign work addressed by project-*name* or via a `/tmp` instructions
  file (no repo path) is invisible to a path detector. Accepted miss.

## Relationship to existing skills
- `explore-project` survives as the **manual/explicit** entry point, sharing the
  same bootstrap snippet — no longer the only (unused) channel.
- `reconnaissance` is unchanged; its composition table should later gain a row for
  cross-repo → defer to the foreign bootstrap.

## Next steps

1. ✅ Built `explore-inject.sh` (bash; `git rev-parse --path-format=absolute
   --git-common-dir`; path regex; under-cwd short-circuit; idempotency marker +
   hand-written-activate guard; emits `updatedInput.prompt`; `CS_EXPLORE_INJECT_FORCE`
   test seam for the codescout gate).
2. ✅ `explore-inject.test.sh` — portable temp-git sandbox (two repos + worktree),
   e2e output-shape, and guarded replay of `explore-inject.fixtures.jsonl`
   (28/28; all 15 real-corpus rows pass). Real-gate integration spot-checked.
3. ✅ Wired as a second `Agent` hook in `hooks.json`; registration asserted
   (`test-hooks-json-registration.sh` Test 2b). NOT yet live — plugin hooks are
   resolved at launch, so it fires only after the version-bump + cold-restart ceremony.
4. ⏳ Tune the injected directive text (keep it short; the model complies once pointed).
5. ⏳ Decide `explore-project`'s final form (manual wrapper on the shared snippet, or retire).
6. ⏳ Ship: version-bump ceremony (plugin.json, README, check-versions, bump-cache,
   3 install records, version-bump-checklist tracker, push, cold-restart ×3).
7. ⏳ Residual FP-RISK (reads-a-file-in-another-repo): mitigate later if it proves noisy.
## Risks
- **Latency:** git calls per dispatch-with-abs-path. Mitigate via the no-outside-path
  short-circuit and caching repo_id per path within the hook invocation.
- **FP over-trigger** (above) — mitigate later with an intent/idempotency check.
- **Prompt bloat:** keep the directive compact; one marker line + ~4 steps.
