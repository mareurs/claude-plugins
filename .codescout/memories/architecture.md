# Workspace Architecture

## Project Map

| Project | Purpose |
|---|---|
| `root` (claude-plugins) | Claude Code plugin marketplace: `codescout-companion` (tool routing + codescout MCP companion) and `sdd` (SDD governance). Bash + Markdown. |
| `buddy` | Himalayan companion plugin: mood-reactive statusline, 12 specialist personas, async LLM judges for plan drift + codescout tool violations. Bash + Python. |

## Repository Layout

buddy lives at `buddy/` inside the claude-plugins repo. Both plugins are co-located; the marketplace catalog is at `.claude-plugin/marketplace.json` at repo root.

## Cross-Project Dependencies

- buddy's `cs_heuristics.py` watches for `mcp__codescout__*` tool calls — it's tightly coupled to codescout being active in the same session
- codescout-companion's `pre-tool-guard.sh` blocks native Read/Grep/Glob/Edit — buddy respects this same discipline in its Python scripts
- Both plugins emit hook output via the same Claude Code JSON protocol (`hookSpecificOutput.additionalContext` / `permissionDecision`)

## Hook Surface (codescout-companion)

Authoritative wiring is `codescout-companion/hooks/hooks.json`. `detect-tools.sh` is a sourced *library* (sets HAS_CODESCOUT / BLOCK_READS / WORKSPACE_ROOT), not an event hook. `*.test.sh` / `*.fixtures.jsonl` are tests, not hooks. `il3-deny-hook.sh` exists but is NOT wired — and since **1.16.9** neither is any `run_command` hook: `il3-warn-hook.mjs` was deleted in `a989d73`, so that matcher carries nothing and IL3 is enforced server-side only, by codescout's `src/util/path_security.rs`.

**Every hook below is `.mjs`, not `.sh`** — the 1.14.0 cross-platform port renamed all of them, and this table said `.sh` for months afterwards. `detect-tools.sh` and the unwired `il3-deny-hook.sh` are the only genuine `.sh` files left in `hooks/`, and neither is a wired event hook. Re-derive the table from the installed `hooks.json` rather than trusting it; the source repo's copy is not what a running profile loads.

| Event / matcher | Hook | Purpose |
|---|---|---|
| SessionStart | `session-start.mjs` | injection budget, drift warnings, auto-reindex, memory/skill pointers |
| SubagentStart | `subagent-guidance.mjs` | inject system-prompt verbatim + codescout routing (subagents don't get `server_instructions`, #29655) |
| UserPromptSubmit | `constitution-brief.mjs` | buddy-constitution brief; also resolves `/buddy:summon` before the slash command runs, spilling an oversized persona payload to a guard-exempt file under `.buddy/<sid>/` and injecting a pointer |
| PreCompact | `constitution-epoch-bump.mjs` | bumps the constitution epoch across a compaction |
| PreToolUse `Edit\|Write\|mcp__codescout__(edit_code\|edit_file\|create_file)` | `constitution-guard.mjs` | buddy-constitution write guard. The matcher is deliberately NOT `worktree-write-guard`'s set: it adds native `Edit`/`Write` and omits `edit_markdown` |
| PreToolUse `Grep\|Glob\|Read\|Bash\|Edit\|Write` | `pre-tool-guard.mjs` | hard-block native reads/edits on source files |
| PreToolUse `Bash` | `git-worktree-guard.mjs` | guard git ops under worktrees |
| PreToolUse `mcp__.*__run_command` | **none since 1.16.9** | `il3-warn-hook.mjs` deleted (`a989d73`). A `contextPreToolUse` advisory can never block, so it was redundant when the server refused and wrong when the server allowed; its hand-copied regex called `ls`/`cat`/`find`/`grep`/`git` unbounded, which its own message called bounded. **Do not re-add a mirror of a server-side predicate.** |
| PreToolUse `mcp__.*__read_file` | `il4-deny-hook.mjs` | IL4 deny: `read_file` where a better tool fits (markdown/source) |
| PreToolUse `mcp__codescout__(edit_code\|edit_file\|edit_markdown\|create_file)` | `worktree-write-guard.mjs` | guard codescout writes under worktrees |
| PreToolUse `mcp__codescout__edit_code` | `pre-edit-hint.mjs` | edit_code usage hint |
| PreToolUse `Agent` | `pre-task-hint.mjs` | per-dispatch recon nudge (matcher `Agent`, NOT `Task` — see `agent-dispatch-hooks`) |
| PreToolUse `Agent` | `explore-inject.mjs` | explore bootstrap injector — rewrites the dispatch prompt via `updatedInput.prompt` (abs path + codescout routing) |
| PostToolUse `EnterWorktree` | `worktree-activate.mjs` | activate codescout project for the new worktree |
| PostToolUse `mcp__.*__workspace` | `cs-activate-project.mjs` | sync codescout active project on workspace switch |
| Stop | `goal-stop-hook.mjs` | goal / stop-gate check |

## Shared Infrastructure

- `./tests/run-all.sh` — root plugin bash test suite
- `buddy/` — pytest suite (`cd buddy && pytest`)
- `./scripts/check-versions.sh` — version consistency validator (plugin.json vs README.md vs marketplace.json)
- No CI configured; tests are run manually before version bumps

## Plugin Install Records (3 instances)

All version bumps must update install records in all three Claude Code instances:
- `~/.claude/plugins/installed_plugins.json`
- `~/.claude-sdd/plugins/installed_plugins.json`
- `~/.claude-kat/plugins/installed_plugins.json`
