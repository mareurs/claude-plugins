---
kind: entry
status: open
title: 'Linux workstation: cross-profile parity is checked by check-profile-parity.sh'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-linux
---

- **Cross-profile parity is checked, not assumed:** `./scripts/check-profile-parity.sh`
  verifies every *array element* of each record **and** every marketplace registration
  (see its header for the seven drift classes and why `[0]`-only checks missed one).
  `release.sh` runs it at step 6.5 and refuses to push on failure.

**Valid:** dated 2026-08-26
