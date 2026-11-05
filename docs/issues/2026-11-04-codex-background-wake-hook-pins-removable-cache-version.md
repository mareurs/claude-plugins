# Codex background-wake hook pins a removable cache version

Status: fixed and verified locally

Observed 2026-11-04: `/home/marius/.codex/hooks.json` invoked the companion's `1.20.26/background-wake/cli.mjs` after every `mcp__codescout__run_command`. The cache contained only `1.20.29`. Replaying the exact configured command exited 1 with Node `MODULE_NOT_FOUND`. A Codex debug exec completed without emitting that hook failure, so the direct subprocess reproduction is the evidence for this fault.

The registration instructions required an absolute prepared-plugin path. Using a versioned cache path made registration stale when an upgrade removed that cache.

The correction installs a self-contained profile-local launcher outside the versioned cache. It obtains the selected enabled plugin version from Codex's own JSON listing on each call and obtains the environment from the same profile's existing wake config. Cache identity and manifest are checked, and unrelated hook registrations are retained. No package fetch, hook-trust bypass, daemon restart or binding refresh is involved.

Regression: `codescout-companion/background-wake/codex-hook.test.mjs`; upgrade followed by old-cache deletion, downgrade with newer cache retained, profile isolation, silent hook output, failures, migration, and repeated installation. All 12 new subprocess tests passed. The existing five native hook-output tests also passed, including actual detached-delivery completion. Independent review applied four candidate mutations; all four were observed killed after closing the manifest and adapter-switch coverage gaps.

Installed in the only existing Codex profile on this machine, `~/.codex`; both capitalized and lowercase sdd/kat variants were checked and absent. The prior hook configuration was backed up. The exact registered command exited 0 with no stdout or stderr; an exec trace confirmed it queried Codex and then launched the installed `1.20.29` CLI. The normal Codex configuration API enrolled the replacement command's exact host-reported trust hash; `hooks/list` then reported trusted. A native app-server diagnostic observed the actual user PostToolUse hook finish with status completed, duration 685 ms, and empty entries. The separate plugin hooks reported existing content-approval requirements; those trust decisions were not changed.

The complete repository runner finished with one failing suite, `test-subagent-guidance.sh`: its output-budget tripwire observed only 8136 bytes for a 20 KB prompt. Isolated reruns of that unchanged suite passed all 43 checks both in the source checkout and in the staging clone. No claim of a fully green repository suite is made.
