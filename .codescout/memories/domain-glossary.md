# Domain Glossary

## Claude Code Plugin System

| Term | Definition |
|---|---|
| hook | Executable triggered by a Claude Code event (SessionStart, PreToolUse, PostToolUse, …). **All 18 wired codescout-companion hooks are node (`.mjs`)** — verified 2026-08-28 from `hooks.json`, where every `command` starts with `node`. The `*.test.sh` files are bash test drivers, not hooks |
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
| `detect-tools.sh` | Thin bash shim over `scripts/detect.py`, kept for the historical sourcing pattern. **Not the live path** — the 19 `.mjs` hooks import `lib.mjs` → `detect.mjs` instead. Sourced only by itself and `pre-tool-guard.test.sh` (verified 2026-08-28) |
| worktree state machine | 3-hook sequence (worktree-activate → worktree-write-guard → cs-activate-project) using `.cs-worktree-pending` marker |
| drift warning | Session-start surface of high-drift files from codescout's `drift_report` SQLite table |

## buddy Terms

| Term | Definition |
|---|---|
| bodhisattva / specialist | Named expert persona (e.g., debugging-yeti) summoned via `/buddy:summon` |
| mood | Derived session state (12-priority chain in `derive_mood()`) driving statusline expression |
| judge | Async LLM subprocess checking plan drift (`judge.py`) or codescout tool violations (`cs_judge.py`) |
| verdict | Judge output written to `verdicts.json` / `cs_verdicts.json`; read by PreToolUse |
| PPID chain | 4-step session resolution: by-ppid index → .current_session_id → lone dir → None |
| narrative | JSONL action log per session; feeds the plan judge |
| `judge.env` | Authoritative judge config file (sourced by hooks; NOT settings.json) |
| CS heuristics | 6 sync checks run after every codescout/Bash call; inject corrections inline |
