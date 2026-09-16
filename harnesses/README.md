# Other harnesses

This directory holds integrations for coding harnesses other than Claude Code. Each
adapter owns its installation instructions, runtime extensions, tests, and any
harness-specific safety boundary. Shared workflows and skills remain in the existing
plugin packages; an adapter should reference them rather than copy them.

## Available adapters

| Harness | Directory | What it provides |
|---|---|---|
| [Pi](./pi/) | `pi/` | Codescout MCP routing, companion status widget, recon/skill wiring, a fail-closed shell-egress guard, and read-only local session snapshots. |

## Adding an adapter

Create a named subdirectory (for example `codex/` or `github-copilot/`) only when
there is an actual maintained integration. Document its install command, configuration
location, supported Codescout capabilities, tests, and limitations in that adapter's
README. Do not create empty placeholder directories: they do not communicate a
supported integration and are not retained by Git.
