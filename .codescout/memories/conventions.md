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

## Skill layout — core in `SKILL.md`, harness specifics in `references/`

A skill whose mechanics differ by harness (Claude Code, Codex, OpenCode) or by operating system (Linux, macOS, Windows) keeps what holds everywhere in `SKILL.md`. Each measured pair of harness and operating system gets its own file, `references/<harness>-<os>.md`. This is progressive disclosure: a session loads the core, then reads only the file for its own pair. `reconnaissance` and `tracker-hygiene` already split their detail this way by topic, with a pointer that says when to read each file.

- `SKILL.md` holds the rules, the decision steps, and how a session tells which harness and operating system it runs in. It holds one pointer per measured pair: "on Codex on Linux, read `references/codex-linux.md` before Step N". One last pointer sends every unmeasured pair to `references/unmeasured.md`.
- A core rule never names one harness's tool or path, except inside a pointer. A pair file never repeats a core rule.
- A session reads the file for its own pair only. Do not inline another pair's mechanics "for completeness".
- **Add a pair file only after you measure that pair.** A guessed macOS or Windows block is worse than none: a block that finds nothing looks like a true zero. `references/unmeasured.md` says "stop and ask the operator" until a measured file exists.
- **Split only when a skill has real harness or OS content.** Measured 2026-11-10 over 22 skills: the peer-session skill of this repository had the most (67 harness lines, 21 tool-name lines, `/proc` and `/run/user` paths). It was retired on 2026-11-17: `session-bridge`'s own tools list the live sessions, so its replacement, `coordinating-sessions`, holds no per-harness mechanics. `sdd-flow` already splits by harness: `references/opencode.md` holds the OpenCode command names. Every other skill has 5 or fewer such lines, and those name plugin paths such as `CLAUDE.md`, or one 2-row dispatch table in `research-subagent`. Re-measure before you split another skill, and measure after `git pull`: a first measurement here ran on a checkout that lacked the OpenCode work on `origin`.
- No skill is split by operating system now. `sdd-flow` splits by harness only. `session-bridge/skills/coordinating-sessions` splits by topic: `references/commit-backup.md` holds the backup rules, and `tests/test-session-bridge-skill.sh` pins its facts.
