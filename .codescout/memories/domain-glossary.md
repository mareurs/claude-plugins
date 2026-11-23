# Domain Glossary

## Claude Code Plugin System

| Term | Definition |
|---|---|
| hook | Executable triggered by a Claude Code event (SessionStart, PreToolUse, PostToolUse, …). **All 27 wired codescout-companion hook commands (26 distinct `.mjs` scripts) are node** — verified 2026-11-23 from `hooks.json`: every `command` starts with `node`. The `*.test.sh` files are bash test drivers, not hooks |
| `hookSpecificOutput` | JSON key in hook stdout used to inject context or deny tools |
| `additionalContext` | Injects guidance text into the active Claude session |
| `permissionDecision: "deny"` | Hard-blocks a tool call; reason shown to Claude |
| `plugin.json` | Version + metadata source of truth for each plugin |
| `marketplace.json` | Catalog file — must NOT contain version fields |
| `installPath` | Frozen path in installed_plugins.json; must match the profile that owns it |

## codescout-companion Terms

| Term | Definition |
|---|---|
| `HAS_CODESCOUT` | Detection flag: true if codescout MCP server is configured in this session |
| `BLOCK_READS` | Config flag; set `block_reads` to boolean `false` or string `"false"` in `.claude/codescout-companion.json` to disable Read/Grep/Glob/Bash/Edit/Write blocking. Both forms work; absent → `true` |
| `detect-tools.sh` | Thin bash shim over `scripts/detect.py`, kept for the historical sourcing pattern. **Not the live path** — all 26 wired `.mjs` hook scripts import `lib.mjs`, which imports `detect.mjs` (`pre-tool-guard.mjs` also imports `detect.mjs` directly). The only `source` of the shim is the root `test-detect.sh` (verified 2026-11-23) |
| worktree state machine | 4-hook worktree set: `worktree-activate` (PostToolUse `EnterWorktree`) → `worktree-write-guard` (PreToolUse on the codescout write tools) → `cs-activate-project` (PostToolUse on `workspace`), using the `.cs-worktree-pending` marker; `git-worktree-guard` (PreToolUse `Bash`) is the fourth (matchers verified 2026-11-23) |
| drift warning | Session-start surface of high-drift files from codescout's `drift_report` SQLite table |

## buddy Terms

| Term | Definition |
|---|---|
| bodhisattva / specialist | Named expert persona (e.g., debugging-yeti) summoned via `/buddy:summon` |
| mood | Derived session state (13 moods; priority order in the `derive_mood()` docstring) driving statusline expression |
| judge | Async LLM subprocess checking plan drift (`judge.py`) or codescout tool violations (`cs_judge.py`) |
| verdict | Judge output written to `verdicts.json` / `cs_verdicts.json`; read by PreToolUse |
| PPID chain | 4-step session resolution: by-ppid index → .current_session_id → lone dir → None |
| narrative | JSONL action log per session; feeds the plan judge |
| `judge.env` | Authoritative judge config file (sourced by hooks; NOT settings.json) |
| CS heuristics | 5 sync checks in `cs_heuristics.check()` run after every codescout/Bash call (first hit wins); inject corrections inline |
