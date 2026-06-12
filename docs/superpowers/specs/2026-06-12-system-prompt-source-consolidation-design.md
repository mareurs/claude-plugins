---
status: draft
kind: design
opened: 2026-06-12
owner: marius
tags: [codescout-companion, system-prompt, injection-budget, subagent, onboarding, drift]
related:
  - "[injection-budget design](2026-05-19-injection-budget-design.md) — converted SessionStart to pointers; left SubagentStart verbatim. This spec finishes the source-of-truth side of that work."
  - "[subagent-guidance.sh](../../../codescout-companion/hooks/subagent-guidance.sh) — SubagentStart hook; injects CS_SYSTEM_PROMPT verbatim (lines 37-40)"
  - "[session-start.sh](../../../codescout-companion/hooks/session-start.sh) — SessionStart hook; points the main agent at the `system-prompt` memory topic"
  - "[detect.py](../../../codescout-companion/scripts/detect.py) — computes CS_SYSTEM_PROMPT from the *root* .codescout/system-prompt.md"
  - "(codescout repo) `src/agent/mod.rs:1101` — project_status() reads the root file, falls back to project.toml system_prompt"
  - "(codescout repo) `src/tools/onboarding.rs:902` — onboarding generates the root file via build_system_prompt_draft()"
---

# System-Prompt Source Consolidation — One Canonical File Across Main Agent and Subagents

## Summary

The companion reads **two different files** for "this project's system prompt," and
they silently diverge.

- **Subagents** (`subagent-guidance.sh:37-40`) get `CS_SYSTEM_PROMPT` injected
  **verbatim**. `detect.py` computes that from the **root** `.codescout/system-prompt.md`.
- **The main agent** (`session-start.sh`) gets a **pointer**:
  `memory(action="read", topic="system-prompt")`. codescout resolves every memory
  topic through `resolve_memory_dir` → `.codescout/memories/<topic>.md`, so that
  pointer reads `.codescout/memories/system-prompt.md` — **a different file**.

These two files have **different writers and no link between them**. Editing one does
not touch the other. This session observed the drift live in this very repo: the
root file was serving stale "Code Explorer" + GitHub guidance to every subagent while
the memory the main agent reads had already moved on. I synced them by hand — a
stopgap that re-breaks on the next edit or the next `onboarding()` run.

The decisive fact, established by scouting the codescout source this session: the
**root `.codescout/system-prompt.md` is codescout-canonical.** `onboarding()` generates
it (`onboarding.rs:902` → `build_system_prompt_draft()`), and `project_status()` reads
it (`agent/mod.rs:1101`, falling back to `project.toml` `system_prompt` at `:1115`).
The `system-prompt` **memory topic** is a *parallel artifact* that codescout's
onboarding never writes. So the subagent path is the one **aligned** with codescout;
the main-agent SessionStart pointer is the **divergent** one.

This spec consolidates the companion onto the codescout-canonical root file: point
the main agent at the root file too (still a cheap pointer — `read_markdown`), keep
the subagent path unchanged, and stop treating the `system-prompt` *memory topic* as
the source. One file, one writer (`onboarding()`), every agent reading the same bytes.

## Status

**Design phase.** Drafted after the channel was execution-tested this session (the
recon-findings-as-project-memory work) surfaced the drift as a side-finding.

This spec **corrects the framing in which the task was raised.** It was first floated
as "make `subagent-guidance.sh` read the memory, like SessionStart does." A
reconnaissance pass against codescout source overturned that: pointing the subagent
hook at the memory would move the *aligned* path onto the *orphan* artifact — exactly
backwards. The fault line is the SessionStart pointer, not the subagent injection.
Recording the reversal here so the plan does not re-inherit the wrong direction.

Architecture seam owned by the Snow Lion; the behavior-change / token lens by the
Hamsa. Implementation plan (`docs/superpowers/plans/`) to follow once reviewed.

## Goals

