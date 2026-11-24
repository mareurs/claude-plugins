---
kind: entry
status: accepted
title: A result too large for the context becomes a pointer and a handle that the agent queries, not a clipped copy
anchors:
- codescout-companion/hooks/subagent-guidance.mjs sha256:7619e8c1dbe444b2b91c14aa26eaf8229cbd7f6dd525fd13948862ad0ae154d6
confidence: medium
created: 2026-11-24
entry_kind: decision
log:
- '2026-11-24 accepted created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
source: operator, 2026-11-24, named as the model of this box; the mechanism is codescout's, the two applications here are this repository's
status_since: 2026-11-24
---

**Decision:** When what an agent needs is larger than the budget of the surface that carries it, send a short pointer and a way to fetch the rest (a buffer handle, a file path, a tool call), not the whole text and not a clipped copy.

**Scope:** Tool results, hook payloads and skill text that an agent reads. It does not cover a result that fits the budget: that is sent whole.

**Context:** 2026-11-24. `get_guide("progressive-disclosure")` in codescout: a result over about 9 KB is stored in a server-side `@tool_*` or `@cmd_*` buffer, the answer shrinks to `{output_id, summary, hint}` with a summary of about 2 KB, and the agent queries the buffer instead of re-running the tool. In Claude Code a hook payload of about 10 KB or more is cut to a 2 KB preview with no handle (`CLAUDE.md` § codescout-companion, SubagentStart; the comment of `buddy/scripts/summon_bootstrap.py` says the same of persona payloads of 18 to 48 KB).

**Alternatives considered:**
- Send everything inline. Lost: past the cap Claude Code clips it to a 2 KB preview and gives the agent nothing to fetch the rest with; under the cap every byte is paid again on each turn (`CLAUDE.md` Iron Law 4, token economy).
- Rely on the clip. Lost: the agent receives the first 2 KB of a persona or a guide and no signal that the rest exists.

**Consequences:** Now easier: the agent pays for what it reads; a hook payload stays small by construction (`tests/test-subagent-guidance.sh` pins 5000 B). Now harder: the agent needs a second call to read the rest, the pointer must name the way to make it, and a handle outlives only its session.

**Applications in this repository:** SubagentStart sends a pointer of about 3.4 KB (load the tools, enter the project, read `.codescout/system-prompt.md` by path), not the prompt. The buddy summon hook spills a persona to `.buddy/<session>/summon-payload-<name>.md`, a guard-exempt path, and injects a one-line `payload-file=` pointer.

**Not measured here:** how often an agent follows a pointer or a handle. Only the size side is measured.

**Revisit-when:** A session or a probe shows agents that do not fetch what a pointer names. The fix is then the discoverability of the pointer, not a larger inline copy.

**Evidence:** `codescout-companion/hooks/subagent-guidance.mjs` (the pointer), `tests/test-subagent-guidance.sh` (the cap), `buddy/scripts/summon_bootstrap.py` (the spill).
