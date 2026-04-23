# codescout-companion Backlog

Ideas worth building — not yet scheduled.

## /codescout-companion:refactor-project

Same bootstrapping pattern as `explore-project` (activate_project + CLAUDE.md + system-prompt.md), but write-enabled and operating inside a git worktree to isolate changes.

**Key design notes:**
- Uses `EnterWorktree` / worktree isolation so writes don't land on the main branch
- Subagent gets full project context before touching any code
- Should invoke `superpowers:test-driven-development` or `superpowers:subagent-driven-development` pattern internally
- Riskier than explore-project — needs explicit user confirmation of scope before spawning
- Consider a `--dry-run` mode that produces a plan without writing
