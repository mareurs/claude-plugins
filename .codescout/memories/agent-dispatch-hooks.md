# Agent (subagent) dispatch — hook surface (verified 2026-06-13, extended 2026-08-27)

## Tool name
- The subagent-dispatch tool is `Agent` (input field `subagent_type`), NOT `Task`.
  CC renamed Task->Agent. Transcript evidence: ~932 `"name":"Agent"`, 0 `"name":"Task"`.
- PreToolUse matchers for subagent dispatch MUST use `"matcher": "Agent"`.
  The companion's `pre-task-hint.sh` was wired to `"Task"` and silently never fired
  (per-dispatch recon nudge was dead harness-wide). Fixed 2026-06-13. Regression tests:
  `codescout-companion/hooks/pre-task-hint.test.sh` + `tests/test-hooks-json-registration.sh` Test 2.

## Agent dispatch is ASYNCHRONOUS — the tool returns at LAUNCH (MEASURED 2026-08-27)

This is the single most load-bearing fact on this page. `PostToolUse:Agent` does NOT
mean "the subagent finished". It means "the subagent was launched".

Measured across three dispatches (CC 2.1.247), in-hook timestamps:

| event | when |
|---|---|
| `PreToolUse:Agent` | t0 |
| `SubagentStart` | t0 + ~2.1s |
| `PostToolUse:Agent` | same millisecond as `SubagentStart` (2 of 3 runs: +2-3ms) |
| subagent's first tool call | `SubagentStart` + 3.4s .. 8s |
| `SubagentStop` | `PostToolUse:Agent` + 17.2s |

`PostToolUse:Agent`'s `tool_response` is "Async agent launched successfully" and its
`duration_ms` measures the launch, not the agent. The relative order of
`PostToolUse:Agent` vs `SubagentStart` is NOT dependable — build nothing on it.

**Any hook that needs "the subagent is done" must use `SubagentStop`.** This cost a
shipped no-op: `codescout-companion` 1.18.0 bracketed a guide-ledger snapshot on
`PreToolUse`/`PostToolUse:Agent` and the bracket closed before the subagent ran.
`docs/issues/archive/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md`

## Payload key sets (MEASURED 2026-08-27, not read from docs)

| key | `PreToolUse:Agent` | `SubagentStart` | `PostToolUse:Agent` | `SubagentStop` |
|---|:--:|:--:|:--:|:--:|
| `tool_use_id` | yes | no | yes | **no** |
| `agent_id` | **no** | yes | **no** | yes |
| `agent_type` | no | yes | no | yes |
| `tool_name` / `tool_input` | yes | no | yes | no |
| `tool_response` / `duration_ms` | no | no | yes | no |
| `prompt_id` / `session_id` / `cwd` / `transcript_path` | yes | yes | yes | yes |
| `effort` / `permission_mode` | yes | no | yes | yes |

`SubagentStop` also carries `agent_transcript_path`, `last_assistant_message`,
`background_tasks`, `session_crons`, `stop_hook_active`.

**The tool lifecycle and the agent lifecycle share NO identifier.** Tool pair keys on
`tool_use_id`; agent pair keys on `agent_id`; neither appears on the other side.
`prompt_id` is on all four but its per-dispatch uniqueness is UNMEASURED — it plausibly
identifies the parent turn, so two agents dispatched in one turn may collide. Do not use
it as a join key without measuring first.

Practical consequence: to bracket a subagent, use `SubagentStart` -> `SubagentStop`
keyed by `agent_id`. No join key needed, and it survives concurrent dispatches.

## PreToolUse-on-Agent capabilities (LIVE-TESTED 2026-06-13)
- Hook receives `tool_input.subagent_type` AND `tool_input.prompt`.
- Can DENY (`permissionDecision:"deny"`) AND can REWRITE the dispatch prompt via
  `hookSpecificOutput.updatedInput.prompt` — confirmed: a spawned subagent echoed back
  its prompt with a hook-appended sentinel. `updatedInput` should echo the full
  tool_input (preserve subagent_type/description) with `prompt` modified.
- Project `.claude/settings.local.json` hooks load MID-SESSION (no restart needed).
  Plugin `hooks.json` is still resolved at launch — cold restart required (see CLAUDE.md).

## SubagentStart
- Receives `agent_type`, `cwd`, `agent_id`, `session_id` — NOT the dispatch prompt.
  Can inject `additionalContext` into the subagent, but is BLIND to a foreign target
  path named in the prompt. So the foreign-path detector must live in PreToolUse-on-Agent.
- Fires BEFORE the subagent's first tool call (3.4s / 8s ahead in measured runs), so it
  is a sound point to snapshot pre-subagent state.
- Subagents do NOT receive MCP `server_instructions` (claude-code#29655, closed not-planned).

## Hook CONTENT vs hook REGISTRATION (measured 2026-08-27)

For this repo's `directory`-source marketplace, the two have different load semantics and
conflating them wastes a whole diagnostic cycle:

- **Content** (the `.mjs` body) loads from the REPO WORKING TREE on every invocation. An
  edit is live immediately — no reload.
- **Registration** (which events/matchers exist in `hooks.json`) resolves at PROCESS
  LAUNCH. A new event or matcher needs `/reload-plugins` or a cold restart. `/compact` is
  NOT a launch.

So a probe whose registration is new writes nothing, and that silence is indistinguishable
from "the event does not fire". Always register the same probe on a known-firing event as a
POSITIVE CONTROL and require the control's line before reading anything into a missing one.
`/reload-plugins` reports the hook count — it went 24 -> 26 when two registrations landed,
which is a cheap independent confirmation.

## Design implication (for the explore bootstrap injector)
- `explore-project` skill: 0 invocations across all 3 profiles, ever. Models instead
  hand-roll its bootstrap (absolute path + "use codescout not native Read/Grep") into
  raw Agent dispatch prompts (seen in BUG-IEL/BUG-GEN series + codescout-overview dispatch).
- Viable fix = a PreToolUse-on-Agent bootstrap injector using `updatedInput.prompt`,
  NOT a better skill description (reconnaissance control: well-described + surfaced, still
  ~2 invocations). Subagents already use codescout tools well (~13k codescout calls vs 78
  native Read), so the gap is bootstrap/context, not tool routing.
