---
kind: entry
status: open
title: 'Codex on this machine: one ~/.codex, a local marketplace, three plugins installed'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-linux
---

- Only `~/.codex` exists. Marketplace `sdd-misc-plugins` is the LOCAL path of this checkout (`[marketplaces.sdd-misc-plugins] source_type = "local"`), so `codex plugin marketplace upgrade` does nothing for it; `codex plugin add <plugin>@sdd-misc-plugins` re-copies a plugin into `~/.codex/plugins/cache/` byte-identical with the working tree.
- Installed and approved: `cs-hint-codex`, `buddy`, `codescout-companion`. `buddy`'s PostToolUse hook is switched off there (`[hooks.state."buddy@sdd-misc-plugins:hooks/hooks.json:post_tool_use:0:0"] enabled = false`) because it would double the advisories.

**Valid:** dated 2026-11-09
