# Subagent Bootstrap Injection — Design

**Date:** 2026-07-28
**Plugin:** `codescout-companion`
**Status:** approved, ready for planning

## Problem

A subagent working on the session's own project never receives the project
bootstrap. `SubagentStart` → `subagent-guidance.mjs` delivers the exploration
protocol, the codescout rules, and the project system-prompt verbatim — but not
the `PROJECT BOOTSTRAP` triad the main agent gets at `SessionStart`: no
`workspace(action="activate", …)` directive, and no list of which memory topics
exist.

Two concrete costs:

1. **Wasted round-trip.** Phase 0 tells the subagent to call
   `memory(action="list")` to discover topic names that `detect.mjs` already has
   sitting in `CS_MEMORY_NAMES`. Every subagent pays a tool call for information
   the hook could have handed it.
2. **Stale shared workspace.** codescout is one MCP process per session; main
   agent and all subagents share its active-project state. Normally the main
   agent already activated, so a home subagent's activate would be redundant —
   but a foreign-targeted *sibling* subagent can leave the shared server pointed
   elsewhere. A home subagent that assumes home-is-active then silently queries
   the wrong project. An idempotent activate at subagent start is a correctness
   guard, not parity decoration.

`explore-inject.mjs` (PreToolUse on `Agent`) already covers the *foreign* case,
firing only when the dispatch prompt names an absolute path in a different git
repo. The same-project case has no coverage.

## Decisions

| Question | Decision |
|---|---|
| Payload | The `SessionStart` triad: activate directive + inline memory names + read-nudge. Not full `SessionStart` parity. |
| Channel | `SubagentStart` (extend `subagent-guidance.mjs`) — widest coverage, fires for every subagent however spawned. |
| Foreign conflict | Soft-conditional wording that yields to the task text. No cross-hook state. |
| Worktrees | Fire normally. |
| Composition | Activate paragraph leads; memory names fold *into* Phase 0, replacing the `memory(action="list")` instruction. |

### Why `SubagentStart` over `PreToolUse:Agent`

`PreToolUse:Agent` is prompt-aware and could resolve foreign-vs-home precisely,
but its matcher is `Agent`, so by construction it fires only for dispatches that
go through the `Agent` tool — any other spawn path (e.g. Workflow-spawned agents)
gets nothing. `SubagentStart` fires per subagent regardless of spawn path. The
accepted cost is that it is blind to the dispatch prompt (verified; see the
`agent-dispatch-hooks` codescout memory), handled by the soft-conditional wording
below.
### Why the names fold into Phase 0 rather than prepending a block

Prepending the triad verbatim would leave Phase 0 still saying "call
`memory(action="list")`", so the round-trip that motivates injecting names at all
would survive, and one message would name the memories twice. Folding them in
gives a single source of truth.

## Root resolution

    root = git(cwd, ['rev-parse', '--show-toplevel']) || cwd

Raw `cwd` is **not** sufficient. `worktree-write-guard.mjs` locates
`.cs-worktree-pending` at `git rev-parse --show-toplevel` and denies every
codescout write tool while it exists. `cs-activate-project.mjs` releases the
guard with a literal `join(tool_input.path, '.cs-worktree-pending')`. So when a
session's cwd is a *subdirectory* of a worktree, an injected
`activate(path=cwd)` never matches the marker location — the subagent is told to
activate, does so, and remains write-blocked. Resolving to the toplevel makes the
injected call the one that actually releases the guard.

`detect.mjs`'s `WORKSPACE_ROOT` is not a substitute: it is populated only from a
routing-config `workspace_root` key and is empty in normal use.

If root resolution yields empty, omit the bootstrap paragraph and emit the rest
of the message unchanged (fail-open, per the `lib.mjs` contract).

Implementation note: `subagent-guidance.mjs` currently imports
`{ readInput, detectFor, emit }` from `lib.mjs`. `git` is exported there but not
yet imported here, so this change extends that import list. (F-3)

## Payload

Final message order: **bootstrap paragraph → exploration protocol (Phases 0–2 +
report contract) → `CODESCOUT RULES` → verbatim system-prompt block.** Only the
first element is new; the third and fourth are untouched.

Bootstrap paragraph, prepended ahead of the exploration protocol:

    PROJECT BOOTSTRAP: unless the task below names a different project root, your
    FIRST codescout action is workspace(action="activate", path="<root>") — it
    prewarms LSP, auto-registers dependencies, and returns project_hints (primary
    language, entry points, build commands). If the task DOES name another repo,
    follow that directive instead and pin every call with workspace="<that root>".

