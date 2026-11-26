---
kind: entry
status: fixed
title: 'session-bridge: codex plugin add copies the whole plugin dir with mcp-server/target (22 GB) into the Codex cache, and hooks/list then stalls for 14 s to minutes'
closed: 2026-11-26
created: 2026-11-26
entry_kind: bug
log:
- '2026-11-26 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
- '2026-11-26 open -> fixed codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-26
---

**What happened (measured 2026-11-26, Codex 0.171.0):** `codex plugin add session-bridge@sdd-misc-plugins` from the local marketplace (this checkout) copied the plugin root `session-bridge/` into `$CODEX_HOME/plugins/cache/sdd-misc-plugins/session-bridge/0.4.2/`. `du -sh` of the copy: 22G, 51,358 files, because `session-bridge/mcp-server/target/` (a cargo build, 21G in the checkout) went with it. The Claude Code cache copy of the same version is 14M (`copy_plugin_tree` leaves `target/` out). Two homes were made (the real one and a scratch one), 44 GB in all, until removed.

**Effect:** `hooks/list` through `codex app-server` took 0.5 s with `legible` only, 30 s with `session-bridge` in a scratch home (14 s after I removed the plugin's `mcpServers`, so the MCP entry is not the cause), and did not answer in 280 s in the real home. The likely cause is the content hash Codex takes of the whole plugin root for hook trust; I did not confirm that. A user who built the server inside a clone and then ran `codex plugin add` gets the same.

**How I recovered:** `codex plugin remove session-bridge@sdd-misc-plugins` deleted the cache dir; the backups taken before (`config.toml.before-sb-plugin-*`, `hooks.json.before-sb-plugin-*`) were restored; `install-codex.py` then reports `changed: []`, `hooks/list` answers in 0.2 s, the three user hooks read `trusted`.

**Fix direction:** the Codex plugin root must not contain a build tree. Options: build into a target dir outside the plugin (`CARGO_TARGET_DIR` or `.cargo/config.toml` `build.target-dir`; release.sh and `build.sh` would follow); or give Codex a thin plugin root without `mcp-server/`. Whether Codex reads an ignore file when it copies a plugin is not known; I did not find one. Until fixed, Codex users must use `install-codex.py` (README), and `session-bridge` must not be added with `codex plugin add`. Related: 2026-11-26-session-bridge-codex-plugin-add-installs-hooks-that-run-as (the hooks half, fixed in run.sh by 4344db4, 0.4.2).

## Closed

Fixed in 16e1f6c and 962a152 (released as session-bridge 0.4.3). build.sh builds into ~/.cache/session-bridge/target, so the plugin dir is 1.1 MB. The plugin MCP command now goes through sh, because Codex does not expand ${HOME}: 0 tools before, 4 after (scratch CODEX_HOME). Real Codex home: plugin installed, 5 hooks trusted, hooks/list in under a second, cache 116 MB.