- **One source of truth** for the project system prompt, read identically by the main
  agent and by subagents.
- That source is the file **codescout itself writes and reads** (`onboarding()` →
  root `.codescout/system-prompt.md` → `project_status()`), so re-running onboarding
  or editing the file updates every consumer with no manual sync.
- **Preserve the injection-budget posture**: the main-agent path stays a *pointer*
  (the model pulls the body on demand), not verbatim content.
- Fail safe when the root file is absent (project never onboarded): no broken pointer,
  no dangling instruction.

## Non-goals

- **Not** converting the subagent path from verbatim to a pointer. Whether ephemeral
  subagents should pull-on-demand vs. receive-verbatim is a *budget* question, not a
  *source* question; it is deliberately deferred. This spec only makes both paths read
  the same file.
- **Not** changing codescout. The clean upstream fix (make `onboarding()` write the
  prompt into the memory topic, or unify the two paths) is out of scope and out of
  push-authorization. It is noted as the long-term ideal under Architecture → Option C.
- **Not** deleting existing `.codescout/memories/system-prompt.md` files in projects.
  They become vestigial but harmless; migration handling is a Risk, not a goal.

## Constraints

- **`server_instructions` does not carry the project system prompt.** That surface
  (`src/prompts/source.md`, per `src/prompts/README.md`) is generic and
  project-agnostic — Iron Laws, workspace gate. A 2026-04-24 review claimed the
  project `system_prompt` was "concatenated raw into server_instructions"; that path
  is **stale** in current source. So agents do **not** auto-receive the root file via
  MCP instructions — the companion hooks are the only thing that surfaces it.
- The companion cannot change where codescout reads the prompt from. codescout-canonical
  = root file. Any consolidation that does not land on the root file creates a standing
  divergence with codescout's own `onboarding()`/`project_status()`.
- `detect.py` already computes `HAS_CS_SYSTEM_PROMPT` (true iff the root file exists)
  and `CS_SYSTEM_PROMPT` (its contents). The SessionStart change can gate on the
  existing `HAS_CS_SYSTEM_PROMPT` — no new detection.
- Pointer parity with the budget redesign: SessionStart must emit a *pointer*, not the
  body. `read_markdown(".codescout/system-prompt.md")` is a pointer the model resolves
  on demand at the same cost class as the current `memory(read)` line.

## Architecture

Three artifacts exist under the name "system prompt"; only one is canonical:

| Artifact | Writer | Read by |
|---|---|---|
| **root `.codescout/system-prompt.md`** | `onboarding()` (`build_system_prompt_draft`) | codescout `project_status()`; companion **subagent** hook (verbatim) |
| **`.codescout/memories/system-prompt.md`** (memory topic) | ad-hoc `memory(write, topic="system-prompt")` | companion **main-agent** SessionStart pointer |
| `project.toml` `system_prompt` | hand-edit (deprecated) | codescout `project_status()` *fallback* only |

**The fault line is which file the companion's two hooks name.** Today they name
different files; nothing keeps the two in sync. Consolidation = both hooks name the
codescout-canonical root file.

**Option A — canonicalize on the root file (RECOMMENDED).**
Change the SessionStart pointer from `memory(action="read", topic="system-prompt")` to
`read_markdown(".codescout/system-prompt.md")`, gated on `HAS_CS_SYSTEM_PROMPT`. The
subagent hook already reads the root file — unchanged. Result: one file, written by
`onboarding()`, read identically by both paths and by codescout itself. The memory
topic stops being load-bearing.
*Cost:* the main agent no longer reaches the prompt through the memory machinery
(advertise-by-name, `memory(read)`, anchors). It reaches it through a file pointer
instead — equivalent reach, equivalent token class.

