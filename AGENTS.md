# AGENTS.md

Repository rules are in `CLAUDE.md` at the repository root. Read it first: it applies to every harness.

## Codex

- Install `cs-hint-codex` for the `[cs-hint]` advisories. Do not run `buddy`'s PostToolUse hook beside it: both emit the same advisories.
- A Codex plugin hook runs only after the user approves it, and the approval is bound to a hash of the whole plugin root. Any edit inside `cs-hint-codex/` cancels every user's approval. The edit rules are in `CLAUDE.md` § cs-hint-codex.
- Nothing in this repository writes into `~/.codex/plugins/cache/`. Do not edit files there by hand.
- Facts about the Codex install on this machine: memory topic `machine-linux`.
