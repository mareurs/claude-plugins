# Agent (subagent) dispatch — hook surface (verified 2026-06-13)

## Tool name
- The subagent-dispatch tool is `Agent` (input field `subagent_type`), NOT `Task`.
  CC renamed Task->Agent. Transcript evidence: ~932 `"name":"Agent"`, 0 `"name":"Task"`.
- PreToolUse matchers for subagent dispatch MUST use `"matcher": "Agent"`.
  The companion's `pre-task-hint.sh` was wired to `"Task"` and silently never fired
  (per-dispatch recon nudge was dead harness-wide). Fixed 2026-06-13. Regression tests:
  `codescout-companion/hooks/pre-task-hint.test.sh` + `tests/test-hooks-json-registration.sh` Test 2.

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
- Subagents do NOT receive MCP `server_instructions` (claude-code#29655, closed not-planned).

## Design implication (for the explore bootstrap injector)
- `explore-project` skill: 0 invocations across all 3 profiles, ever. Models instead
  hand-roll its bootstrap (absolute path + "use codescout not native Read/Grep") into
  raw Agent dispatch prompts (seen in BUG-IEL/BUG-GEN series + codescout-overview dispatch).
- Viable fix = a PreToolUse-on-Agent bootstrap injector using `updatedInput.prompt`,
  NOT a better skill description (reconnaissance control: well-described + surfaced, still
  ~2 invocations). Subagents already use codescout tools well (~13k codescout calls vs 78
  native Read), so the gap is bootstrap/context, not tool routing.
