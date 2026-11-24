---
kind: entry
status: open
title: 'Linux workstation: marketplace registrations drifted for months in two unchecked files'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-linux
---

- **Marketplace registrations drifted for months in two files nothing checked** (fixed
  2026-08-26). `~/.claude-kat/plugins/known_marketplaces.json` pointed five of six
  marketplaces at `~/.claude/plugins/marketplaces/…`, and
  `~/.claude-sdd/plugins/marketplaces/caveman` was a *symlink* into `~/.claude`. The
  pointer was also **hiding** a second fault: kat's own `superpowers` clone had rotted to
  `91cb319` (2026-05-06) while the other two profiles ran `1ab7b8e` (2026-08-12), so
  repointing without refreshing first would have silently downgraded an enabled plugin by
  three months. **Refresh the local copy, then repoint — never the reverse.**

**Valid:** dated 2026-08-26