**Option B — canonicalize on the memory topic (REJECTED).**
Point the subagent hook (via `detect.py`) at `.codescout/memories/system-prompt.md`;
SessionStart already points there. *Why rejected:* it orphans `onboarding()`'s output.
Every `onboarding()` run would write the root file, which no agent then reads, while
the memory the agents read drifts from it. It trades "two files, sometimes synced" for
"two files, guaranteed to desync on every onboarding." A wall in an empty field — the
memory mechanism's extras (anchors, advertise) do not absorb a real change scenario
here, and the divergence with codescout is a new permanent cost.

**Option C — upstream codescout fix (OUT OF SCOPE, noted as ideal).**
Make `onboarding()` write the prompt *into* the memory topic, or make
`memory(topic="system-prompt")` and the root file the same path. That would let the
companion keep the full memory machinery with zero divergence. It requires a codescout
change (not push-authorized here) and a codescout test. Record it; do not block on it.

## Components

### `session-start.sh` — repoint + gate the system-prompt line (the only behavioral change)
The skill-pointer block currently emits unconditionally:
```
- System prompt for this project — memory(action="read", topic="system-prompt").
```
Replace with a root-file pointer, **gated on `HAS_CS_SYSTEM_PROMPT`** so it is silent
when the project is not onboarded:
```
- System prompt for this project — read_markdown(".codescout/system-prompt.md").
```
This is the consolidation. No other hook logic changes.

### `subagent-guidance.sh` — no change
Already injects `CS_SYSTEM_PROMPT` (the root file) verbatim. After Option A it reads
the same file the main agent is pointed at. Left verbatim by design (see Non-goals).

### `detect.py` — no change
Already reads the root file for `CS_SYSTEM_PROMPT` / `HAS_CS_SYSTEM_PROMPT`. The
SessionStart gate reuses `HAS_CS_SYSTEM_PROMPT` as-is.

### `CS_MEMORY_NAMES` advertisement — optional follow-up
`detect.py` enumerates `.codescout/memories/*.md`, so `system-prompt` still appears in
the advertised memory list even after it stops being the pointer target. Harmless
(it is a readable memory), mildly redundant. Optionally filter `system-prompt` from
the advertised set; not required for correctness. Flag, don't silently drop.

### `CLAUDE.md` (claude-plugins) — doc update
The companion "What it does" bullets must reflect: SessionStart points at the **root
file**, not the memory topic. (This session already corrected those bullets once for
the verbatim/pointer distinction; this spec changes the *target*, so they change again.)

## Data flow

After Option A, for an onboarded project:

```
onboarding()  ──writes──▶  .codescout/system-prompt.md  (root, canonical)
                                   │
              ┌────────────────────┼─────────────────────┐
              ▼                    ▼                     ▼
   project_status()      SessionStart pointer     SubagentStart verbatim
   (codescout server)    read_markdown(root)      CS_SYSTEM_PROMPT=root
              │                    │                     │
              ▼                    ▼                     ▼
        codescout API        main agent pulls       subagent receives
                             body on demand          body in context
```

One write site, three readers, all the same bytes. Editing the file or re-running
`onboarding()` updates every reader. No sync step.

## Risks

1. **Subagents may need verbatim where the main agent only gets a pointer.** The main
   agent reaches the prompt via a `read_markdown` pointer it must choose to follow; a
   one-shot subagent gets it verbatim. That asymmetry is *intended* (subagents are
   ephemeral and may never pull), but it means the two paths still deliver the content
   at different reliability. Acceptable for this spec; revisit only if the eval shows
   main agents skipping the pointer.
2. **Vestigial `.codescout/memories/system-prompt.md` left behind.** Projects that
   created the memory topic keep a now-unread file. It still lists in `CS_MEMORY_NAMES`
   and is still `memory(read)`-able, so an agent that *explicitly* reads the topic gets
   stale content that no longer drives any hook. Mitigation: document the topic as
   deprecated; optionally have a project delete it. Do not auto-delete from a hook.
