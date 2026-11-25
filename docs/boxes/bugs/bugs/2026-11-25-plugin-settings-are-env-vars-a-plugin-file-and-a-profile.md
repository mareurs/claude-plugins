---
kind: entry
status: open
title: 'Plugin settings are env vars, a plugin file and a profile JSON: every setting should be one marker file in the profile directory'
created: 2026-11-25
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-25 open created codescout:6bb10174-8084-4777-b7ef-38b92a18572d'
severity: low
status_since: 2026-11-25
---

## Summary

Operator decision 2026-11-26: every plugin setting should be a marker file in the profile directory, as the opt-in of the planned session-bridge wake will be (`<config-dir>/session-bridge-wake`, spec `docs/superpowers/specs/2026-11-26-session-bridge-wake-design.md`). The operator calls it elegant and simple. Settings today use several other mechanisms. This entry records the rule so a new setting does not add one more mechanism, and so the existing ones can be moved one by one.

## What exists today (checked 2026-11-26)

- **Environment variables.** The `session-bridge` README lists four (`SESSION_BRIDGE_BIN`, `SESSION_BRIDGE_BIN_DIR`, `SESSION_BRIDGE_OPENCODE_BIN`, `SESSION_BRIDGE_OPENCODE_RECENT_HOURS`). Other names in code: `CS_PRIVACY`, `CS_HINT_ENABLED`, `CODESCOUT_WAKE_DEADLINE_SECS`, `CODESCOUT_WAKE_POLL_MS`. A grep for the prefixes `CS_`, `BUDDY_`, `SESSION_BRIDGE_` and `CODESCOUT_WAKE_` in plugin sources and tests finds 66 distinct names; that count includes test-only names, so it is an upper bound.
- **A settings file in the plugin.** `buddy/hooks/judge.env` (the CLAUDE.md says it is the authoritative judge config).
- **A JSON file in the profile.** `<profile>/codescout-wake.json` (`wake-on-job-end.mjs` main reads it; no profile has one today).

## Why a marker file

- **One mechanism.** A profile owner turns a feature on or off with `touch` or `rm`, and sees it with `ls`. No JSON to edit, no `env` map to merge into `settings.json`.
- **Per profile by construction.** The machine runs four profiles. A file in `<config-dir>` is per profile without extra code; an environment variable leaks between processes started from one shell.
- **Readable from every language the plugins use** (Rust binary, node hooks, Python, shell) with one existence check.

## Not decided here

- Which existing settings carry a value, not just on or off (for example `CODESCOUT_WAKE_DEADLINE_SECS`). A marker file holds only a switch; a value needs the file's content. Decide the content rule before moving a valued setting.
- How each existing setting is read today; this entry lists names, it does not trace the readers.
- Naming of the files, and where a project-level setting lives.

## Fix direction

Do the wake opt-in as a marker file first (the spec). Then pick one existing switch, move it, and write the convention (file name, content rule, location) into the `conventions` memory. Migrate the rest as they are touched.
