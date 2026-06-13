---
id: '4c3331864bcf8d9f'
kind: bug
status: open
title: Verify codescout still uses `server_instructions` for the system-prompt (not replaced by memories/guides)
owners: []
tags:
- codescout
- server_instructions
- system-prompt
- doc-staleness
- verify
topic: null
time_scope: null
---

## Summary

Is codescout's `server_instructions` mechanism still the channel that injects the project
system-prompt into the **main agent** (`project_status()` → `build_server_instructions` →
`## Custom Instructions`)? **Hypothesis (user):** it may have been **removed in favor of the
memories / guides system.** If true, the `CLAUDE.md` `## codescout-companion` Note and the
companion's `subagent-guidance.sh` rationale describe a **dead mechanism** — stale *and*
load-bearing. Verify before refactoring any of that prose.

## Why an issue, not a quick fix — this is a repeat-offender claim

Do **not** trust the in-repo docs on this; verify against codescout's current source:
- `CLAUDE.md:54` opens *"both the **opposite** of what this note once claimed"* — it has flipped before.
- `docs/trackers/skill-loading-session-log.md:174`: *"the system-prompt-source spec (2026-06-12)
  had to be fully rewritten because a `server_instructions` claim went unverified before drafting."*

## Current in-repo evidence (2026-06-14) — points AGAINST the hypothesis

- `docs/superpowers/specs/2026-06-12-system-prompt-source-consolidation-design.md` (2 days old):
  *"`build_server_instructions` (`src/prompts/mod.rs`) **does** append…"*; cites codescout
  `src/prompts/mod.rs` and `src/server.rs:103,:478` (computes / re-sends server_instructions).
- `docs/trackers/version-bump-checklist.md:83` (recent bump): *"codescout injects the root
  `.codescout/system-prompt.md` into the main agent via `server_instructions`."*

**Likely conflation to resolve:** what was removed is the **`system-prompt` memory topic**
(disowned by onboarding fix `e492592986c67138`) and the redundant SessionStart pointer to it —
NOT `server_instructions`. The system-prompt *source* was consolidated to the root
`.codescout/system-prompt.md`; `server_instructions` stayed the delivery channel. Confirm this
is still accurate — or that a change newer than the 2026-06-12 spec removed it.

## What to check (ground truth = codescout, not this repo)

1. codescout source: does `build_server_instructions` (`src/prompts/mod.rs`) still exist and fire?
   Is `server_instructions` still computed/sent in `src/server.rs` (~`:103`, `:478`)?
2. Changed since the 2026-06-12 spec? (user may know of a newer change.)
3. Does the system-prompt now ALSO/INSTEAD flow via memories/guides (`get_guide`, memory topics)?
4. Note the `guidance.txt` ↔ `server_instructions.md` sync history (`README.md:280`, `CHANGELOG.md:57`)
   — is `server_instructions.md` / `guidance.txt` still a thing, or fully retired?

## In-repo touch-points to update if the answer changed (`grep server_instruction`, 13 files)

`CLAUDE.md` (L47, L54) · `codescout-companion/hooks/session-start.sh` (L76-77) ·
`codescout-companion/hooks/subagent-guidance.sh` (L37-40) · `README.md:57` · `CHANGELOG.md:57` ·
`codescout-companion/README.md` (L28, L260, L280) · `buddy/data/gates.md:12` ·
specs/plans dated 2026-06-12 · `docs/trackers/version-bump-checklist.md:83`.

## Why it matters

- If removed: `CLAUDE.md`'s Note is stale; `subagent-guidance.sh`'s verbatim system-prompt push
  (justified by "subagents don't get server_instructions") may be redundant or aimed at a dead
  concept; the "SessionStart pointer is redundant" reasoning changes.
- **Blocks** the deferred Hamsa `server_instructions` prose consolidation in `CLAUDE.md` — that
  refactor must wait on this verdict (Hamsa audit-log tracker `720408ecd2391251`).

## Resolution criteria

- A definitive statement of codescout's CURRENT behavior (cite source file/line or observed
  behavior); then `CLAUDE.md` + companion hook comments updated to match (or confirmed accurate);
  then the prose consolidation can proceed.

## Resolution (2026-06-14) — VERIFIED against codescout source

**Verdict: `server_instructions` is STILL LIVE. Hypothesis (removed for memories/guides) REFUTED. `CLAUDE.md` is accurate — no correction required.**

Verified by reading codescout source at `/home/marius/work/claude/codescout` (read-only, workspace-pinned subagent):

- **`build_server_instructions` exists** — `src/prompts/mod.rs:27`. At ~`:115-119` it still appends the project system-prompt as a `## Custom Instructions` section when `status.system_prompt` is `Some`.
- **Sent on the MCP `ServerInfo.instructions` surface** — `src/server.rs:756` (`get_info()` → `.with_instructions(self.instructions.read().clone())`); computed at `:103` (`from_parts`), refreshed at `:478` (`refresh_instructions`) after each `activate_project`. Test `get_info_contains_instructions` (`server.rs:2096`) asserts presence.
- **System-prompt flow:** root `.codescout/system-prompt.md` → `project_status()` (`src/agent/mod.rs:~1100`) → `ProjectStatus.system_prompt` → `build_server_instructions` → `instructions` → `get_info` → MCP client. **New nuance not in CLAUDE.md:** falls back to `project.toml [project].system_prompt` when the root file is absent.
- **memories/guides COEXIST, did not replace:** the memory *list* (bare names) rides inside the same `server_instructions` payload (`prompts/mod.rs ~67-78`); `get_guide` is a separate on-demand pull. Neither carries the system-prompt.
- **Recency — trend is the opposite of removal:** commit `8427ae4a fix(onboarding): write system prompt to root file, not memory(write)` moved the prompt OUT of `memory(write)` INTO the root file that feeds `server_instructions`. No commit removes it.
- **Subagents:** not determinable from codescout source — codescout exposes only the single `get_info`/initialize surface; whether a subagent receives it is client-side (`claude-code#29655`).

**Origin of the hypothesis:** conflation of (a) the `system-prompt` *memory topic* being disowned/moved to the root file (TRUE — `8427ae4a`) with (b) the `server_instructions` *mechanism* (UNCHANGED, still live).

**Consequences:**
- The deferred Hamsa `CLAUDE.md` prose consolidation (3× restatement of the server_instructions fact) is **unblocked** — content is accurate, so consolidating is a safe *optional* cleanup, no staleness.
- **Optional** doc sharpening: add the `project.toml [project].system_prompt` fallback to the CLAUDE.md Note's source description. Not required for accuracy.
