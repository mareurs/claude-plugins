---
kind: entry
status: open
title: 'Linux workstation: hooks load from the repo working tree, skills from the versioned cache'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-linux
---

- **Our HOOKS load from the REPO WORKING TREE, not from a versioned cache dir.**
  `known_marketplaces.json` records `sdd-misc-plugins` as
  `{"source": "directory", "path": "/home/marius/work/claude/claude-plugins"}` with
  `installLocation` set to that same repo path. Confirmed at runtime, not inferred:
  `.buddy/.session-start-trace.log` shows every hook invocation resolving
  `plugin_root=/home/marius/work/claude/claude-plugins/buddy`, including entries written
  after a release repointed `installPath` at a cache dir. **So a HOOK edit in `buddy/` or
  `codescout-companion/` is live in the working tree immediately.**
  **This holds for hooks and is FALSE for skills and commands** — those are read from
  `installPath`, the versioned cache dir, so a skill edit reaches nobody until a release
  seeds a new cache and repoints the records. Measured 2026-09-01: a skill cut 44,375 →
  13,680 B was still served at its old 44,673 B from
  `…/codescout-companion/1.19.11/skills/reconnaissance/SKILL.md`, exactly where that
  profile's `installPath` points. **So `bump-cache.sh` seeding and the `installPath`
  repointing are the load path for skills and commands, and belt-and-braces only for
  hooks** — and a skill edit is `committed`, not `live`, until a release runs. The editing
  session is the least representative observer of that. What a restart/reload buys you on
  top is *registration* — which hooks, skills and commands exist — resolved at process
  launch. See `CLAUDE.md` § Plugin Install Path for the per-channel table, and
  `docs/trackers/archive/skill-loading-session-log.md` F-5 for the measurement. Third-party
  github-source marketplaces load everything from `<profile>/plugins/marketplaces/…`.

**Valid:** conditional — the marketplace source or installLocation of sdd-misc-plugins changes
