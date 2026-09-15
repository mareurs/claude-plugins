# Claude Plugins — Code Explorer Guidance

## Entry Points

### root (codescout-companion)
- `codescout-companion/hooks/hooks.json` — event → script mapping (authoritative wiring; start here for any hook question)
- `codescout-companion/hooks/lib.mjs` — `detectFor()`, the detection entry point 21 of 23 `.mjs` hooks call (2 call `detect.mjs` directly)
- `codescout-companion/hooks/session-start.mjs` — SessionStart orchestrator (injection budget, drift warnings, auto-reindex)
- `codescout-companion/hooks/pre-tool-guard.mjs` — PreToolUse hard-blocker for native Read/Grep/Glob/Edit/Bash on source
- `codescout-companion/hooks/subagent-guidance.mjs` — SubagentStart: injects system-prompt verbatim + codescout routing
- `codescout-companion/hooks/explore-inject.mjs` — PreToolUse `Agent`: rewrites dispatch prompt via `updatedInput.prompt`
- `scripts/check-versions.sh` — version consistency validator

### buddy
- `buddy/hooks/hooks.json` — event → script mapping
- `buddy/scripts/hook_helpers.py` — main event dispatch (SessionStart / PostToolUse / CSToolUse)
- `buddy/scripts/buddha.py` — `derive_mood()`, 12-priority mood chain

## Key Abstractions

- `detectFor()` (`codescout-companion/hooks/lib.mjs`) — detection entry point; sets HAS_CODESCOUT / BLOCK_READS, fails open on error
- `hook_helpers.py` (`buddy/scripts/`) — buddy event dispatch hub
- `derive_mood()` (`buddy/scripts/buddha.py`) — mood chain driving statusline + specialist eye expressions
- `hookSpecificOutput` — shared CC hook protocol: `additionalContext` to inject, `permissionDecision:"deny"` to block

## Search Tips

```
semantic_search("hook deny block tool call source file", project="root")
semantic_search("subagent dispatch prompt injection bootstrap", project="root")
semantic_search("mood derivation session signals", project="buddy")
semantic_search("judge worker subprocess spawn verdict", project="buddy")
```
Avoid: "task" (dispatch tool is `Agent`, not `Task`), "sdd-misc-plugins" (old repo name — now `claude-plugins`).

## Navigation Strategy

1. Hook behavior question → `symbols(path="codescout-companion/hooks/hooks.json")` for event binding → `symbols(path=<script>)` for that hook's structure
2. Trace a hook's logic → `semantic_search(query, project="root")` → `symbols(name=<fn>, include_body=true)`
3. Blast-radius before editing a shared function → `call_graph(symbol, path, direction="callers")`
4. Trace data/control flow through a function → `call_graph(symbol, path, direction="callees")`
5. Find who calls a specific hook script → `references(symbol, path)` on the function name
6. Version/release work → `symbols(path="<plugin>/.claude-plugin/plugin.json")` → `read_file("README.md")` → run `check-versions.sh`

## Project Rules

- `marketplace.json` must never contain `version` fields
- All 3 `installed_plugins.json` (`~/.claude/`, `~/.claude-sdd/`, `~/.claude-kat/`) update on every version bump; `installPath` must start with the owning profile root
- PreToolUse matchers for subagent dispatch use `"matcher": "Agent"`, NOT `"Task"`
- codescout-companion hooks always exit 0; buddy allows exit 2 only for a hard judge block
- Run `./tests/run-all.sh` (root) + `cd buddy && pytest` (buddy) before any version bump
