---
kind: entry
status: open
title: 'Linux workstation: which plugins each profile enables'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-linux
---

- **Enabled plugins** (`enabledPlugins` is what actually loads), measured 2026-11-12:
  `superpowers`, `codescout-companion`, `buddy`, `legible` and `hint-echo` in all four profiles.
  `~/.claude-sdd` and `~/.claude-stef` additionally enable `hookify` + `andrej-karpathy-skills` —
  that is profile purpose, not drift. `~/.claude`, `~/.claude-sdd` and `~/.claude-kat` also
  enable `chrome-devtools-mcp`, `document-skills`, `frontend-design` and `claude-md-management`;
  `~/.claude` adds `context7`. A project can enable a plugin too: this repo's
  `.claude/settings.local.json` enables `sdd@sdd-misc-plugins`. Other installed plugins are
  enabled nowhere and load nothing.

**Valid:** dated 2026-11-12
