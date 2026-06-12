---
status: ready
kind: plan
opened: 2026-06-12
owner: marius
implements: 2026-06-12-system-prompt-source-consolidation-design.md
tags: [codescout-companion, system-prompt, subagent, server-instructions]
---

# Plan — Drop the Redundant SessionStart System-Prompt Pointer

Implements `docs/superpowers/specs/2026-06-12-system-prompt-source-consolidation-design.md`.

**Thesis (verified):** codescout injects the root `.codescout/system-prompt.md` into the
**main agent** via `server_instructions` (`## Custom Instructions`). **Subagents** do not
receive `server_instructions` (`claude-code#29655`). So the SessionStart memory pointer is
redundant (remove it); the SubagentStart verbatim injection is the sole subagent channel
(keep it).

## Tasks

### T1 — `session-start.sh`: remove the system-prompt pointer
Delete the line `- System prompt for this project — memory(action="read", topic="system-prompt").`
from the `SKILLS AVAILABLE` block. Add a rationale comment (main agent gets it from
codescout's `## Custom Instructions`; subagents get it from `subagent-guidance.sh`;
`claude-code#29655`). Keep the Reconnaissance pointer.
**Verify:** `test-session-start.sh` (T3 below) — pointer absent, Reconnaissance present.

### T2 — `subagent-guidance.sh`: pin the injection with a `#29655` comment (no behavior change)
Add a comment above the `if [ "$HAS_CS_SYSTEM_PROMPT" = "true" ]` block stating this
verbatim injection is the only delivery path to subagents (`claude-code#29655`) — do not
remove it as "redundant with server_instructions."
**Verify:** `test-subagent-guidance.sh` Test 4 still green (subagent context contains the
system-prompt body) — unchanged.

### T3 — `test-session-start.sh` Test 4: flip to assert absence
Change from asserting `memory(action="read", topic="system-prompt")` present to asserting
it is **absent** and the Reconnaissance pointer is **present**.

### T4 — `test-session-start-payload.sh` Test 3: flip to assert absence
Change from asserting the pointer present to asserting it absent (Reconnaissance pointer
coverage already in Test 2).

### T5 — `plugin.json`: accuracy tweak (optional)
Description says "Injects system-prompt.md into all agents." Post-change the companion
injects it into **subagents** (the main agent gets it from codescout). Refine for accuracy.

### T6 — Version bump 1.11.10 → 1.11.11
Full checklist per root `CLAUDE.md § Version Management`:
1. Tests green (`./tests/run-all.sh`).
2. `plugin.json` version → 1.11.11; README version table row.
3. `scripts/check-versions.sh`.
4. `scripts/bump-cache.sh codescout-companion 1.11.11` (rsync to 3 profiles).
5. Update `installPath` + `version` in 3 `installed_plugins.json`.
6. Refresh version-bump-checklist tracker (`cc8cb9e23ab5cc67`, `commit_refresh`); verify all ✅.
7. Commit + push.
8. Cold-restart all 3 CC instances (**user action** — resume reuses the old hook).

## Non-goals
- Not filtering `system-prompt` from `CS_MEMORY_NAMES` (cosmetic; left advertised).
- Not deleting orphaned `.codescout/memories/system-prompt.md` files (per-project chore).
- No `detect.py` change (it already feeds the kept SubagentStart path).
