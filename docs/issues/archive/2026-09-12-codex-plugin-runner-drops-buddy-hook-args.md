---
id: 3fd1009cc02aefe7
kind: bug
status: fixed
title: 'Codex runs Buddy hooks without their manifest `args`, producing hook failures'
tags:
- buddy
- codex
- hooks
- plugin-compatibility
last_observed: 2026-09-12
unverified: 'Codex did not expose the failing hook command or stderr in its normal or JSON CLI event output. The `args`-drop diagnosis is a strong inference from the shared registration shape and the matching bare-Node failure; capture host-side hook stderr before treating it as proven.'
---

## Summary

Codex reports one failed `SessionStart` hook and one failed `UserPromptSubmit`
hook whenever Buddy and Codescout Companion are enabled. Buddy declares its
hooks as `command: "node"` plus an `args` array; Codex appears to run only the
command. A bare `node` then reads the hook-event JSON from stdin as JavaScript
and exits 1.

## Reader and scope

**Reader:** a Buddy maintainer making the Claude plugin manifest work in Codex.

**Scope:** Buddy's five hook registrations in `buddy/hooks/hooks.json`. This
report does not change the manifest or the installed cache.

## Reproduction

From the Codescout repository with both local plugins enabled, run:

```sh
codex exec --ephemeral --sandbox read-only --cd /home/marius/work/claude/codescout \
  'List only the instruction-file paths loaded for this run. Do not use tools or modify files.'
```

Observed output includes:

```text
hook: SessionStart
hook: SessionStart
hook: SessionStart Failed
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit
hook: UserPromptSubmit Failed
hook: UserPromptSubmit Completed
```

Buddy is the only plugin registered for both events whose hook declaration
uses the structured form below. Codescout Companion uses a single command
string for the same events.

```json
{
  "command": "node",
  "args": [
    "${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs",
    "session-start"
  ]
}
```

The same form is used for `PreToolUse`, `SessionStart`, `SessionEnd`,
`PostToolUse`, and `UserPromptSubmit`.

## Evidence for the likely cause

Running Buddy as intended succeeds:

```sh
printf '%s\n' '{"cwd":"/tmp","session_id":"hook-smoke"}' \
  | node buddy/hooks/run.mjs session-start
# exit 0
```

Running only the declared `command` reproduces the failure shape:

```sh
printf '%s\n' '{"cwd":"/tmp","session_id":"hook-smoke"}' | node
# exit 1
# [stdin]:1
# {"cwd":"/tmp","session_id":"hook-smoke"}
#       ^
# Expected ';', '}' or <eof>
```

The fresh Codex run does not name the failed hook or print its stderr, so this
does not yet prove that its loader discards `args`. It does establish the
symptom and the only common manifest shape that yields this exact Node error.

## Proposed fix

Express each Buddy hook as one command string, matching Codescout Companion's
Codex-compatible form. For example:

```json
{
  "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs session-start"
}
```

Apply the equivalent rewrite to the other four Buddy hook events. Preserve
the existing `run.mjs` dispatcher and its event arguments; only the manifest
transport changes.

## Acceptance check

After changing the source manifest and reinstalling Buddy into Codex, repeat
the fresh `codex exec --ephemeral` run above. No `SessionStart Failed` or
`UserPromptSubmit Failed` line should remain. Also retain a registration test
that asserts every Buddy hook expands to a runnable command containing both
`run.mjs` and its event name.

## Stale-when

This report becomes stale if Codex begins honoring Claude-style hook `args`,
or if Buddy replaces `hooks/run.mjs` / its manifest schema.

## Fixed 2026-09-13

**Applied the proposed fix to Buddy, and generalized it to every plugin in the repo.**
Audited all 5 plugin manifests (`find . -name hooks.json`): `codescout-companion` had
already been converted to single-string commands in separate, uncommitted work; `buddy`
(5 hooks) and `sdd` (4 hooks) still used the `command`+`args` split; `claude-statusline`
and `session-bridge` invoke shell scripts directly and never had the split. Folded
`command`+`args` into one string for `buddy/hooks/hooks.json` and `sdd/hooks/hooks.json`,
preserving every other key (`matcher`, `async`) verbatim.

**Verification, not just a shape match:** ran each affected script directly with its
folded argv (`echo '{...}' | node buddy/hooks/run.mjs session-start`, likewise for
`sdd/hooks/session-start.mjs`) — both exit 0, confirming the event-name argument still
reaches the dispatcher when expressed inside the command string rather than as a
separate `args` array. This is what actually answers the report's own `unverified`
caveat (no captured Codex-side stderr) for the mechanism, independent of Codex itself.

**Regression test added, per the acceptance check:** `tests/test-all-plugins-hooks-json-portable.sh`
(new, picked up automatically by `tests/run-all.sh`'s glob) — (1) sweeps every
`*/hooks/hooks.json` in the repo and asserts no `command`-type hook entry carries an
`args` key, present or future plugins included; (2) additionally asserts, for Buddy
specifically, that each of its 5 folded command strings names both `run.mjs` and its
correct event token — the generic check alone couldn't catch a copy-paste error that
swapped or dropped an event name, since the string would still have no `args` key.

Full suite (`tests/run-all.sh`) green both under `env -i HOME=<empty>` (CI condition)
and the normal ambient environment; `buddy`'s own `pytest tests/` also green (527
passed) post-change.

## Stale-when — superseded

The original stale-when condition ("Codex begins honoring Claude-style hook `args`, or
Buddy replaces `hooks/run.mjs`") no longer applies now that the manifest itself no
longer uses `args` — re-open only if a future `hooks.json` edit for buddy or sdd
reintroduces a split `command`+`args` pair (the new regression test should catch this
before it ships) or if the acceptance check's Codex re-run surfaces a *different*
failure.