Phase 0's first bullet, when `HAS_CS_MEMORIES === 'true'` and `CS_MEMORY_NAMES`
is non-empty:

    • Memory topics available here: <CS_MEMORY_NAMES> — read the ones matching
      your task via memory(action="read", topic="…"); architecture and gotchas
      usually pay off. This is the complete list, so skip the separate discovery call.

The closing clause deliberately avoids the literal `memory(action="list")`. An earlier
draft ended `— don't call memory(action="list").`, which is self-defeating twice over: it
puts the string you don't want executed in front of the model, and it collides with the
test asserting that literal is absent from this branch. The fallback branch below must
contain the literal, so no substring assertion can police both branches — see Testing.

Otherwise that bullet keeps today's wording verbatim:

    • memory(action="list"), then read the topics matching your task
      (architecture, gotchas usually pay off).

`CS_MEMORY_NAMES` is space-separated and used as-is.

Everything else in the message — Phase 0's remaining bullets, Phases 1 and 2, the
report contract, `CODESCOUT RULES`, and the verbatim system-prompt block — is
unchanged.
## Gates

Existing gates are unchanged:

- `HAS_CODESCOUT === 'false'` → exit 0.
- `agent_type` in `{Bash, statusline-setup, claude-code-guide}` → exit 0.

Worktrees fire normally; root resolution is the only accommodation.

**No per-session dedup.** Unlike `emitSkillHint`, which suppresses repeat hints
via a marker file, every subagent is a fresh context and must be briefed each
time.

## Interaction with sibling hooks

`explore-inject.mjs` rewrites the dispatch **prompt**; this hook writes
**additionalContext**. Different channels, so there is no ordering dependency and
no shared state. The soft-conditional wording lets the prompt's more specific
directive win. `explore-inject`'s idempotency check
(`prompt.includes('workspace(action="activate"')`) is unaffected, since this hook
never touches the prompt.

Accepted residue: a foreign-targeted subagent sees both directives and arbitrates
between them. This is the known cost of the prompt-blind channel.

`session-start.mjs` is **not** changed. Its `!inWorktree && source === 'startup'`
gate stays, so the two hooks word the triad differently on purpose — the main
agent's variant is unconditional, the subagent's is soft-conditional.

## Testing

> **Corrected 2026-07-28** during execution, after Task 1's review. This section
> previously claimed `subagent-guidance.mjs` had no test file and mandated a
> `CS_SUBAGENT_GUIDANCE_FORCE` env seam. Both were wrong. See R-2 in
> `docs/trackers/reconnaissance-patterns.md`.

**The canonical suite already exists: `tests/test-subagent-guidance.sh`** (4 cases,
already driving this hook). All new cases land there. `tests/run-all.sh` globs **both**
`tests/test-*.sh` and `codescout-companion/hooks/*.test.sh`; the earlier version of this
section named only the second glob, which is why `tests/` was never searched.

**Exemplar and helper library.** `tests/lib/fixtures.sh` supplies `HOOK_DIR`,
`make_git_repo`, `make_worktree`, `write_routing_config`, `make_memories` (writes
`arch.md` + `patterns.md`), `make_system_prompt`, plus `pass` / `fail` /
`print_summary` / `assert_context_contains` / `assert_no_output`. For end-to-end
stdin driving, `explore-inject.test.sh` is the reference; `pre-task-hint.test.sh` is
config-only and is not a model for output assertions. (F-1)

**No test seam.** Gate control is per-project and environment-sealed, verified with
`detect.mjs --json`:

| Setup | `HAS_CODESCOUT` |
|---|---|
| `write_routing_config "$DIR" '{"server_name":"codescout"}'` + sealed env | `true` (`CS_PREFIX=mcp__codescout__`) |
| sealed `HOME` + `CLAUDE_CONFIG_DIR`, no routing config | `false` |
| `write_mcp_json` + sealed env | **`false` — a trap** |

`write_mcp_json` does not open the gate: `serverNameFromMcpConfig` matches `/codescout/`
against the server's `command`/`args`, and that fixture writes `command: <dir>/fake-ce`.
The server *key* is not consulted. The pre-existing suite relies on it, so its
`Bash`/`statusline-setup` cases were vacuous (gate closed, silence proving nothing about
the exclusion) and its system-prompt case omitted the env override, passing only on a
machine with codescout configured. Both are fixed as part of this work.

**Every hook invocation seals `HOME` and `CLAUDE_CONFIG_DIR`.** An unsealed call reads
the developer's real config, so it passes on a configured box and fails on CI — the
inverted flake F-2 was written to prevent. Sealing `CLAUDE_CONFIG_DIR` is what removes
the `~/.claude.json` discovery path.

