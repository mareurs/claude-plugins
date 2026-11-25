---
kind: entry
status: open
title: 'Linux workstation: the Claude-Code-side steps of release.sh are real here'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-linux
---

- **`release.sh`'s Claude-Code-side steps are real here, not no-ops.** A release seeds a
  versioned cache in every profile whose install record has the plugin, and repoints that
  record; a profile without the plugin is skipped. The 1.16.17 release did exactly that, for
  the three profiles the scripts covered then.

**Valid:** dated 2026-08-26