3. **Projects with no root file but a populated memory topic regress.** If a project
   relied on the memory topic having content and never ran `onboarding()`, Option A
   leaves the main agent with no system-prompt pointer (gated off) and subagents with
   none either (`HAS_CS_SYSTEM_PROMPT=false`). Mitigation: the fix is "run
   `onboarding()`" (or hand-create the root file); the gate fails *safe* (silent), not
   broken. Surface this in the plan's migration note.
4. **Pointer-not-pulled (budget redesign's standing risk).** A `read_markdown` pointer
   only helps if the main agent follows it. This is the same open risk the
   injection-budget redesign carries for all its pointers; it is not introduced here,
   but it is inherited. The behavioral eval is the check.
5. **`onboarding()` overwrites hand-edits to the root file.** If a project hand-tunes
   `.codescout/system-prompt.md`, a later `onboarding()` run regenerates it. That is
   codescout's existing behavior, not new — but consolidating onto the root file makes
   it the *only* place to edit, so the overwrite now affects both paths at once. Note
   it; the right home for durable project tuning is a memory the agent reads explicitly,
   not the regenerated system-prompt file.

## Open questions

1. Does any current codescout path still ship `status.system_prompt` into an
   always-on agent surface (resource, prompt, server_instructions)? Source scan says
   no, but confirm before assuming the companion hooks are the *sole* surfacers — if
   codescout already pushes it, the SessionStart pointer may be redundant rather than
   load-bearing.
2. Should `system-prompt` be filtered out of `CS_MEMORY_NAMES` once it is no longer the
   pointer target, or left advertised as a readable (if vestigial) memory? Cosmetic;
   decide in the plan.
3. Is there appetite for Option C (the upstream codescout unification) on a future
   codescout cycle, so the companion can keep the full memory machinery? If yes, this
   spec is the interim; if no, Option A is terminal.

## Tests / Validation

- **Characterization test (companion):** assert SessionStart emits the
  `read_markdown(".codescout/system-prompt.md")` pointer when `HAS_CS_SYSTEM_PROMPT=true`
  and emits **no** system-prompt line when false. Mirror the existing detect.py
  characterization style.
- **Negative test:** project without a root file → SessionStart output contains no
  dangling `read_markdown(".codescout/...")` and no `memory(read, topic="system-prompt")`.
- **Drift-cannot-recur test:** with both hooks pointed at the root file, editing the
  root file is observable in both the SessionStart pointer target and the
  `CS_SYSTEM_PROMPT` the subagent hook injects; editing the memory topic is observable
  in *neither* hook. This is the regression guard for the bug this spec fixes.
- **Behavioral eval:** add a case to the reconnaissance / companion eval harness asking
  whether the main agent, given the root-file pointer, actually reads it before acting
  (Risk 4). Per the Hamsa: without this, "consolidation works" is an inspection, not a
  measurement.

## References

- `2026-05-19-injection-budget-design.md` — the pointers-not-content decision this
  extends to the source-of-truth axis.
- `codescout-companion/hooks/subagent-guidance.sh:37-40` — verbatim CS_SYSTEM_PROMPT.
- `codescout-companion/hooks/session-start.sh` — the skill-pointer block to repoint.
- `codescout-companion/scripts/detect.py` — `system_prompt_file = project_dir / "system-prompt.md"`; `HAS_CS_SYSTEM_PROMPT` / `CS_SYSTEM_PROMPT`.
- (codescout) `src/agent/mod.rs:1101-1125` — `project_status()` reads root file, falls back to `project.toml` `system_prompt` (`:1115`).
- (codescout) `src/tools/onboarding.rs:902` — `build_system_prompt_draft()` produces the root-file content.
- (codescout) `src/prompts/README.md` — `server_instructions` is generic; the per-project prompt is embedded via onboarding, not server_instructions.
- (codescout) `src/tools/memory/mod.rs` — `resolve_memory_dir` → `.codescout/memories/<topic>.md` (so `topic="system-prompt"` ≠ the root file).