**Per-project state is fixture-controllable:** `HAS_CS_MEMORIES`, `CS_MEMORY_NAMES`, and
`HAS_CS_SYSTEM_PROMPT` all read `<cwd>/.codescout/`.

Per the isolation rule in `CLAUDE.md`, each fixture lives under `mktemp -d` and is
removed via `trap`.

| # | Case | Setup | Asserts |
|---|---|---|---|
| 1 | gate closed | sealed env, no routing config | silent |
| 2 | excluded `agent_type` ×3 | gate **open**, so silence proves the exclusion | silent for `Bash`, `statusline-setup`, `claude-code-guide` |
| 2b | positive control | gate open, `general-purpose` | emits protocol + rules — without this, case 2 could pass by the hook being globally silent |
| 3 | memories present | `make_memories` | inline header + `patterns`; `.md` stripped; inline bullet **replaced** the fallback (asserted via absence of the fallback's own phrase `then read the topics matching your task`, **not** via absence of `memory(action="list")` — see below) |
| 3b | fallback sentinel pinned | `nomem` fixture | the phrase `then read the topics matching your task` is **present** in the fallback, so rewording it cannot silently hollow out case 3 |
| 4c | whitespace-only memory name | file named `" .md"` | falls back to list; no inline header — pins the `.trim()` guard |
| 4 | memories absent | separate fixture | contains `memory(action="list")`, no inline header |
| 4b | empty memories dir | `mkdir .codescout/memories` | falls back to list |
| 5 | cwd = subdirectory | repo + `nested/deeper` | names the toplevel, not the subdir |
| 6 | worktree cwd | `make_worktree` + its own routing config | fires; names the worktree root, not the main repo |
| 7 | system prompt | `make_system_prompt` | appended verbatim (pre-existing behavior) |
| 8 | wording | any open-gate fixture | soft-conditional clause present |

Cases 5 and 6 are the regression guards for the root-resolution bug; case 8 guards the
design decision that makes the prompt-blind channel viable; case 2b and the mutation
checks below guard against vacuity.

**Discrimination is proved, not assumed.** Every non-obvious assertion is verified by
temporary mutation, and a mutation that fails to flip its case is reported rather than
worked around. Confirmed during execution: commenting out the `agentType` early-return
flips exactly case 2; dropping `CLAUDE_CONFIG_DIR` from the invocation helper flips
exactly case 1; `root = cwd` flips both subdir assertions; resolving via
`--git-common-dir` flips both worktree assertions; emitting both memory bullets flips
case 3; rewording the fallback sentinel flips case 3b; reverting the `.trim()` guard
flips case 4c.

**A limit worth recording.** The `memory(action="list")` literal is *required* in the
fallback branch and *unwanted* in the inline branch, so a substring assertion on it is a
tripwire in both directions — it fires on the clearest phrasing of the very instruction
it encodes, and it is evaded by whitespace variation (`action = "list"`). Case 3
therefore asserts the structural property (the inline bullet **replaced** the fallback)
rather than the copy property (the bullet doesn't order a list call). The copy property
is genuinely untestable by substring match; it is a review concern, not a test one. Case
3b exists so that the phrase case 3 depends on cannot be reworded without failing loudly
at its source.

**A caveat on the git-toplevel guard.** The subdirectory case is the *only* discriminator
for root resolution. The worktree case passes even under `root = cwd`, because a
worktree's cwd already equals its toplevel. And the subdirectory fixture needs its own
routing config — `findRoutingConfig` is cwd-only with no upward walk, so without one the
gate is closed, the hook exits before root resolution runs, and the case fails for a
misleading reason.

`detect.mjs` is **not** modified, so the `detect.mjs` ↔ `scripts/detect.py` byte-parity
contract enforced by `detect.test.sh` is unaffected.
## Deploy

    ./scripts/release.sh codescout-companion patch

Then the two steps the script cannot do, per `CLAUDE.md`:

1. Refresh the codescout `version-bump-checklist` tracker
   (`artifact(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)`), then
   verify every row is green.
2. **Cold-restart all three Claude Code profiles.** A resume reuses the old
   in-memory hook — confirm `source=startup` in the `SessionStart` payload.

## Out of scope

- A `CLAUDE.md` pointer in the payload. Foreign dispatches get one from
  `explore-inject`; for the home project the main agent's `CLAUDE.md` is already
  in play and the subagent inherits the system-prompt block.
- Changes to `session-start.mjs`, `explore-inject.mjs`, or `pre-task-hint.mjs`.
- Full `SessionStart` parity (skills list, tracker-hygiene nudge, drift
  warnings) — dispatcher-level concerns, not subagent ones.
