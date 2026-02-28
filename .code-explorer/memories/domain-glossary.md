# Domain Glossary

**SDD** — Specification-Driven Development. Methodology: spec → plan → implement → review.
**code-explorer** — Rust MCP server providing LSP-based symbol navigation, semantic search, and project memory. Separate repo (../code-explorer).
**code-explorer-routing** — This repo's companion plugin that routes Claude away from Read/Grep/Glob toward code-explorer's symbol tools.
**tool-infra** — Deprecated predecessor to code-explorer-routing. Routed to Serena/IntelliJ MCP instead.
**guidance.txt** — Compact tool selection rules injected into subagents. Subagents don't receive MCP server_instructions.
**server_instructions** — MCP protocol field that reaches the main agent automatically. Lives in code-explorer repo.
**detect-tools.sh** — Shared detection script that finds code-explorer config across 4 locations.
**PostToolUse soft guidance** — Current strategy: let Read/Grep/Glob succeed, then warn. Replaced PreToolUse hard-blocking in v1.1.0→1.2.x.
**orphaned plugin** — Cached plugin version with `.orphaned_at` file. Not active but may confuse debugging.
**drift** — Semantic embedding distance between old and new file versions. High drift = significant code change.
