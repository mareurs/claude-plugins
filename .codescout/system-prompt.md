# Claude Plugins — Code Explorer Guidance

## Entry Points

### root (codescout-companion)
- `codescout-companion/hooks/detect-tools.sh` — detection library sourced by every hook; sets HAS_CODESCOUT, BLOCK_READS, WORKSPACE_ROOT
- `codescout-companion/hooks/hooks.json` — event → script mapping (authoritative wiring; start here for any hook question)
- `codescout-companion/hooks/session-start.sh` — SessionStart orchestrator (injection budget, drift warnings, auto-reindex)
- `codescout-companion/hooks/pre-tool-guard.sh` — PreToolUse hard-blocker for native Read/Grep/Glob/Edit/Bash on source
- `codescout-companion/hooks/subagent-guidance.sh` — SubagentStart: injects system-prompt verbatim + codescout routing (subagents don't get `server_instructions`)
- `codescout-companion/hooks/pre-task-hint.sh` — PreToolUse `Agent`: recon nudge (matcher `"Agent"`, NOT `"Task"`)
- `codescout-companion/hooks/explore-inject.sh` — PreToolUse `Agent`: bootstrap injector — rewrites dispatch prompt via `updatedInput.prompt` (abs path + codescout routing)
- `codescout-companion/hooks/il3-warn-hook.sh` — PreToolUse `run_command`: IL3 warn for unbounded-LHS pipe
- `codescout-companion/hooks/il4-deny-hook.sh` — PreToolUse `read_file`: IL4 deny where a better tool fits
- `codescout-companion/hooks/goal-stop-hook.sh` — Stop gate: goal check
- `tests/lib/fixtures.sh` — test helpers (assert_denied, assert_reason_contains, make_git_repo)
- `scripts/check-versions.sh` — version consistency validator

### buddy
- `buddy/hooks/hooks.json` — event → script mapping
- `buddy/scripts/hook_helpers.py` — main event dispatch (handle_session_start, handle_post_tool_use, handle_cs_tool_use)
- `buddy/scripts/buddha.py` — mood derivation (derive_mood, 12-priority chain)
- `buddy/scripts/cs_heuristics.py` — 6 sync codescout iron law checks injected after tool calls
- `buddy/hooks/judge.env` — authoritative judge config (do NOT use settings.json for judge config)

## Key Abstractions

- `detect-tools.sh` (`codescout-companion/hooks/`) — shared detection library: sets HAS_CODESCOUT, BLOCK_READS; sourced by all companion hooks
- `hook_helpers.py` (`buddy/scripts/`) — buddy event dispatch hub; routes SessionStart / PostToolUse / CSToolUse
- `derive_mood()` (`buddy/scripts/buddha.py`) — 12-priority mood chain driving statusline + specialist eye expressions
- `hookSpecificOutput` — shared CC hook protocol: `additionalContext` to inject, `permissionDecision:"deny"` to block

## Search Tips

```python
# Root plugin
semantic_search("hook deny block tool call source file", project="root")
semantic_search("detect codescout MCP server config", project="root")
semantic_search("subagent dispatch prompt injection bootstrap", project="root")
semantic_search("worktree pending marker activate", project="root")

# buddy
semantic_search("mood derivation session signals", project="buddy")
semantic_search("judge worker subprocess spawn verdict", project="buddy")
semantic_search("heuristic codescout iron law violation check", project="buddy")
semantic_search("specialist summon bodhisattva skill", project="buddy")
```

Avoid: "task" (renamed to "Agent"), "sdd-misc-plugins" (old repo name — now "claude-plugins")

## Navigation Strategy

1. Hook behavior question → `symbols(path="codescout-companion/hooks/hooks.json")` to find event binding → `symbols(path=<script>)` for that hook's structure
2. Trace a hook's logic → `semantic_search(query, project="root")` → `symbols(name=<fn>, include_body=true)`
3. Blast-radius before editing a shared function → `call_graph(symbol, path, direction="callers")`
4. Trace data/control flow through a function → `call_graph(symbol, path, direction="callees")`
5. Find who calls a specific hook script → `references(symbol, path)` on the function name
6. Version/release work → `symbols(path="<plugin>/.claude-plugin/plugin.json")` → `read_markdown("README.md")` → run `check-versions.sh`
7. buddy mood/judge issue → `symbols(name="derive_mood", include_body=true)` in `buddha.py` + `symbols(path="buddy/scripts/hook_helpers.py")`

## Project Rules

- codescout-companion hooks always exit 0; buddy allows exit 2 only for hard judge block (`BUDDY_JUDGE_BLOCK=true`)
- `block_reads` accepts boolean `false` OR string `"false"` (either → `BLOCK_READS=false`); absent → `true`. Measured 2026-08-27 — see `guard-hardening-session-log:F-2`
- `marketplace.json` must never contain `version` fields
- All 3 `installed_plugins.json` files (`~/.claude/`, `~/.claude-sdd/`, `~/.claude-kat/`) updated on every version bump; `installPath` must start with the owning profile root
- PreToolUse matchers for subagent dispatch use `"matcher": "Agent"`, NOT `"Task"` (CC renamed Task→Agent)
- Run `./tests/run-all.sh` (root) + `cd buddy && pytest` (buddy) before any version bump
