# SDD - Specification-Driven Development

Minimal, extensible Specification-Driven Development infrastructure for Claude Code.

## What is SDD?

A methodology where **code follows specifications**, not the other way around. Every feature starts with a clear definition of *what* before diving into *how*.

### Principles

1. **YAGNI** - Don't build features until you need them
2. **Copy > Build** - Use community tools when possible
3. **Minimal Viable Process** - Just enough structure, no more
4. **Pain-Driven Development** - Add complexity when friction emerges

## Installation

```
/plugin marketplace add mareurs/claude-plugins
/plugin install sdd@claude-plugins
```

Then in your project:

```
/sdd-init
```

This creates the constitution, directory structure, and configuration for your project.

## The SDD Workflow

```
/specify <feature>  -->  /plan <feature>  -->  Implement  -->  /review
```

### Commands

| Command | Purpose | Output |
|---------|---------|--------|
| `/sdd-init` | Bootstrap SDD in a project | constitution, dirs, config |
| `/specify <feature>` | Create Product Requirements Document | `memory/specs/<feature>.md` |
| `/plan <spec>` | Generate implementation plan (requires approval) | `memory/plans/<spec>/plan.md` |
| `/review` | Constitutional compliance check | GO/NO-GO decision |
| `/drift [spec]` | Detect spec-vs-code drift (requires Serena) | Drift report |
| `/document <mode>` | Generate docs from code (requires Serena) | ADRs, README, ARCHITECTURE |
| `/bootstrap-docs` | Bootstrap documentation for legacy projects | Specs, FEATURES.md |

### Skills

| Skill | Purpose |
|-------|---------|
| `sdd-flow` | Full lifecycle orchestration (ideate -> specify -> plan -> implement -> review -> finalize) |
| `tool-routing` | Routes to semantic tools (Serena) for code exploration |

### Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-start` | SessionStart | Show SDD status at conversation start |
| `spec-guard` | Write/Edit | Warn when changes don't reference a spec |
| `review-guard` | Bash (git commit) | Require `/review` before commits |
| `subagent-inject` | SubagentStart | Inject SDD rules into subagent contexts |

## Constitution

All development follows six immutable principles in `memory/constitution.md`:

| Article | Principle |
|---------|-----------|
| I | Specification-First Development |
| II | Human-in-the-Loop for Planning |
| III | Constitutional Review Before Commit |
| IV | Documentation as Code |
| V | Progressive Enhancement |
| VI | Clear Communication |

Stack-specific templates (Kotlin, Python) add Articles VII-VIII for architecture and testing guidance.

## Enforcement Modes

Configure in your project's `memory/sdd-config.md`:

- **warn** (default): Hooks provide warnings but don't block
- **strict**: Hooks enforce rules and block violations

## Integration with Other Plugins

| Plugin | Integration |
|--------|-------------|
| **superpowers** | Use `brainstorming` before `/specify`, `test-driven-development` during implementation |
| **commit-commands** | Use `/commit` after `/review` |
| **serena** | Required for `/drift` and `/document` |

## Stack Templates

Templates in `ecosystem/templates/` provide stack-specific constitutions:

- `base/` - Articles I-VI (language-agnostic)
- `kotlin/` - Adds Articles VII-VIII for Kotlin architecture and testing
- `python/` - Adds Articles VII-VIII for Python architecture and testing

## License

MIT
