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
      usually pay off. This is the complete list — don't call memory(action="list").

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

> Revised 2026-07-28 after pre-planning reconnaissance. See F-1 / F-2 / F-3 in
> `docs/trackers/subagent-bootstrap-session-log.md` — the original version of this
> section cited an exemplar that does not demonstrate the technique, and specified
> one case that cannot be produced as worded.

`subagent-guidance.mjs` currently has **no test file**. Add
`codescout-companion/hooks/subagent-guidance.test.sh`; `tests/run-all.sh`
auto-discovers `hooks/*.test.sh`, so no registration is needed.

**Exemplar: `explore-inject.test.sh`.** It is the suite that actually drives a hook
end-to-end — `run() { printf '%s' "$1" | CS_EXPLORE_INJECT_FORCE=1 node "$HOOK"; }`,
payloads built with `jq -nc`, fixtures in a `mktemp -d` git sandbox. Borrow only the
`PASS`/`FAIL` `check`-helper shape from `pre-task-hint.test.sh`; that suite is
config-only (it `jq`s `hooks.json` and never invokes its hook), so it is not a model
for output-shape assertions. (F-1)

**A test seam is required.** `HAS_CODESCOUT` is **config-based, not project-based**:
`detect.mjs` resolves it from a routing-config `server_name` override,
`<cwd>/.mcp.json`, then the user-level `<claudeDir>/.claude.json`,
`<claudeDir>/settings.json`, and `~/.claude.json`. Nothing under `<cwd>/.codescout/`
participates. So a `mktemp` cwd on a configured machine still gates *open*, and no
fixture can close it. Add a seam mirroring `explore-inject`'s:

    if (process.env.CS_SUBAGENT_GUIDANCE_FORCE !== '1') {
      if (d.HAS_CODESCOUT === 'false') process.exit(0);
    }

Cases 3–8 then run deterministically on any machine. `session-start.test.sh`'s
alternative — SKIP the whole suite when codescout is unconfigured — is rejected: it
would leave the new suite silently inert in CI. (F-3)

Per-project state *is* fixture-controllable: `HAS_CS_MEMORIES`, `CS_MEMORY_NAMES`,
and `HAS_CS_SYSTEM_PROMPT` all read `<cwd>/.codescout/`, so cases 3, 4, and 7 build
`.codescout/memories/*.md` and `.codescout/system-prompt.md` under `mktemp -d`.
`CS_MEMORY_NAMES` is a space-separated list of basenames with `.md` stripped, and
carries a **trailing space** — assert with substring containment, not equality.

Per the isolation rule in `CLAUDE.md`, each case builds its fixture under
`mktemp -d` and removes it before the next case runs.

| # | Case | Setup | Asserts |
|---|---|---|---|
| 1 | gate closed | `HOME=$TMP CLAUDE_CONFIG_DIR=$TMP/empty-cfg`, no `.mcp.json`, no `.claude/codescout-*.json`, **force seam unset** | empty output |
| 2 | `agent_type: Bash` | force seam set | no output |
| 3 | memories present | `.codescout/memories/{architecture,gotchas}.md` | contains `activate(path=<root>)` and both names; does **not** contain `memory(action="list")` |
| 4 | memories absent | no `.codescout/memories/` | contains `memory(action="list")`; no stray names |
| 5 | cwd = subdirectory of a repo | git repo + `sub/` | injected path is the repo toplevel, not the subdir |
| 6 | worktree cwd | `git worktree add` | fires; injected path is the worktree root |
| 7 | `HAS_CS_SYSTEM_PROMPT === 'true'` | `.codescout/system-prompt.md` | system prompt still appended (regression on existing behavior) |
| 8 | wording | any codescout fixture | soft-conditional clause present |

Case 1 must override `CLAUDE_CONFIG_DIR`, not merely point at a clean cwd —
`detect.mjs` consults `~/.claude.json` only when that variable is unset, so setting
it is what seals the last discovery path. Worded as "non-codescout cwd" the case
would pass by vacuity on an unconfigured box and fail on a configured one: green
while asserting nothing. (F-2)

Cases 5 and 6 are the regression guards for the root-resolution bug; case 8 guards
the design decision that makes the prompt-blind channel viable.

`detect.mjs` is **not** modified, so the `detect.mjs` ↔ `scripts/detect.py`
byte-parity contract enforced by `detect.test.sh` is unaffected.
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
