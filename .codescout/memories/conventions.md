# Workspace Conventions

## Commit Style

Conventional commits: `feat(scope): message`, `chore(scope): message`, `fix(scope): message`.
Scope = plugin name or component (e.g., `codescout-companion`, `buddy`, `stop-hook`).

## PR / Merge Process

No CI. Manual test run required before any version bump:
- root: `./tests/run-all.sh` exits 0
- buddy: `cd buddy && pytest` exits 0
- Then: `./scripts/check-versions.sh` to verify consistency

## Shared Hook Contract

Both plugins share the same Claude Code hook output protocol:
- Inject guidance: `{hookSpecificOutput: {additionalContext: "..."}}`
- Hard block: `{hookSpecificOutput: {permissionDecision: "deny", permissionDecisionReason: "..."}}`
- codescout-companion: always exit 0 (hooks must not break sessions)
- buddy: exit 2 allowed for hard judge block (`BUDDY_JUDGE_BLOCK=true`)

## Fail-Open Principle

Both plugins: hook failures are silent, never fatal. codescout-companion uses lenient bash; buddy wraps all Python in `try/except Exception: pass`.

## Per-Project Conventions

See `memory(project="root", topic="conventions")` — hook stdin parsing, deny/context patterns, block_reads gotcha, testing approach.
See `memory(project="buddy", topic="conventions")` — Python fail-open, atomic writes, lazy imports, specialist SKILL.md structure, memory entry format.
