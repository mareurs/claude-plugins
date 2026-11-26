---
kind: entry
status: open
title: 'session-bridge: codex plugin add installs hooks that run as harness claude and a second MCP server, beside what install-codex.py writes'
created: 2026-11-26
entry_kind: bug
log:
- '2026-11-26 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-26
---

**What I read (not run):** Codex lists `session-bridge@sdd-misc-plugins` as installable (`codex plugin list`). The plugin's `hooks/hooks.json` runs `${CLAUDE_PLUGIN_ROOT}/hooks/run.sh <event>`, whose `*)` arm is `exec "$HOME/.cargo/bin/session-bridge" hook "$1"` with no `--harness`; `main.rs:36` defaults `harness` to `claude`. Its `plugin.json` declares an MCP server `${HOME}/.cargo/bin/session-bridge serve`. `session-bridge/README.md` (section "Codex and Claude Code → Codex") tells Codex users to run `scripts/install-codex.py`, which writes the MCP entry and three user hooks with `--harness codex`.

**Expected:** one documented way for Codex. Either the plugin form says it is Claude Code only, or its hooks pass the harness.

**Effect if both are installed (read, not measured):** the Codex hooks would run twice, once as codex and once as claude, and the claude run would key its endpoint state by the wrong harness. A Codex user who follows the marketplace listing and not the README gets the plugin form only.

**Fix direction:** decide the supported Codex install. If `install-codex.py` is the only one, mark `session-bridge` Claude Code only in the Codex view of the marketplace, or say so in the plugin description; if the plugin form must work, give `run.sh` a harness argument (Codex sets `CODEX_HOME`/`CODEX_THREAD_ID`) and drop the duplicate MCP entry. Test with a scratch `CODEX_HOME`, as `tests/test-sync-codex.sh` does. Not measured: what Codex does when the plugin and the user hooks coexist.
