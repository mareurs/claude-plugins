---
kind: entry
status: open
title: 'Codex on this machine: codex plugin add session-bridge copies 22 GB (mcp-server/target); never run it'
created: 2026-11-26
entry_kind: note
log:
- '2026-11-26 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-26
---

`codex plugin add session-bridge@sdd-misc-plugins` copies the whole plugin dir, `mcp-server/target` included (22G, 51k files), and `codex app-server` `hooks/list` then stalls 14 s to minutes. Measured 2026-11-26 (Codex 0.171.0); removed with `codex plugin remove`. session-bridge is installed in Codex by `session-bridge/scripts/install-codex.py` (MCP entry plus three user hooks, `--harness codex`), which is the documented way and needs no `plugin add`. Bug: docs/boxes/bugs/bugs/2026-11-26-session-bridge-codex-plugin-add-copies-the-whole-plugin-dir*.md
