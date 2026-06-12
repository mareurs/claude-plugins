---
status: draft
kind: design
opened: 2026-06-12
owner: marius
tags: [codescout-companion, system-prompt, server-instructions, subagent, injection-budget]
related:
  - "[injection-budget design](2026-05-19-injection-budget-design.md) — converted SessionStart to pointers; left SubagentStart verbatim. This spec explains why that asymmetry is correct."
  - "[subagent-guidance.sh](../../../codescout-companion/hooks/subagent-guidance.sh) — SubagentStart hook; injects CS_SYSTEM_PROMPT verbatim (lines 37-40) — KEEP"
  - "[session-start.sh](../../../codescout-companion/hooks/session-start.sh) — SessionStart hook; the system-prompt memory pointer this spec REMOVES"
  - "[detect.py](../../../codescout-companion/scripts/detect.py) — computes CS_SYSTEM_PROMPT from the root .codescout/system-prompt.md"
  - "(codescout repo) issue e492592986c67138 — onboarding wrote the prompt to the wrong file; FIXED (onboarding now writes the root file directly)"
  - "claude-code#29655 — subagents do NOT receive MCP server_instructions (closed not-planned). The load-bearing fact for this spec."
---

# System-Prompt Surfacing — the Main Agent Is Already Covered by codescout; Keep the Subagent Injection, Drop the Redundant Pointer

## Summary

codescout delivers the project system prompt (the root `.codescout/system-prompt.md`)
to the **main agent** automatically: `project_status()` reads the root file and
`build_server_instructions()` appends it as a `## Custom Instructions` section
(`src/prompts/mod.rs`), computed at MCP session construction (`src/server.rs:103`).
That arrives in the main agent's MCP `initialize.instructions` with no companion help.

**Subagents do not get this.** Claude Code does not surface an MCP server's
`instructions` field to subagents (`claude-code#29655`, closed *not-planned*):
subagents receive the tool allowlist but not the server-instructions string. So the
`## Custom Instructions` block that reaches the main agent never reaches a subagent.

That asymmetry decides the companion's job:

| Delivery surface | Main agent | Subagent |
|---|---|---|
| codescout `server_instructions` → `## Custom Instructions` (= root system-prompt) | **✅ receives** | **❌ not delivered** (`#29655`) |
| codescout MCP tools | ✅ | ✅ (allowlist only) |
| companion SubagentStart `additionalContext` | n/a | ✅ |

Therefore:
- **SubagentStart verbatim injection** of the root system-prompt
  (`subagent-guidance.sh:37-40`, `CS_SYSTEM_PROMPT`) is the **only** way the system
  prompt reaches subagents. It is **necessary** — keep it.
- **SessionStart's** `memory(action="read", topic="system-prompt")` pointer is
  **redundant**: the main agent already has the prompt via `## Custom Instructions`.
  Worse, it points at the `system-prompt` *memory topic*, which codescout's
  onboarding fix just **disowned** ("not a memory topic"). **Remove it.**

Net change: delete one line from `session-start.sh`; keep `subagent-guidance.sh` and
`detect.py` exactly as they are. The "two divergent files" problem dissolves — nobody
reads the `system-prompt` memory topic anymore (codescout writes the root file
directly; the subagent hook reads the root file; the main agent gets the root file via
server_instructions).

## Status

**Design phase — second correction.** This spec's conclusion reversed **twice** as the
facts came in; the trail is recorded deliberately (each step was a confident claim that
verification overturned):

1. **First framing:** "make `subagent-guidance.sh` read the memory, like SessionStart."
   Overturned by scouting codescout: the subagent path (root file) was the *aligned*
   one; the SessionStart memory pointer was the divergent one.
2. **First rewrite (commit `17196f1`):** "repoint SessionStart at `read_markdown(root)`
   so both hooks name the root file." Built on the Constraint *"server_instructions does
   not carry the project system prompt."* That Constraint was **false** — it came from a
   **truncated grep**. `build_server_instructions` (`src/prompts/mod.rs`) **does** append
   `status.system_prompt` as `## Custom Instructions`. So the main agent was already
   getting the root file from codescout; a companion pointer (memory *or* root) is
   redundant, not a fix.
3. **This version:** the only delivery gap is **subagents** (`#29655`). So the subagent
   injection is load-bearing and the main-agent pointer is dead weight. Remove the
   pointer; keep the injection.

