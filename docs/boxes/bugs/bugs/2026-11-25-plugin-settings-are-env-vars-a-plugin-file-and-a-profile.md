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

## Inventory by kind (grep of plugin sources, 2026-11-26)

A grep for `CS_`, `BUDDY_`, `SESSION_BRIDGE_`, `CODESCOUT_WAKE_` in code outside docs and tests finds 77 names, 66 with a non-test reader. The grouping below is by reading the names and the first reader file; the readers are not traced one by one.

- **Not settings (about 17): identity, loop guards, test hooks, name fragments.** `BUDDY_PREV_SID`, `BUDDY_HOOK_PPID`, `BUDDY_SKIP_SELF`, `BUDDY_SKIP_PRIMARY`, `SESSION_BRIDGE_CHILD`, `CS_COMPANION_HOST_ARMED`, `CS_TEST_STATE_SANDBOX`, `SESSION_BRIDGE_TEST_PANIC`, `SESSION_BRIDGE_CLAUDE_*_OK`. They stay environment variables.
- **Switches (about 10): a marker file fits.** `BUDDY_JUDGE_ENABLED`, `BUDDY_JUDGE_BLOCK`, `BUDDY_CS_JUDGE_ENABLED`, `BUDDY_CS_HEURISTICS_ENABLED`, `BUDDY_NO_AUTO_MIGRATE`, `CS_HINT_ENABLED`, `CS_SCRIBE_NUDGE`, `CS_COMPANION_IGNORE_PROJECT_CONFIG`, `CS_PRIVACY`, `SESSION_BRIDGE_PUSH_ACK`.
- **Valued (about 17): the file needs a content rule.** `BUDDY_JUDGE_MODEL`, `BUDDY_JUDGE_API_URL`, `BUDDY_JUDGE_INTERVAL`, `BUDDY_CS_JUDGE_INTERVAL`, `BUDDY_BUBBLE_TTL`, `BUDDY_PLAN_GLOBS`, `CS_SCRIBE_WINDOW_MS`, `CS_SCRIBE_VARIANT`, `CS_SEVERITY_FORMAT`, `CS_JUDGE_TEMPLATE`, `CS_MEMORY_NAMES`, `CODESCOUT_WAKE_DEADLINE_SECS`, `CODESCOUT_WAKE_POLL_MS`, `SESSION_BRIDGE_FILTER_TIMEOUT_S`, `SESSION_BRIDGE_ASK_BOUND_USD`, `SESSION_BRIDGE_OPENCODE_RECENT_HOURS`.
- **A secret (1): `BUDDY_JUDGE_API_KEY`.** A marker file holds it only with mode 0600; decide this before moving it.
- **Paths and binaries (about 20): not a switch.** `SESSION_BRIDGE_BIN`, `SESSION_BRIDGE_BIN_DIR`, `SESSION_BRIDGE_CLAUDE_BIN`, `SESSION_BRIDGE_CODEX_BIN`, `SESSION_BRIDGE_OPENCODE_BIN`, `CS_BINARY`, `BUDDY_HOME`, `BUDDY_HOME_DIR`, `CS_PROJECT_DIR`, `CS_MEMORIES_DIR`, `CS_CONFIG_FILE`, `CS_SYSTEM_PROMPT`, `CS_PREFIX`, `CS_SERVER_NAME`, the `SESSION_BRIDGE_*` git-hook variables. A path is an override for a tool or a test; leave them as variables.

**Two rules the move needs, proposed:**
1. **Polarity.** The file's presence is the non-default state: an opt-in feature is `<plugin>-<feature>` and an opt-out of a default-on feature is `<plugin>-<feature>-off`. A reader never has to guess the default.
2. **Content.** An empty file is a switch. A file with one trimmed line is a value; the reader falls back to the default when the file is absent or the line does not parse.

**The profile directory differs by harness.** Claude Code reads `<CLAUDE_CONFIG_DIR>` (fallback `~/.claude`); Codex reads `<CODEX_HOME>` (fallback `~/.codex`). `cs-hint-codex` runs only in Codex, so its marker lives under the Codex home.

**First candidate: `CS_HINT_ENABLED`.** One reader (`cs-hint-codex/hooks/cs_hint.py`), a pure switch, default on, one profile (Codex). It would become the file `<CODEX_HOME>/cs-hint-off`. Caveat: `cs-hint-codex` root must stay 5 files and any edit there cancels every user's Codex approval (CLAUDE.md § cs-hint-codex), so this is a release with re-approval; a better first candidate may be `CS_SCRIBE_NUDGE` or `BUDDY_NO_AUTO_MIGRATE`, which cost no approval.

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

## Progress 2026-11-26

- **Convention written** in memory `conventions` (polarity, content, profile directory, one way).
- **Moved (3):** `CS_SCRIBE_NUDGE` → `codescout-companion-scribe-nudge-off` (`36d075d`), `CS_PRIVACY` → `codescout-companion-privacy-off` (`a9ffe01`, companion 1.23.11), `SESSION_BRIDGE_ASK_BOUND_USD` → `session-bridge-ask-bound-usd` (`b426d22`, session-bridge 0.4.4). Each removed its env var in the same change.
- **What is set on this machine:** only those three were set (in the `env` of `settings.json`). The `CODESCOUT_*` entries in `~/.claude/settings.json` configure the codescout server, not a plugin, and are out of scope. `buddy/hooks/judge.env` is a local file, not tracked, with the judge switched off.
- **Rest stays as is.** The other names are defaults nobody sets, test knobs (`CODESCOUT_WAKE_DEADLINE_SECS` has 6 references, all code and tests) or paths. Move one when it is touched, by the convention. Open choices: whether `judge.env` keeps the buddy judge values or each becomes a file, and how a secret (`BUDDY_JUDGE_API_KEY`, empty here) is stored (mode 0600).
- **Not verified:** a live session on companion 1.23.11 and session-bridge 0.4.4 reading the files.
