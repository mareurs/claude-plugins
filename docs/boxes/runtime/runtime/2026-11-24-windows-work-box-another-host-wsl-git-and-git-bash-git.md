---
kind: entry
status: open
title: 'Windows work box (another host): WSL git and Git Bash git disagree on file state'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-windows
---

- **Cross-shell git gotcha**: WSL's git and Git Bash's git can disagree wildly
  on file state for this repo. WSL's git has no `core.autocrlf` set, so it sees
  hundreds of files as "modified" purely from CRLF/LF normalization vs. the
  Windows-native checkout (which has `core.autocrlf=true`) — do NOT run
  `git add`/`git commit` from WSL against this repo; use Git Bash (or native
  PowerShell git) for anything that touches the index, so the working tree
  view matches what's actually committed.

**Valid:** dated 2026-08-05