This rests on a now-resolved upstream bug. codescout issue `e492592986c67138` (onboarding
wrote the system prompt via `memory(write, topic="system-prompt")` → landed in
`.codescout/memories/`, never the root file the injection reads) is **fixed**: all three
onboarding sites now write `.codescout/system-prompt.md` directly via `create_file`
(`ONBOARDING_VERSION` 28→29). The root file is now reliably the canonical, always-on
system prompt — which is what makes "the main agent is already covered" true.

## Goals

- Stop the companion from surfacing the system prompt to the **main agent** — codescout
  already does (`## Custom Instructions`). Remove the redundant, now-misdirected pointer.
- Keep the companion surfacing the system prompt to **subagents** — codescout cannot
  (`#29655`), so the SubagentStart verbatim injection is the sole channel.
- Retire the `system-prompt` *memory topic* as a companion dependency (codescout's fix
  disowned it).

## Non-goals

- **Not** converting the SubagentStart path to a pointer. Subagents are ephemeral and do
  not reliably pull on demand, and there is no codescout fallback for them — verbatim is
  the only safe delivery. (A pointer would also be unfollowable: post-fix the memory
  topic is empty and the root file is not a memory.)
- **Not** changing codescout further. The upstream bug is fixed; nothing else is owed
  there for this.
- **Not** force-deleting existing `.codescout/memories/system-prompt.md` files from a
  hook. They are orphaned post-fix but harmless; cleanup is a per-project chore (Risks).

## Constraints

- **`server_instructions` carries the project system prompt to the main agent.**
  `project_status()` (`src/agent/mod.rs:1101-1125`) reads the root file (TOML fallback
  at `:1115`); `build_server_instructions` appends it as `## Custom Instructions`;
  `server.rs:103` bakes it into the main session's `initialize.instructions`. (Correcting
  this spec's prior Constraint, which falsely said the opposite from a truncated grep.)
- **Subagents do not receive `server_instructions`** (`claude-code#29655`, closed
  not-planned): tool allowlist yes, instructions string no. The companion's SubagentStart
  hook is the only delivery path to subagents for any project-specific guidance.
- **The `system-prompt` memory topic is no longer the system prompt.** Post-fix,
  `memory-templates.md` and the onboarding prompts instruct writing the root file directly
  and explicitly say system-prompt is "not a memory topic." `memory(topic="system-prompt")`
  still resolves to `.codescout/memories/system-prompt.md`, but onboarding no longer writes
  there. A SessionStart pointer at that topic now aims at an empty/orphaned file.
- `detect.py` already computes `HAS_CS_SYSTEM_PROMPT` / `CS_SYSTEM_PROMPT` from the root
  file. No detection change is needed; the SubagentStart path keeps working unchanged.

## Architecture

The corrected delivery model (post codescout fix + given `#29655`):

```
onboarding()  ──create_file──▶  .codescout/system-prompt.md  (root, canonical)
                                        │
                  ┌─────────────────────┴───────────────────────┐
                  ▼                                              ▼
        project_status() → build_server_instructions    detect.py → CS_SYSTEM_PROMPT
        → "## Custom Instructions"                       → SubagentStart additionalContext
                  │                                              │
                  ▼                                              ▼
            MAIN agent (server_instructions)             SUBAGENT (companion hook)
            — automatic, no companion needed             — companion is the ONLY path (#29655)
```

The main-agent branch needs no companion involvement. The subagent branch needs the
companion entirely. The old SessionStart memory pointer sits on the main-agent branch —
where codescout already delivers — pointing at a third file nobody writes anymore. It is
pure redundancy plus misdirection.

**Decision: remove the SessionStart system-prompt pointer; keep SubagentStart verbatim.**

Rejected alternative — *repoint SessionStart at `read_markdown(root)`* (this spec's prior
recommendation): still redundant, because the main agent already has the body via
`## Custom Instructions`. Adding a pointer to content the agent already holds spends
tokens and attention for nothing.

## Components

### `session-start.sh` — remove the system-prompt pointer (the only code change)
The skill-pointer block currently emits:
```
- System prompt for this project — memory(action="read", topic="system-prompt").
```
Delete that line. The "Reconnaissance" skill pointer in the same block stays. Rationale
in a comment: the main agent receives the system prompt via codescout's
`## Custom Instructions`; a companion pointer is redundant and the memory topic is
defunct post-fix.

