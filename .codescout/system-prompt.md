# Claude Plugins — Code Explorer Guidance

## Entry Points

### root (codescout-companion)
- `codescout-companion/hooks/hooks.json` — event → script mapping (authoritative wiring; start here for any hook question)
- `codescout-companion/hooks/lib.mjs` — `detectFor()`, the detection entry point 21 of 23 `.mjs` hooks call (2 call `detect.mjs` directly)
- `codescout-companion/hooks/session-start.mjs` — SessionStart orchestrator (injection budget, drift warnings, auto-reindex)
- `codescout-companion/hooks/pre-tool-guard.mjs` — PreToolUse hard-blocker for native Read/Grep/Glob/Edit/Bash on source
- `codescout-companion/hooks/subagent-guidance.mjs` — SubagentStart: injects system-prompt verbatim + codescout routing
- `codescout-companion/hooks/explore-inject.mjs` — PreToolUse `Agent`: rewrites dispatch prompt via `updatedInput.prompt`
- `scripts/check-versions.sh`, `scripts/release.sh` — version validator and the one-command release

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
semantic_search("hook deny block tool call source file", project_id="root")
semantic_search("subagent dispatch prompt injection bootstrap", project_id="root")
semantic_search("mood derivation session signals", project_id="buddy")
semantic_search("judge worker subprocess spawn verdict", project_id="buddy")
grep(pattern="matcher", glob="**/hooks.json", mode="files")
```
Avoid: "task" (dispatch tool is `Agent`, not `Task`), "sdd-misc-plugins" as a repo name (now `claude-plugins`; it is still the marketplace key on this machine).

## Navigation Strategy

1. Hook behavior question → `symbols(path="codescout-companion/hooks/hooks.json")` for event binding → `symbols(path=<script>)` for that hook's structure
2. Trace a hook's logic → `semantic_search(query, project_id="root")` → `symbols(name=<fn>, include_body=true)`
3. Blast-radius before editing a shared function → `call_graph(symbol, path, direction="callers")`
4. Trace data/control flow through a function → `call_graph(symbol, path, direction="callees")`
5. Find who uses a specific symbol → `references(symbol, path)`
6. Docs, specs, SKILL.md, CLAUDE.md → `read_file(path)` for the heading map, then `read_file(path, heading="## …")`; edit with `edit_file(path, heading=…, action=…)`; managed trackers go through `doc`
7. Version/release work → `read_file("<plugin>/.claude-plugin/plugin.json")` → `read_file("README.md")` → `run_command("./scripts/check-versions.sh")`

## Project Rules

- `marketplace.json` must never contain `version` fields; bump only via `./scripts/release.sh`, never inline in a feature commit
- All four profiles' `installed_plugins.json` (`~/.claude`, `~/.claude-sdd`, `~/.claude-kat`, `~/.claude-stef`) update on every bump; `installPath` must start with the owning profile root
- Hooks load from the repo working tree here; skills and commands load from the versioned cache, so a skill edit is not live until a release
- PreToolUse matchers for subagent dispatch use `"matcher": "Agent"`, NOT `"Task"`; `PostToolUse:Agent` fires at launch, use `SubagentStop` for completion
- codescout-companion hooks always exit 0; buddy allows exit 2 only for a hard judge block
- Run `./tests/run-all.sh` (root) + `cd buddy && pytest` (buddy) before any version bump