### `subagent-guidance.sh` + `detect.py` — no change
SubagentStart already injects `CS_SYSTEM_PROMPT` (the root file) verbatim, and `detect.py`
already reads the root file. This is the load-bearing path (`#29655`) and it is already
correct. Add a code comment citing `#29655` so a future reader does not "simplify" it away
as redundant with server_instructions — it is not, for subagents.

### `CS_MEMORY_NAMES` advertisement — optional follow-up
`detect.py` enumerates `.codescout/memories/*.md`, so `system-prompt` still appears in the
advertised memory list if an orphaned file exists. Optionally filter it out (it is no
longer a memory topic). Cosmetic; flag, do not silently drop.

### `CLAUDE.md` (claude-plugins) — correct the companion note
The "What it does" note must state the corrected model: server_instructions **carry** the
system prompt to the main agent; subagents **do not** receive server_instructions
(`#29655`); hence SubagentStart verbatim is necessary and the SessionStart pointer is
redundant. (Fixed alongside this spec.)

## Data flow

After the change, for an onboarded + refreshed project:

- **Main agent:** root file → `## Custom Instructions` (codescout). Companion injects
  *no* system-prompt content — only the Reconnaissance skill pointer, memory names, drift
  warnings.
- **Subagent:** root file → `CS_SYSTEM_PROMPT` → SubagentStart `additionalContext`
  (companion). codescout delivers nothing here.
- **Nobody** reads `.codescout/memories/system-prompt.md`. The divergence class is gone.

## Risks

1. **Main agent depends on codescout having populated the root file.** If a project is
   onboarded under the old version (v28) or never onboarded, its root file may be empty or
   stale, so `## Custom Instructions` is empty/stale and — with the pointer removed — the
   companion adds nothing. Mitigation: `onboarding(action="refresh_prompt")` regenerates
   the root file (the v28→v29 staleness nudge already fires). Net vs. today: neutral — the
   removed pointer aimed at the *equally* empty/orphaned memory topic.
2. **`#29655` could change.** It is closed not-planned, but if Claude Code later surfaces
   server_instructions to subagents, the SubagentStart injection becomes redundant
   (harmless duplication). Low-likelihood; the code comment + this spec make the
   dependency explicit so it can be revisited, not silently rotted.
3. **Orphaned memory files linger.** Existing `.codescout/memories/system-prompt.md` files
   remain and still answer `memory(read, topic="system-prompt")` with stale content for an
   agent that explicitly asks. Mitigation: document as deprecated; optional per-project
   delete. Do not auto-delete from a hook.

## Open questions

1. Filter `system-prompt` out of `CS_MEMORY_NAMES`, or leave the orphan advertised?
   (Cosmetic — decide in the plan.)
2. Should the plan also delete orphaned `.codescout/memories/system-prompt.md` in this
   repo as a one-off, or leave it for an onboarding refresh? (Housekeeping, not behavior.)

## Tests / Validation

- **Characterization (SessionStart):** assert the SessionStart output no longer contains
  `memory(action="read", topic="system-prompt")`, and still contains the Reconnaissance
  skill pointer + memory-names line.
- **Characterization (SubagentStart):** assert SubagentStart still injects
  `CS_SYSTEM_PROMPT` verbatim when `HAS_CS_SYSTEM_PROMPT=true`, and nothing when false.
  Keep/strengthen this test with a comment citing `#29655` — it pins intentional behavior
  that looks redundant but is not.
- **No behavioral eval needed for the main agent path:** codescout owns that delivery; the
  companion change is a *removal* of redundant text, not a new behavior to measure.

## References

- `claude-code#29655` — subagents do not receive MCP server instructions (closed
  not-planned). Verified via claude-code-guide this session.
- codescout `src/prompts/mod.rs` — `build_server_instructions` appends `status.system_prompt`
  as `## Custom Instructions`.
- codescout `src/server.rs:103`, `:478` — computes/re-sends server_instructions from
  `project_status()`.
- codescout `src/agent/mod.rs:1101-1125` — `project_status()` reads the root file; TOML
  fallback at `:1115`.
- codescout issue `e492592986c67138` (FIXED) — onboarding now writes the root file directly;
  `ONBOARDING_VERSION` 28→29.
- `codescout-companion/hooks/session-start.sh` — the pointer to remove.
- `codescout-companion/hooks/subagent-guidance.sh:37-40` — the injection to keep.
- `2026-05-19-injection-budget-design.md` — pointers-not-content; this spec explains why
  the SubagentStart exception to that rule is correct, not an oversight.
